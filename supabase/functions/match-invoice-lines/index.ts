// Match invoice lines pipeline (Steg 1–6)
// Input: { invoice_id: string, line_ids?: string[] }
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { normalizeUnit, isPackageUnit, resolveLineCost, stripPackageTokens } from "../_shared/units.ts";
import { normalizeMatchKey } from "../_shared/matchNormalize.ts";
import { syncRegisteredPrices, learnPendingAliases } from "../_shared/priceSync.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AnyRec = Record<string, any>;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Lightweight trigram-style similarity (fallback if pg_trgm RPC not used). Range 0..1.
function similarity(a: string, b: string): number {
  const A = norm(a); const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const trigrams = (s: string) => {
    const padded = `  ${s}  `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ta = trigrams(A); const tb = trigrams(B);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function descriptionMatchesPattern(desc: string | null, sku: string | null, p: AnyRec): boolean {
  const d = norm(desc); const s = norm(sku); const v = p.pattern_value_normalized ?? norm(p.pattern_value);
  switch (p.pattern_type) {
    case "exact_sku": return !!s && s === v;
    case "exact_description": return !!d && d === v;
    case "description_contains": return !!d && !!v && d.includes(v);
    default: return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    // Tjenestekall (cron/import) med service-role-nøkkelen hopper over brukersjekken.
    const isServiceCall = auth.replace(/^Bearer\s+/i, "").trim() === SERVICE;
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    if (!isServiceCall) {
      const { data: userData, error: uerr } = await userClient.auth.getUser();
      if (uerr || !userData.user) return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const invoiceId: string | undefined = body?.invoice_id;
    const lineIdFilter: string[] | undefined = body?.line_ids;
    if (!invoiceId) return json({ error: "invoice_id required" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE);

    // Fetch invoice + ensure caller has write
    const { data: inv, error: invErr } = await svc.from("invoices")
      .select("id, legal_entity_id, supplier_id, total_amount, invoice_date, status, currency, is_credit_note, extraction_confidence, lines_sum_status, notes")
      .eq("id", invoiceId).single();
    if (invErr || !inv) return json({ error: "Invoice not found" }, 404);

    if (!isServiceCall) {
      const { data: accessLevel } = await userClient.rpc("app_access_level", { p_app_code: "ravarer" });
      const lvl = (accessLevel as string) ?? "none";
      if (!["write", "approve", "admin"].includes(lvl)) return json({ error: "Forbidden" }, 403);
    }

    // Settings
    const { data: settings } = await svc.from("invoice_match_settings").select("*").eq("legal_entity_id", inv.legal_entity_id).maybeSingle();
    const tolDefault = Number(settings?.default_price_tolerance_pct ?? 2);
    const fuzzyThreshold = Number(settings?.fuzzy_match_threshold ?? 0.5);
    const fuzzyAuto = Number(settings?.fuzzy_auto_match_threshold ?? 0.85);
    const fuzzyDom = Number(settings?.fuzzy_auto_match_dominance_threshold ?? 0.65);

    const { data: catTols } = await svc.from("invoice_match_category_tolerances")
      .select("category, price_tolerance_pct").eq("legal_entity_id", inv.legal_entity_id);
    const catTolMap = new Map<string, number>();
    (catTols ?? []).forEach((c: AnyRec) => catTolMap.set(c.category, Number(c.price_tolerance_pct)));

    // Exclusion patterns for this supplier+entity (or supplier null)
    const { data: exclusions } = await svc.from("invoice_line_exclusion_patterns")
      .select("*").eq("legal_entity_id", inv.legal_entity_id)
      .or(`supplier_id.eq.${inv.supplier_id},supplier_id.is.null`);

    // Supplier's raw_material_suppliers (with aliases)
    const { data: rms } = await svc.from("raw_material_suppliers")
      .select("id, raw_material_id, supplier_id, supplier_sku, supplier_product_name, agreed_price_per_base_unit, last_invoice_date, package_size, package_unit, base_units_per_package, package_confirmed_at, is_primary")
      .eq("supplier_id", inv.supplier_id);
    const rmsList = rms ?? [];
    const rmsIds = rmsList.map((r: AnyRec) => r.id);

    let aliases: AnyRec[] = [];
    if (rmsIds.length) {
      const { data: aRows } = await svc.from("raw_material_supplier_aliases")
        .select("id, raw_material_supplier_id, alias_type, alias_value, alias_value_normalized, status, match_count")
        .in("raw_material_supplier_id", rmsIds);
      aliases = aRows ?? [];
    }
    const rmsById = new Map<string, AnyRec>(rmsList.map((r: AnyRec) => [r.id, r]));

    // Avviste og erstattede alias er lærdom om hva som IKKE stemmer — de skal aldri matche.
    const usableAliases = aliases.filter((a) => a.status !== "rejected" && a.status !== "superseded");
    const aliasKey = (a: AnyRec) => normalizeMatchKey(a.alias_value_normalized ?? a.alias_value);

    // Avviste alias er et menneskes «nei» — de skal blokkere også de direkte trinnene (3 og 4).
    const rejectedKeysByRms = new Map<string, Set<string>>();
    for (const a of aliases) {
      if (a.status !== "rejected") continue;
      const key = aliasKey(a);
      if (!key) continue;
      const set = rejectedKeysByRms.get(a.raw_material_supplier_id) ?? new Set<string>();
      set.add(key);
      rejectedKeysByRms.set(a.raw_material_supplier_id, set);
    }
    const isRejectedFor = (rmsId: string, ...keys: Array<string | null>) =>
      keys.some((k) => !!k && (rejectedKeysByRms.get(rmsId)?.has(k) ?? false));

    // Raw materials in legal entity (active) — for fuzzy
    const { data: rmList } = await svc.from("raw_materials")
      .select("id, name, sku, category, base_unit, current_cost_price, price_updated_at, primary_supplier_id, package_size, package_unit, base_units_per_package")
      .eq("legal_entity_id", inv.legal_entity_id).eq("is_active", true);
    const rmById = new Map<string, AnyRec>((rmList ?? []).map((r: AnyRec) => [r.id, r]));

    // Lines
    let q = svc.from("invoice_lines").select("*").eq("invoice_id", invoiceId);
    if (lineIdFilter?.length) q = q.in("id", lineIdFilter);
    const { data: lines } = await q;
    const allLines = lines ?? [];

    const results: AnyRec[] = [];

    for (const line of allLines) {
      // Skip not_applicable lines fully
      if (line.match_confidence === "not_applicable") {
        results.push({ id: line.id, skipped: true });
        continue;
      }

      // For manually matched lines: keep the match, but recompute price/variance + normalized unit only
      if (line.match_confidence === "manual" && line.raw_material_id) {
        const manualUpdate: AnyRec = {};
        const normalizedUnitM = normalizeUnit(line.unit);
        if (normalizedUnitM && normalizedUnitM !== line.unit) manualUpdate.unit = normalizedUnitM;

        const rm = rmById.get(line.raw_material_id);
        const rmsRow = rmsList.find((r: AnyRec) => r.raw_material_id === line.raw_material_id && r.supplier_id === inv.supplier_id);
        const expected = rmsRow?.agreed_price_per_base_unit != null ? Number(rmsRow.agreed_price_per_base_unit) : null;

        const cost = costForLine(line, rm, rmsRow);
        const usable = cost && !cost.needsInput && cost.confidenceLevel !== "low";
        const actual: number | null = usable ? cost!.pricePerBaseUnit : null;
        manualUpdate.price_per_base_unit = actual;
        manualUpdate.base_quantity = cost && !cost.needsInput && cost.confidence >= 0.85 ? cost.baseQuantity : null;
        manualUpdate.expected_price_per_base_unit = expected;

        const reviewReasons = new Set<string>();
        let requiresReview = false;
        if (cost?.needsInput === "package_size") {
          requiresReview = true;
          reviewReasons.add("unknown_package_size");
        } else if (cost && !cost.needsInput && cost.confidenceLevel === "low") {
          requiresReview = true;
          reviewReasons.add("uncertain_cost");
        } else if (actual == null && isPackageUnit(normalizedUnitM) && rm?.base_unit) {
          requiresReview = true;
          reviewReasons.add("unknown_package_size");
        }
        if (expected != null && actual != null && expected !== 0) {
          const variance = ((actual - expected) / expected) * 100;
          manualUpdate.price_variance_pct = Number(variance.toFixed(3));
          const tol = catTolMap.get(rm?.category ?? "") ?? tolDefault;
          if (Math.abs(variance) <= tol) {
            manualUpdate.variance_status = "within_tolerance";
          } else {
            manualUpdate.variance_status = "over_tolerance";
            requiresReview = true;
            reviewReasons.add("price_variance");
          }
        } else {
          manualUpdate.variance_status = "no_baseline";
          manualUpdate.price_variance_pct = null;
        }
        // Samme rekkefølge som i den automatiske grenen: sett flaggene først,
        // så får syncRegisteredPrices legge sine egne årsaker oppå.
        manualUpdate.requires_review = requiresReview;
        manualUpdate.review_reason = reviewReasons.size ? Array.from(reviewReasons).join(",") : null;
        await syncRegisteredPrices(svc, inv, line, rm, rmsRow, actual, manualUpdate, catTolMap.get(rm?.category ?? "") ?? tolDefault);

        await applyUpdate(svc, line.id, manualUpdate);
        results.push({ id: line.id, status: "manual", recomputed: true });
        continue;
      }

      // Reset suggestions
      await svc.from("invoice_line_match_suggestions").delete().eq("invoice_line_id", line.id);

      const update: AnyRec = {
        raw_material_id: null,
        match_confidence: "unmatched",
        requires_review: true,
        review_reason: "unmatched",
        price_per_base_unit: null,
        expected_price_per_base_unit: null,
        price_variance_pct: null,
        variance_status: null,
        resolution_note: null,
        resolved_at: null,
        resolved_by: null,
      };
      const suggestionsToInsert: AnyRec[] = [];

      // STEG 1 — exclusions
      const matchedExclusion = (exclusions ?? []).find((p: AnyRec) => descriptionMatchesPattern(line.description, line.supplier_sku, p));
      if (matchedExclusion) {
        Object.assign(update, {
          match_confidence: "not_applicable",
          requires_review: false,
          review_reason: null,
          resolution_note: `Auto-excluded: ${matchedExclusion.reason ?? matchedExclusion.pattern_type}`,
        });
        await applyUpdate(svc, line.id, update);
        results.push({ id: line.id, status: "excluded" });
        continue;
      }

      let matchedRmsId: string | null = null;
      let matchedRmId: string | null = null;
      let matchedAliasId: string | null = null;
      let confidenceLabel: string = "unmatched";

      const skuN = normalizeMatchKey(line.supplier_sku);
      const descN = normalizeMatchKey(line.description);
      const descStripped = normalizeMatchKey(stripPackageTokens(line.description));

      // STEG 2 — bekreftet alias, eksakt på normalisert verdi
      const confirmedHitsRaw = usableAliases.filter((a) => a.status === "confirmed" && (
        (a.alias_type === "supplier_sku" && skuN && aliasKey(a) === skuN) ||
        (a.alias_type === "product_name" && descN && aliasKey(a) === descN)
      ));
      // Flere alias kan peke på SAMME råvare (f.eks. både SKU og produktnavn) — det er ikke tvetydig.
      const confirmedRmIds = new Set(
        confirmedHitsRaw
          .map((a) => rmsById.get(a.raw_material_supplier_id)?.raw_material_id)
          .filter(Boolean) as string[],
      );
      const confirmedHits = confirmedRmIds.size <= 1 ? confirmedHitsRaw.slice(0, 1) : [];

      // Ekte tvetydighet: samme alias er bekreftet på flere ULIKE råvarer (dublett i råvareregisteret).
      if (confirmedRmIds.size > 1) {
        let rank = 1;
        for (const rmId of confirmedRmIds) {
          suggestionsToInsert.push({
            invoice_line_id: line.id, raw_material_id: rmId,
            confidence: 0.9, match_reason: "Flere råvarer har samme bekreftede alias (mulig dublett)", rank: rank++,
          });
        }
        update.match_confidence = "unmatched";
        update.requires_review = true;
        update.review_reason = "sku_collision";
        update.raw_material_id = null;
        await applyUpdate(svc, line.id, update);
        await insertSuggestions(svc, suggestionsToInsert);
        results.push({ id: line.id, status: "ambiguous_alias" });
        continue;
      }

      if (confirmedHits.length === 1) {
        const hit = confirmedHits[0];
        const rmsRow = rmsById.get(hit.raw_material_supplier_id);
        if (rmsRow) {
          matchedRmsId = rmsRow.id;
          matchedRmId = rmsRow.raw_material_id;
          matchedAliasId = hit.id;
          confidenceLabel = "auto_high";

          // SKU-kollisjon: samme varenummer, men beskrivelsen ligner ikke historikken.
          if (skuN && hit.alias_type === "supplier_sku") {
            const histName = rmsRow.supplier_product_name ?? "";
            if (histName && descN && similarity(descN, normalizeMatchKey(histName)) < 0.5) {
              update.match_confidence = "unmatched";
              update.requires_review = true;
              update.review_reason = "sku_collision";
              update.raw_material_id = null;
              suggestionsToInsert.push({
                invoice_line_id: line.id, raw_material_id: rmsRow.raw_material_id,
                confidence: 0.99, match_reason: `Historisk SKU-match (${hit.match_count ?? 0}x), men ulik beskrivelse`, rank: 1,
              });
              await applyUpdate(svc, line.id, update);
              await insertSuggestions(svc, suggestionsToInsert);
              results.push({ id: line.id, status: "sku_collision" });
              continue;
            }
          }

          // match_count telles bare når koblingen faktisk settes eller endres —
          // en ny kjøring på samme linje skal ikke blåse opp tallet.
          if (line.raw_material_id !== matchedRmId) {
            await svc.from("raw_material_supplier_aliases")
              .update({ match_count: (hit.match_count ?? 0) + 1, last_seen_at: new Date().toISOString() })
              .eq("id", matchedAliasId);
          }
        }
      }

      // STEG 3 — direkte treff på leverandørens eget varenummer (raw_material_suppliers.supplier_sku)
      if (!matchedRmId && skuN) {
        const skuRows = rmsList.filter(
          (r: AnyRec) => normalizeMatchKey(r.supplier_sku) === skuN && !isRejectedFor(r.id, skuN, descN),
        );
        const skuRmIds = new Set(skuRows.map((r: AnyRec) => r.raw_material_id));
        if (skuRmIds.size === 1) {
          const rmsRow = skuRows[0];
          matchedRmsId = rmsRow.id;
          matchedRmId = rmsRow.raw_material_id;
          confidenceLabel = "auto_high";
          // Lær varenummeret som bekreftet alias, slik at neste faktura går rett gjennom.
          await upsertConfirmedSkuAlias(svc, usableAliases, rmsRow.id, line.supplier_sku, inv.id);
        } else if (skuRmIds.size > 1) {
          let rank = suggestionsToInsert.length + 1;
          for (const rmId of skuRmIds) {
            suggestionsToInsert.push({
              invoice_line_id: line.id, raw_material_id: rmId,
              confidence: 0.9, match_reason: "Flere varer har samme leverandør-varenummer", rank: rank++,
            });
          }
          update.match_confidence = "unmatched";
          update.requires_review = true;
          update.review_reason = "sku_collision";
          update.raw_material_id = null;
          await applyUpdate(svc, line.id, update);
          await insertSuggestions(svc, suggestionsToInsert);
          results.push({ id: line.id, status: "sku_collision" });
          continue;
        }
      }

      // STEG 4 — beskrivelse uten pakningsord mot bekreftede alias og leverandørens produktnavn
      if (!matchedRmId && descStripped) {
        const strippedRmIds = new Set<string>();
        let strippedRms: AnyRec | undefined;
        for (const a of usableAliases) {
          if (a.status !== "confirmed" || a.alias_type !== "product_name") continue;
          if (normalizeMatchKey(stripPackageTokens(a.alias_value)) !== descStripped) continue;
          const rmsRow = rmsById.get(a.raw_material_supplier_id);
          if (!rmsRow) continue;
          if (isRejectedFor(rmsRow.id, skuN, descN)) continue;
          strippedRmIds.add(rmsRow.raw_material_id);
          strippedRms = rmsRow;
        }
        for (const r of rmsList) {
          if (!r.supplier_product_name) continue;
          if (normalizeMatchKey(stripPackageTokens(r.supplier_product_name)) !== descStripped) continue;
          if (isRejectedFor(r.id, skuN, descN)) continue;
          strippedRmIds.add(r.raw_material_id);
          strippedRms = r;
        }
        if (strippedRmIds.size === 1 && strippedRms) {
          matchedRmsId = strippedRms.id;
          matchedRmId = strippedRms.raw_material_id;
          confidenceLabel = "auto_medium";
        }
      }

      // STEG 5 — ventende alias (kun forslag)
      let pendingHit = false;
      if (!matchedRmId) {
        const pendingHits = usableAliases.filter((a) => a.status === "pending" && (
          (a.alias_type === "supplier_sku" && skuN && aliasKey(a) === skuN) ||
          (a.alias_type === "product_name" && descN && aliasKey(a) === descN)
        ));
        if (pendingHits.length > 0) {
          const top = pendingHits[0];
          const rmsRow = rmsById.get(top.raw_material_supplier_id);
          if (rmsRow) {
            suggestionsToInsert.push({
              invoice_line_id: line.id, raw_material_id: rmsRow.raw_material_id,
              confidence: 0.7, match_reason: "Ventende alias-match", rank: 1,
            });
            update.match_confidence = "unmatched";
            update.requires_review = true;
            update.review_reason = "low_confidence";
            pendingHit = true;
          }
        }
      }

      // STEG 6 — fuzzy. Gir ALDRI mer enn auto_low: en likhetsscore er en gjetning.
      let fuzzyMatchRmsRow: AnyRec | undefined;
      if (!matchedRmId) {
        const candidates = new Map<string, { score: number; reason: string }>();
        const update_cand = (rmId: string, score: number, reason: string) => {
          const prev = candidates.get(rmId);
          if (!prev || prev.score < score) candidates.set(rmId, { score, reason });
        };

        // (1) alias — leverandørens egne verdier
        for (const a of usableAliases) {
          const rmsRow = rmsById.get(a.raw_material_supplier_id);
          if (!rmsRow) continue;
          const key = aliasKey(a);
          const score = Math.max(
            similarity(key, descN),
            skuN ? similarity(key, skuN) : 0,
          ) * 1.0;
          if (score > fuzzyThreshold) update_cand(rmsRow.raw_material_id, score, `Alias-likhet (${a.alias_type})`);
        }
        // (2) supplier_product_name
        for (const r of rmsList) {
          if (!r.supplier_product_name) continue;
          const key = normalizeMatchKey(r.supplier_product_name);
          const score = Math.max(
            similarity(key, descN),
            skuN ? similarity(key, skuN) : 0,
          ) * 0.97;
          if (score > fuzzyThreshold) update_cand(r.raw_material_id, score, "Leverandør-produktnavn");
        }
        // (3) råvarenavn
        for (const r of (rmList ?? [])) {
          const key = normalizeMatchKey(r.name);
          const score = Math.max(
            similarity(key, descN),
            skuN ? similarity(key, skuN) : 0,
          ) * 0.92;
          if (score > fuzzyThreshold) update_cand(r.id, score, "Råvarenavn");
        }

        const sorted = [...candidates.entries()]
          .map(([rmId, v]) => ({ rmId, ...v }))
          .sort((a, b) => b.score - a.score);

        if (sorted.length > 0) {
          const top = sorted[0];
          const second = sorted[1];
          // Forhold, ikke differanse: nest beste må være under fuzzyDom av beste.
          const dominance = second ? (second.score / top.score) <= fuzzyDom : true;

          const rankOffset = suggestionsToInsert.length;
          sorted.slice(0, 3).forEach((c, idx) => {
            suggestionsToInsert.push({
              invoice_line_id: line.id, raw_material_id: c.rmId,
              confidence: Number(c.score.toFixed(3)), match_reason: c.reason, rank: rankOffset + idx + 1,
            });
          });

          if (pendingHit) {
            // Ventende alias forblir det foreslåtte valget; fuzzy gir kun flere forslag.
          } else if (top.score >= fuzzyAuto && dominance) {
            matchedRmId = top.rmId;
            confidenceLabel = "auto_low";
            update.match_confidence = "auto_low";
            update.requires_review = true;
            update.review_reason = "low_confidence";
          } else {
            update.match_confidence = "unmatched";
            update.requires_review = true;
            update.review_reason = "unmatched";
          }

          if (matchedRmId) {
            fuzzyMatchRmsRow = rmsList.find((r: AnyRec) => r.raw_material_id === matchedRmId);
          }
        }
      }

      if (matchedRmId && (confidenceLabel === "auto_high" || confidenceLabel === "auto_medium")) {
        update.match_confidence = confidenceLabel;
        update.requires_review = false;
        update.review_reason = null;
      }

      // Normaliser enheten alltid (også for unmatched linjer)
      const normalizedUnit = normalizeUnit(line.unit);
      if (normalizedUnit && normalizedUnit !== line.unit) {
        update.unit = normalizedUnit;
      }

      if (matchedRmId) update.raw_material_id = matchedRmId;

      // STEG 6 — price variance (when raw_material_id is set)
      if (update.raw_material_id) {
        const rm = rmById.get(update.raw_material_id);
        const rmsRow = rmsList.find((r: AnyRec) => r.raw_material_id === update.raw_material_id && r.supplier_id === inv.supplier_id);
        const expected = rmsRow?.agreed_price_per_base_unit != null ? Number(rmsRow.agreed_price_per_base_unit) : null;

        const cost = costForLine(line, rm, rmsRow);
        const usable = cost && !cost.needsInput && cost.confidenceLevel !== "low";
        const actual: number | null = usable ? cost!.pricePerBaseUnit : null;
        update.price_per_base_unit = actual;
        // Mengden i baseenheter skrives bare når motoren er trygg — et gjettet
        // tall her forplanter seg til lager og kalkyler.
        update.base_quantity = cost && !cost.needsInput && cost.confidence >= 0.85 ? cost.baseQuantity : null;
        update.expected_price_per_base_unit = expected;

        const addReason = (reason: string) => {
          update.requires_review = true;
          update.review_reason = update.review_reason
            ? Array.from(new Set(`${update.review_reason},${reason}`.split(","))).join(",")
            : reason;
        };

        // Aldri gjett: uten kjent pakningsinnhold, eller ved lav tillit, skal linja til gjennomgang.
        if (cost?.needsInput === "package_size") addReason("unknown_package_size");
        else if (cost && !cost.needsInput && cost.confidenceLevel === "low") addReason("uncertain_cost");
        else if (actual == null && isPackageUnit(normalizedUnit) && rm?.base_unit) addReason("unknown_package_size");

        if (expected != null && actual != null && expected !== 0) {
          const variance = ((actual - expected) / expected) * 100;
          update.price_variance_pct = Number(variance.toFixed(3));
          const tol = catTolMap.get(rm?.category ?? "") ?? tolDefault;
          if (Math.abs(variance) <= tol) {
            update.variance_status = "within_tolerance";
          } else {
            update.variance_status = "over_tolerance";
            update.requires_review = true;
            update.review_reason = update.review_reason
              ? Array.from(new Set(`${update.review_reason},price_variance`.split(","))).join(",")
              : "price_variance";
          }
        } else {
          update.variance_status = "no_baseline";
        }

        await syncRegisteredPrices(svc, inv, line, rm, rmsRow, actual, update, catTolMap.get(rm?.category ?? "") ?? tolDefault);
      }

      // Lær av vellykket fuzzy-match: skriv pending alias (aldri degrader bekreftede)
      if (matchedRmId && (confidenceLabel === "auto_medium" || confidenceLabel === "auto_low")) {
        const learnRms = fuzzyMatchRmsRow ?? rmsList.find((r: AnyRec) => r.raw_material_id === matchedRmId);
        if (learnRms) await learnPendingAliases(svc, learnRms.id, line, inv.id);
      }

      await applyUpdate(svc, line.id, update);
      await insertSuggestions(svc, suggestionsToInsert);
      results.push({ id: line.id, status: update.match_confidence, requires_review: update.requires_review });
    }

    // Fakturastatus etter kjøringen. Flagget eller avstemt faktura røres ALDRI —
    // et menneske har tatt et standpunkt, og motoren skal ikke overkjøre det.
    const lockedStatuses = ["flagged", "reconciled", "cancelled"];
    if (!lockedStatuses.includes(String(inv.status))) {
      const { data: stillPending } = await svc.from("invoice_lines")
        .select("id").eq("invoice_id", invoiceId).is("match_confidence", null).limit(1);
      if (!stillPending || stillPending.length === 0) {
        const { data: needsReview } = await svc.from("invoice_lines")
          .select("id").eq("invoice_id", invoiceId).eq("requires_review", true).limit(1);

        // Forhold ved selve fakturaen tvinger gjennomgang, uansett hvor pene linjene er.
        const invoiceLevelReview =
          inv.lines_sum_status === "mismatch" ||
          (inv.extraction_confidence != null && Number(inv.extraction_confidence) < 0.6) ||
          (inv.is_credit_note === true && !String(inv.notes ?? "").trim());

        const newStatus = (needsReview && needsReview.length > 0) || invoiceLevelReview
          ? "needs_review"
          : "ready";
        await svc.from("invoices").update({ status: newStatus }).eq("id", invoiceId);
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    console.error("match-invoice-lines error", e);
    console.error("match-invoice-lines", e);
    return json({ error: "internal_error" }, 500);
  }
});

async function applyUpdate(svc: any, lineId: string, update: AnyRec) {
  await svc.from("invoice_lines").update(update).eq("id", lineId);
}
/**
 * Lærer leverandørens varenummer som bekreftet alias etter et direkte SKU-treff.
 * Oppdaterer en eksisterende rad i stedet for å upserte, slik at `match_count` beholdes.
 */
async function upsertConfirmedSkuAlias(
  svc: any, aliasCache: AnyRec[], rmsId: string, sku: string | null, invoiceId: string,
) {
  if (!sku) return;
  const key = normalizeMatchKey(sku);
  const existing = aliasCache.find(
    (a) => a.raw_material_supplier_id === rmsId && a.alias_type === "supplier_sku" &&
      normalizeMatchKey(a.alias_value_normalized ?? a.alias_value) === key,
  );
  const nowIso = new Date().toISOString();
  if (existing) {
    if (existing.status === "confirmed") return;
    existing.status = "confirmed";
    await svc.from("raw_material_supplier_aliases")
      .update({ status: "confirmed", confirmed_at: nowIso, last_seen_at: nowIso })
      .eq("id", existing.id);
    return;
  }
  await svc.from("raw_material_supplier_aliases").upsert({
    raw_material_supplier_id: rmsId, alias_type: "supplier_sku", alias_value: sku,
    status: "confirmed", confirmed_at: nowIso, first_seen_invoice_id: invoiceId,
    match_count: 1, last_seen_at: nowIso,
  }, { onConflict: "alias_type,alias_value_normalized,raw_material_supplier_id", ignoreDuplicates: true });
}

async function insertSuggestions(svc: any, rows: AnyRec[]) {
  if (!rows.length) return;
  await svc.from("invoice_line_match_suggestions").insert(rows);
}

/**
 * Kostpris for en fakturalinje — ÉN motor, samme som grensesnittet bruker.
 * Beløpet er grunnlaget; `unit_price` er kun kontrollverdi.
 */
function costForLine(line: AnyRec, rm: AnyRec | undefined, rmsRow: AnyRec | undefined) {
  if (!rm?.base_unit) return null;
  return resolveLineCost({
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unit_price,
    totalAmount: line.total_amount,
    packageSize: line.package_size ?? null,
    packageUnit: line.package_unit ?? null,
    countPerPackage: line.count_per_package ?? null,
    description: line.description,
    baseUnit: rm.base_unit,
    supplierPackage: rmsRow
      ? {
          baseUnitsPerPackage: rmsRow.base_units_per_package ?? null,
          packageSize: rmsRow.package_size ?? null,
          packageUnit: rmsRow.package_unit ?? null,
          packageConfirmedAt: rmsRow.package_confirmed_at ?? null,
        }
      : null,
    rawMaterialPackage: {
      baseUnitsPerPackage: rm.base_units_per_package ?? null,
      packageSize: rm.package_size ?? null,
      packageUnit: rm.package_unit ?? null,
    },
    knownPricePerBaseUnit: rm.current_cost_price != null ? Number(rm.current_cost_price) : null,
  });
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

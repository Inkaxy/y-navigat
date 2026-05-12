// Match invoice lines pipeline (Steg 1–6)
// Input: { invoice_id: string, line_ids?: string[] }
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { normalizeUnit, isPackageUnit, quantityToBase } from "../_shared/units.ts";

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
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: uerr } = await userClient.auth.getUser();
    if (uerr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const invoiceId: string | undefined = body?.invoice_id;
    const lineIdFilter: string[] | undefined = body?.line_ids;
    if (!invoiceId) return json({ error: "invoice_id required" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE);

    // Fetch invoice + ensure caller has write
    const { data: inv, error: invErr } = await svc.from("invoices")
      .select("id, legal_entity_id, supplier_id, total_amount")
      .eq("id", invoiceId).single();
    if (invErr || !inv) return json({ error: "Invoice not found" }, 404);

    const { data: accessLevel } = await userClient.rpc("app_access_level", { p_app_code: "ravarer" });
    const lvl = (accessLevel as string) ?? "none";
    if (!["write", "approve", "admin"].includes(lvl)) return json({ error: "Forbidden" }, 403);

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
      .select("id, raw_material_id, supplier_id, supplier_sku, supplier_product_name, agreed_price_per_base_unit, package_size, package_unit, is_primary")
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

    // Raw materials in legal entity (active) — for fuzzy
    const { data: rmList } = await svc.from("raw_materials")
      .select("id, name, sku, category, base_unit, current_cost_price")
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

        let actual: number | null = null;
        if (line.unit_price != null && rm?.base_unit) {
          const conv = quantityToBase({
            quantity: 1,
            unit: line.unit,
            description: line.description,
            baseUnit: rm.base_unit,
            rmsPackageSize: rmsRow?.package_size ?? null,
            rmsPackageUnit: rmsRow?.package_unit ?? null,
            linePackageSize: (line as any).package_size ?? null,
            linePackageUnit: (line as any).package_unit ?? null,
          });
          if (conv && conv.factor !== 0) actual = Number(line.unit_price) / conv.factor;
        }
        manualUpdate.price_per_base_unit = actual;
        manualUpdate.expected_price_per_base_unit = expected;

        const reviewReasons = new Set<string>();
        let requiresReview = false;
        if (actual == null && isPackageUnit(normalizedUnitM) && rm?.base_unit) {
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
          manualUpdate.variance_status = expected == null ? "no_baseline" : "no_baseline";
          manualUpdate.price_variance_pct = null;
        }
        await syncRegisteredPrices(svc, inv, line, rm, rmsRow, actual, manualUpdate);
        if (manualUpdate.requires_review) requiresReview = true;
        if (manualUpdate.review_reason) manualUpdate.review_reason.split(",").forEach((r: string) => reviewReasons.add(r));
        manualUpdate.requires_review = requiresReview;
        manualUpdate.review_reason = reviewReasons.size ? Array.from(reviewReasons).join(",") : null;

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

      // STEG 2 — confirmed alias match
      const skuN = norm(line.supplier_sku);
      const descN = norm(line.description);
      const confirmedHits = aliases.filter((a) => a.status === "confirmed" && (
        (a.alias_type === "supplier_sku" && skuN && a.alias_value_normalized === skuN) ||
        (a.alias_type === "product_name" && descN && a.alias_value_normalized === descN)
      ));

      if (confirmedHits.length === 1) {
        const hit = confirmedHits[0];
        const rmsRow = rmsById.get(hit.raw_material_supplier_id);
        if (rmsRow) {
          matchedRmsId = rmsRow.id;
          matchedRmId = rmsRow.raw_material_id;
          matchedAliasId = hit.id;
          confidenceLabel = "auto_high";

          // SKU collision check
          if (skuN && hit.alias_type === "supplier_sku") {
            const histName = rmsRow.supplier_product_name ?? "";
            if (histName && descN && similarity(descN, norm(histName)) < 0.5) {
              // sku_collision — propose but don't auto-match
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

          // increment match_count + last_seen_at
          await svc.from("raw_material_supplier_aliases")
            .update({ match_count: (hit.match_count ?? 0) + 1, last_seen_at: new Date().toISOString() })
            .eq("id", matchedAliasId);
        }
      }

      // STEG 4 — pending alias match (only if not yet matched)
      if (!matchedRmId) {
        const pendingHits = aliases.filter((a) => a.status === "pending" && (
          (a.alias_type === "supplier_sku" && skuN && a.alias_value_normalized === skuN) ||
          (a.alias_type === "product_name" && descN && a.alias_value_normalized === descN)
        ));
        if (pendingHits.length > 0) {
          const top = pendingHits[0];
          const rmsRow = rmsById.get(top.raw_material_supplier_id);
          if (rmsRow) {
            suggestionsToInsert.push({
              invoice_line_id: line.id, raw_material_id: rmsRow.raw_material_id,
              confidence: 0.7, match_reason: "Pending alias-match", rank: 1,
            });
            update.match_confidence = "unmatched";
            update.requires_review = true;
            update.review_reason = "low_confidence";
          }
        }
      }

      // STEG 5 — fuzzy match
      if (!matchedRmId && update.review_reason !== "low_confidence") {
        const candidates = new Map<string, { score: number; reason: string }>();
        const update_cand = (rmId: string, score: number, reason: string) => {
          const prev = candidates.get(rmId);
          if (!prev || prev.score < score) candidates.set(rmId, { score, reason });
        };

        // (1) alias normalized — supplier scope
        for (const a of aliases) {
          if (a.status === "rejected" || a.status === "superseded") continue;
          const rmsRow = rmsById.get(a.raw_material_supplier_id);
          if (!rmsRow) continue;
          const score = Math.max(
            similarity(a.alias_value_normalized ?? "", descN),
            skuN ? similarity(a.alias_value_normalized ?? "", skuN) : 0,
          ) * 1.0;
          if (score > fuzzyThreshold) update_cand(rmsRow.raw_material_id, score, `Alias-likhet (${a.alias_type})`);
        }
        // (2) supplier_product_name
        for (const r of rmsList) {
          if (!r.supplier_product_name) continue;
          const score = Math.max(
            similarity(r.supplier_product_name, descN),
            skuN ? similarity(r.supplier_product_name, skuN) : 0,
          ) * 0.95;
          if (score > fuzzyThreshold) update_cand(r.raw_material_id, score, "Leverandør-produktnavn");
        }
        // (3) raw_material name
        for (const r of (rmList ?? [])) {
          const score = Math.max(
            similarity(r.name, descN),
            skuN ? similarity(r.name, skuN) : 0,
          ) * 0.85;
          if (score > fuzzyThreshold) update_cand(r.id, score, "Råvarenavn");
        }

        const sorted = [...candidates.entries()]
          .map(([rmId, v]) => ({ rmId, ...v }))
          .sort((a, b) => b.score - a.score);

        if (sorted.length > 0) {
          const top = sorted[0];
          const second = sorted[1];
          const dominance = second ? (top.score - second.score) >= fuzzyDom : true;

          // Suggestions: top 3
          sorted.slice(0, 3).forEach((c, idx) => {
            suggestionsToInsert.push({
              invoice_line_id: line.id, raw_material_id: c.rmId,
              confidence: Number(c.score.toFixed(3)), match_reason: c.reason, rank: idx + 1,
            });
          });

          if (top.score >= fuzzyAuto && dominance) {
            matchedRmId = top.rmId;
            confidenceLabel = "auto_medium";
            update.match_confidence = "auto_medium";
            update.requires_review = false;
            update.review_reason = null;
          } else if (top.score >= fuzzyAuto && !dominance) {
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
        }
      } else if (matchedRmId) {
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

        let actual: number | null = null;
        let conv: ReturnType<typeof quantityToBase> = null;
        if (line.unit_price != null && rm?.base_unit) {
          conv = quantityToBase({
            quantity: 1,
            unit: line.unit,
            description: line.description,
            baseUnit: rm.base_unit,
            rmsPackageSize: rmsRow?.package_size ?? null,
            rmsPackageUnit: rmsRow?.package_unit ?? null,
            linePackageSize: (line as any).package_size ?? null,
            linePackageUnit: (line as any).package_unit ?? null,
          });
          if (conv && conv.factor !== 0) actual = Number(line.unit_price) / conv.factor;
        }
        update.price_per_base_unit = actual;
        update.expected_price_per_base_unit = expected;

        // Flagg ukjent pakke-størrelse for pakke-enheter
        if (actual == null && isPackageUnit(normalizedUnit) && rm?.base_unit) {
          update.requires_review = true;
          update.review_reason = update.review_reason
            ? Array.from(new Set(`${update.review_reason},unknown_package_size`.split(","))).join(",")
            : "unknown_package_size";
        }

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

        await syncRegisteredPrices(svc, inv, line, rm, rmsRow, actual, update);
      }

      await applyUpdate(svc, line.id, update);
      await insertSuggestions(svc, suggestionsToInsert);
      results.push({ id: line.id, status: update.match_confidence, requires_review: update.requires_review });
    }

    // After pipeline: set invoice status based on review-state
    const { data: stillPending } = await svc.from("invoice_lines")
      .select("id").eq("invoice_id", invoiceId).is("match_confidence", null).limit(1);
    if (!stillPending || stillPending.length === 0) {
      const { data: needsReview } = await svc.from("invoice_lines")
        .select("id").eq("invoice_id", invoiceId).eq("requires_review", true).limit(1);
      const newStatus = needsReview && needsReview.length > 0 ? "needs_review" : "ready";
      await svc.from("invoices").update({ status: newStatus }).eq("id", invoiceId);
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
async function insertSuggestions(svc: any, rows: AnyRec[]) {
  if (!rows.length) return;
  await svc.from("invoice_line_match_suggestions").insert(rows);
}

async function syncRegisteredPrices(svc: any, inv: AnyRec, line: AnyRec, rm: AnyRec | undefined, rmsRow: AnyRec | undefined, actual: number | null, update: AnyRec) {
  if (!rm || actual == null || !Number.isFinite(actual)) return;

  const registered = rm.current_cost_price != null ? Number(rm.current_cost_price) : null;
  const supplierRegistered = rmsRow?.agreed_price_per_base_unit != null ? Number(rmsRow.agreed_price_per_base_unit) : null;
  if ((registered != null && actual > registered) || (supplierRegistered != null && actual > supplierRegistered)) {
    update.requires_review = true;
    update.review_reason = update.review_reason
      ? Array.from(new Set(`${update.review_reason},price_increase`.split(","))).join(",")
      : "price_increase";
  }

  await svc.from("raw_material_suppliers").upsert({
    raw_material_id: rm.id,
    supplier_id: inv.supplier_id,
    supplier_sku: line.supplier_sku,
    supplier_product_name: line.description,
    agreed_price_per_base_unit: actual,
    updated_at: new Date().toISOString(),
  }, { onConflict: "raw_material_id,supplier_id" });

  if (!rm.primary_supplier_id || rm.primary_supplier_id === inv.supplier_id || registered == null) {
    await svc.from("raw_materials").update({
      current_cost_price: actual,
      price_source: "invoice",
      price_updated_at: inv.invoice_date,
      primary_supplier_id: rm.primary_supplier_id ?? inv.supplier_id,
    }).eq("id", rm.id);
  }
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

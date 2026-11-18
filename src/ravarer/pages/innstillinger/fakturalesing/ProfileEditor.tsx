import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callPendingRpc } from "@/lib/pendingRpc";
import { requireSaved, unwrapPending, type ProfileRow } from "@/ravarer/lib/fakturalesing/readingApi";
import { draftFromStats, emptyProfile, mergeDraft, parseProfile, parseProfileStats, type ProfileStatus, type SupplierProfile } from "../../../../../supabase/pending/functions/_shared/supplierProfile";
import { skuShape } from "../../../../../supabase/pending/functions/_shared/readingCatalog";

type Path = "sku.position" | "sku.missing_note" | "quantity.note" | "quantity.d_pak" | "quantity.f_pak" | "package.note" | "discount.note"
  | "fees.pant" | "fees.avgifter" | "fees.gebyr" | "fees.frakt" | "credit.note" | "other";
type ListPath = "sku.shapes" | "sku.examples" | "columns" | "package.examples";

const TEXT_FIELDS: { path: Path; label: string; hint?: string; long?: boolean }[] = [
  { path: "sku.position", label: "Hvor står varenummeret", hint: "F.eks. «første kolonne, før varenavnet»" },
  { path: "sku.missing_note", label: "Når varenummer mangler" },
  { path: "quantity.note", label: "Antall og enhet" },
  { path: "quantity.d_pak", label: "D-pak betyr" },
  { path: "quantity.f_pak", label: "F-pak betyr" },
  { path: "package.note", label: "Hvordan pakning skrives" },
  { path: "discount.note", label: "Rabatt" },
  { path: "fees.pant", label: "Pant" },
  { path: "fees.avgifter", label: "Avgifter" },
  { path: "fees.gebyr", label: "Gebyr" },
  { path: "fees.frakt", label: "Frakt" },
  { path: "credit.note", label: "Kjennetegn på kreditnota" },
  { path: "other", label: "Annet", long: true },
];
const LIST_FIELDS: { path: ListPath; label: string; hint: string }[] = [
  { path: "sku.shapes", label: "Varenummerformer", hint: "9 = siffer, A = bokstav, adskilt med komma (f.eks. 99999, 9999 9)" },
  { path: "sku.examples", label: "Eksempler på varenummer", hint: "Adskilt med komma" },
  { path: "columns", label: "Kolonnerekkefølge", hint: "F.eks. Varenr, Tekst, Antall, Enhet, Pris, Sum" },
  { path: "package.examples", label: "Eksempler på pakning", hint: "F.eks. 10x1 kg" },
];

function getText(p: SupplierProfile, path: Path): string {
  if (path === "other") return p.other ?? "";
  const [a, b] = path.split(".") as [keyof SupplierProfile, string];
  const o = p[a] as unknown as Record<string, string | null>;
  return o[b] ?? "";
}
function setText(p: SupplierProfile, path: Path, v: string): SupplierProfile {
  const val = v.trim() ? v : null;
  if (path === "other") return { ...p, other: val };
  const [a, b] = path.split(".") as [keyof SupplierProfile, string];
  return { ...p, [a]: { ...(p[a] as object), [b]: val } };
}
function getList(p: SupplierProfile, path: ListPath): string[] {
  if (path === "columns") return p.columns;
  if (path === "package.examples") return p.package.examples;
  return path === "sku.shapes" ? p.sku.shapes : p.sku.examples;
}
function setList(p: SupplierProfile, path: ListPath, v: string): SupplierProfile {
  const list = v.split(",").map((x) => x.trim()).filter(Boolean);
  if (path === "columns") return { ...p, columns: list };
  if (path === "package.examples") return { ...p, package: { ...p.package, examples: list } };
  return { ...p, sku: { ...p.sku, [path === "sku.shapes" ? "shapes" : "examples"]: list } };
}

/** Én leverandørs profil som kladd. Bare «Bekreft profil» gjør at den sendes med lesingen. */
export function ProfileEditor({ legalEntityId, row, onSaved, onClose }: { legalEntityId: string; row: ProfileRow; onSaved: () => Promise<unknown>; onClose: () => void }) {
  const [draft, setDraft] = useState<SupplierProfile>(row.profile ?? emptyProfile());
  const [lists, setLists] = useState<Record<ListPath, string>>(() => Object.fromEntries(LIST_FIELDS.map((f) => [f.path, getList(row.profile ?? emptyProfile(), f.path).join(", ")])) as Record<ListPath, string>);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<null | "utkast" | "lagre">(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "feil"; text: string } | null>(null);
  const lock = useRef(false);

  const withLists = (p: SupplierProfile) => LIST_FIELDS.reduce((acc, f) => setList(acc, f.path, lists[f.path]), p);

  const makeDraft = async () => {
    if (lock.current) return;
    lock.current = true; setBusy("utkast"); setMsg(null);
    try {
      const stats = parseProfileStats(unwrapPending(await callPendingRpc("rm_supplier_profile_draft_stats", { p_legal_entity_id: legalEntityId, p_supplier_id: row.supplierId })));
      if (!stats) throw new Error("Svaret fra serveren kunne ikke leses.");
      if (stats.invoices < 3) throw new Error(`Bare ${stats.invoices} faktura(er) med lagrede linjer. Utkast krever minst 3.`);
      const merged = mergeDraft(withLists(draft), draftFromStats(stats, skuShape));
      setDraft(merged);
      setLists(Object.fromEntries(LIST_FIELDS.map((f) => [f.path, getList(merged, f.path).join(", ")])) as Record<ListPath, string>);
      setSource({ invoices: stats.invoices, lines: stats.lines, made_at: new Date().toISOString() });
      setMsg({ tone: "ok", text: `Utkast fra ${stats.invoices} fakturaer (${stats.lines} linjer). Bare tomme felt er fylt ut. Kontroller før du bekrefter.` });
    } catch (e) {
      setMsg({ tone: "feil", text: e instanceof Error ? e.message : "Kunne ikke lage utkast." });
    } finally { lock.current = false; setBusy(null); }
  };

  const save = async (status: ProfileStatus) => {
    if (lock.current) return;
    const profile = parseProfile(withLists(draft)) ?? emptyProfile();
    lock.current = true; setBusy("lagre"); setMsg(null);
    try {
      requireSaved(unwrapPending(await callPendingRpc("rm_save_supplier_profile", {
        p_legal_entity_id: legalEntityId, p_supplier_id: row.supplierId, p_profile: profile, p_status: status,
        p_expected_revision: row.revision, p_draft_source: source,
      })));
      await onSaved();
      onClose();
    } catch (e) {
      setMsg({ tone: "feil", text: e instanceof Error ? e.message : "Lagringen feilet." });
      await onSaved();
    } finally { lock.current = false; setBusy(null); }
  };

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{row.supplierName}</h3>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void makeDraft()}>
          {busy === "utkast" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Lag utkast fra fakturaer
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {LIST_FIELDS.map((f) => (
          <div key={f.path} className="space-y-1">
            <Label htmlFor={`pf-${row.supplierId}-${f.path}`}>{f.label}</Label>
            <Input id={`pf-${row.supplierId}-${f.path}`} value={lists[f.path]} onChange={(e) => setLists({ ...lists, [f.path]: e.target.value })} className="min-h-[44px]" />
            <p className="text-caption text-muted-foreground">{f.hint}</p>
          </div>
        ))}
        {TEXT_FIELDS.map((f) => (
          <div key={f.path} className={f.long ? "space-y-1 md:col-span-2" : "space-y-1"}>
            <Label htmlFor={`pf-${row.supplierId}-${f.path}`}>{f.label}</Label>
            {f.long
              ? <Textarea id={`pf-${row.supplierId}-${f.path}`} value={getText(draft, f.path)} onChange={(e) => setDraft(setText(draft, f.path, e.target.value))} rows={3} />
              : <Input id={`pf-${row.supplierId}-${f.path}`} value={getText(draft, f.path)} onChange={(e) => setDraft(setText(draft, f.path, e.target.value))} className="min-h-[44px]" />}
            {f.hint && <p className="text-caption text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      {msg && <p role={msg.tone === "feil" ? "alert" : "status"} className={msg.tone === "feil" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{msg.text}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={!!busy} onClick={onClose}>Avbryt</Button>
        <Button variant="outline" disabled={!!busy} onClick={() => void save("utkast")}>Lagre som utkast</Button>
        <Button disabled={!!busy} onClick={() => void save("bekreftet")}>
          {busy === "lagre" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Bekreft profil
        </Button>
      </div>
    </div>
  );
}

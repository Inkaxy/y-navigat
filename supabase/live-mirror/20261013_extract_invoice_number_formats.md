# extract-invoice-from-pdf — trykte tallformater (2026-10-13)

Utrullet: extract-invoice-from-pdf, source_sha256 7f4fc3dbc6275bab3a04dbca33f7b0d3336cc0198d516df1e6eeececb9ada5cf.
Baseline: live-filer hentet av bruker. _shared/crypto.ts, ai-providers.ts, invoiceReadCheck.ts, invoiceExtraction.ts og numberTokens.ts var byte-identiske med repoet før endring; index.ts ble kontrollert mot live-markører.
Ikke utrullet: tripletex-import-invoice-lines (deler numberTokens.ts/invoiceExtraction.ts; live-kilde ikke hentet).

## Diff mot live
```diff
--- /tmp/live2/numberTokens.ts	2026-10-13 18:33:27.929336602 +0000
+++ _shared/numberTokens.ts	2026-10-13 18:37:06.005344401 +0000
@@ -7,7 +7,9 @@
 // Regler:
 //  - JSON-tall endres aldri. Bare råtekst (token) tolkes.
 //  - Entydige former tolkes direkte: «1 234,50», «1.234,50», «1,234.50», «12,5», «110.00», «1 700», «1.234.567».
-//  - «siffer{1,3}.siffer{3}» (f.eks. «10.000», «1.100») er TVETYDIG: kandidatene er desimal og tusenskille.
+//  - «siffer{1,3}.siffer{3}» og «siffer{1,3},siffer{3}» (f.eks. «10.000», «1,100») er TVETYDIGE:
+//    kandidatene er desimal og tusenskille. Ugyldige tusengrupper («1 23,00», «1.23.456») avvises.
+//  - Negative tall: ledende minus, «−», parentes og etterstilt minus. Fortegnet bevares.
 //  - En tvetydig verdi avgjøres bare av linjens regnestykke (mengde × pris ≈ sum) med de andre feltene,
 //    og bare når nøyaktig én kombinasjon av kandidater går opp. Ellers null + kontrollbehov.
 //  - Beløp skaleres aldri for å treffe en kontrollsum.
@@ -22,42 +24,76 @@
   ambiguous: boolean;
 }
 
-const clean = (s: string) => s.replace(/[\s\u00a0\u202f]/g, "").replace(/(kr|nok|,-)$/i, "").replace(/^(kr|nok)/i, "");
+const WS = /[\s\u00a0\u202f]/g;
+const INVALID: TokenParse = { value: null, candidates: [], ambiguous: false };
+const one = (n: number): TokenParse => (Number.isFinite(n) ? { value: n, candidates: [n], ambiguous: false } : INVALID);
+
+/** Heltallsdel med valgfritt tusenskille: første gruppe 1–3 siffer, deretter grupper på nøyaktig 3. */
+function groupedInt(s: string, sep: string | null): string | null {
+  if (sep == null) return /^\d+$/.test(s) ? s : null;
+  const parts = s.split(sep);
+  if (parts.length === 1) return /^\d+$/.test(s) ? s : null;
+  if (!/^\d{1,3}$/.test(parts[0]) || !parts.slice(1).every((p) => /^\d{3}$/.test(p))) return null;
+  return parts.join("");
+}
+
+/** Fortegn slik det er trykt: «-12», «−12», «(12)», «12-». Mer enn én form er ugyldig. */
+function splitSign(s0: string): { neg: boolean; body: string } | null {
+  let s = s0.replace(/\u2212/g, "-").trim();
+  const stripCur = (x: string) => x.replace(/^(kr\.?|nok)\s*/i, "").replace(/\s*(kr\.?|nok)$/i, "").trim();
+  s = stripCur(s);
+  let signs = 0;
+  if (/^\(.*\)$/.test(s)) { s = stripCur(s.slice(1, -1)); signs++; }
+  if (/\d,-$/.test(s)) s = s.slice(0, -2); // «100,-» = hele kroner, ikke minus
+  else if (/\d\s*-$/.test(s)) { s = s.replace(/\s*-$/, ""); signs++; }
+  if (/^[-+]/.test(s)) { if (s[0] === "-") signs++; s = s.slice(1).trim(); }
+  if (signs > 1 || /[-+()]/.test(s)) return null;
+  return { neg: signs === 1, body: s };
+}
 
-/** Tolk ett trykt tall-token. Returnerer kandidater i stedet for å gjette ved tvetydighet. */
+/**
+ * Tolk ett trykt tall-token. Returnerer kandidater i stedet for å gjette ved tvetydighet.
+ * Negative beløp: «-1 234,50», «−1 234,50», «(1 234,50)» og etterstilt «1 234,50-».
+ * Tusenskille (mellomrom/NBSP/punktum/komma) må ha gyldige 3-siffergrupper, ellers ugyldig.
+ * «d{1,3}.ddd» og «d{1,3},ddd» uten annet skilletegn er tvetydige (desimal eller tusen),
+ * unntatt når heltallsdelen er 0 («0,500» = 0,5).
+ */
 export function parseNumberToken(input: unknown): TokenParse {
-  if (typeof input === "number") return Number.isFinite(input) ? { value: input, candidates: [input], ambiguous: false } : { value: null, candidates: [], ambiguous: false };
-  if (typeof input !== "string") return { value: null, candidates: [], ambiguous: false };
-  const s = clean(input);
-  if (s === "" || !/^[-+]?[\d.,]+$/.test(s)) return { value: null, candidates: [], ambiguous: false };
-  const one = (txt: string): TokenParse => {
-    const n = Number(txt);
-    return Number.isFinite(n) ? { value: n, candidates: [n], ambiguous: false } : { value: null, candidates: [], ambiguous: false };
+  if (typeof input === "number") return one(input);
+  if (typeof input !== "string") return INVALID;
+  const sg = splitSign(input);
+  if (!sg) return INVALID;
+  const s = sg.body.replace(WS, " ");
+  if (s === "" || !/^\d[\d., ]*$/.test(s) || !/\d$/.test(s)) return INVALID;
+  const sign = sg.neg ? -1 : 1;
+  const hasSpace = s.includes(" ");
+  const nComma = (s.match(/,/g) ?? []).length;
+  const nDot = (s.match(/\./g) ?? []).length;
+  const fin = (intPart: string | null, dec: string | null): TokenParse => {
+    if (intPart == null || (dec != null && !/^\d+$/.test(dec))) return INVALID;
+    return one(sign * Number(dec == null ? intPart : `${intPart}.${dec}`));
   };
-  const lastComma = s.lastIndexOf(",");
-  const lastDot = s.lastIndexOf(".");
-  if (lastComma >= 0 && lastDot >= 0) {
-    return one(lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
-  }
-  if (lastComma >= 0) {
-    const commas = (s.match(/,/g) ?? []).length;
-    if (commas > 1) return /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? one(s.replace(/,/g, "")) : { value: null, candidates: [], ambiguous: false };
-    return one(s.replace(",", "."));
-  }
-  if (lastDot >= 0) {
-    const dots = (s.match(/\./g) ?? []).length;
-    if (dots > 1) return /^[-+]?\d{1,3}(\.\d{3})+$/.test(s) ? one(s.replace(/\./g, "")) : { value: null, candidates: [], ambiguous: false };
-    if (/^[-+]?\d{1,3}\.\d{3}$/.test(s)) {
-      const asDecimal = Number(s);
-      const asThousands = Number(s.replace(".", ""));
-      return { value: null, candidates: [asDecimal, asThousands], ambiguous: true };
-    }
-    return one(s);
+  if (nComma > 0 && nDot > 0) {
+    // Det siste skilletegnet er desimaltegnet og forekommer én gang; det andre er tusenskille.
+    const decSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
+    const thSep = decSep === "," ? "." : ",";
+    if ((decSep === "," ? nComma : nDot) !== 1 || hasSpace) return INVALID;
+    const [i, d] = s.split(decSep);
+    return fin(groupedInt(i, thSep), d);
+  }
+  const sep = nComma > 0 ? "," : nDot > 0 ? "." : null;
+  if (sep == null) return fin(groupedInt(s, hasSpace ? " " : null), null);
+  const n = sep === "," ? nComma : nDot;
+  if (n > 1) return hasSpace ? INVALID : fin(groupedInt(s, sep), null);
+  const [i, d] = s.split(sep);
+  if (hasSpace) return fin(groupedInt(i, " "), d); // mellomrom er tusenskille ⇒ skilletegnet er desimal
+  if (/^[1-9]\d{0,2}$/.test(i) && /^\d{3}$/.test(d)) {
+    return { value: null, candidates: [sign * Number(`${i}.${d}`), sign * Number(i + d)], ambiguous: true };
   }
-  return one(s);
+  return fin(/^\d+$/.test(i) ? i : null, d);
 }
 
-export interface NumberEvidence { field: NumberField; raw: string; value: number | null; how: "entydig" | "regnestykke" | "tvetydig" | "modelltall" }
+export interface NumberEvidence { field: NumberField; raw: string; value: number | null; how: "entydig" | "regnestykke" | "tvetydig" | "ugyldig" | "modelltall" }
 
 export interface ResolvedNumbers {
   quantity: number | null;
@@ -66,6 +102,8 @@
   evidence: NumberEvidence[];
   /** Felt som var tvetydige og IKKE kunne avgjøres. */
   unresolved: NumberField[];
+  /** Felt med trykt råtekst som ikke er et gyldig tall (f.eks. feil tusengruppe). Aldri erstattet av modelltallet. */
+  invalid: NumberField[];
 }
 
 const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);
@@ -105,15 +143,17 @@
     for (const f of fields) out[f] = parsed.get(f)!.p.value;
   }
   const unresolved: NumberField[] = [];
+  const invalid: NumberField[] = [];
   for (const f of fields) {
     const e = parsed.get(f)!;
     if (e.raw == null) {
       if (typeof l[f] === "number") evidence.push({ field: f, raw: String(l[f]), value: out[f], how: "modelltall" });
       continue;
     }
-    const how = e.p.ambiguous ? (out[f] == null ? "tvetydig" : "regnestykke") : "entydig";
+    const how = e.p.ambiguous ? (out[f] == null ? "tvetydig" : "regnestykke") : e.p.candidates.length === 0 ? "ugyldig" : "entydig";
     if (how === "tvetydig") unresolved.push(f);
+    if (how === "ugyldig") invalid.push(f);
     evidence.push({ field: f, raw: e.raw, value: out[f], how });
   }
-  return { quantity: out.quantity, unit_price: out.unit_price, total_amount: out.total_amount, evidence, unresolved };
+  return { quantity: out.quantity, unit_price: out.unit_price, total_amount: out.total_amount, evidence, unresolved, invalid };
 }
--- /tmp/live2/invoiceExtraction.ts	2026-10-13 18:35:33.653341099 +0000
+++ _shared/invoiceExtraction.ts	2026-10-13 18:37:11.290344590 +0000
@@ -126,6 +126,7 @@
     };
     out.read_issues = [
       ...nums.unresolved.map((f) => ({ code: "tvetydig_tall", message: `Tvetydig tall i ${FIELD_LABEL[f]} («${nums.evidence.find((e) => e.field === f)?.raw ?? ""}»): kan ikke avgjøres sikkert. Kontroller mot dokumentet.` })),
+      ...nums.invalid.map((f) => ({ code: "ugyldig_tall", message: `Ugyldig tallformat i ${FIELD_LABEL[f]} («${nums.evidence.find((e) => e.field === f)?.raw ?? ""}»), f.eks. feil tusenskille. Tallet er ikke tolket – les det av originalen.` })),
       ...lineReadIssues({
       quantity, unit, unit_price, total_amount, package_size, package_unit, count_per_package,
       unit_price_basis: price_basis, discount_amount, line_kind, is_credit: isCredit,
```

## Utrullede filer (eksakt)
- extract-invoice-from-pdf/index.ts sha256 092aa987d97ad4f6d8a30748a2f3f375abb97d73a710890a969bb501ec6c463c
- _shared/numberTokens.ts sha256 0e4bb46102bbe8e887a7c8d403b0a50e2c2b922213bcc2b86dc6ca44849c2c41
- _shared/invoiceExtraction.ts sha256 1c42027b90d8ef46ba438f5bef006156159afd492c47a64c7f0dcf18395781d3
- _shared/invoiceReadCheck.ts sha256 2e029048f12727fb35f8f0d097268eea5bfddbdf71f9df0d2a531a41cfcb79d9
- _shared/crypto.ts sha256 2f60fecac6460da09bcd3ed1876401fb073e73f25806092d2118fa27b229cf8b
- _shared/ai-providers.ts sha256 88571bbdaef719cd56e39be9e521e76015df896625e1a4f0339c986df558db58

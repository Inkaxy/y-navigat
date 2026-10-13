# tripletex-import-invoice-lines — talltolkning synkronisert (2026-10-13)

Utrullet source_sha256 af4a8884b52fbf9dc6093657ca550c5befa0613fd3f29b08bdf36b6501208891. Eneste kodeendring mot live: rows.ts (ugyldig_tall fra resolveLineNumbers().invalid).
```diff
--- /tmp/tt/rows.ts	2026-10-13 18:47:57.733367709 +0000
+++ tripletex-import-invoice-lines/rows.ts	2026-10-13 18:48:53.198369693 +0000
@@ -97,6 +97,10 @@
           ...nums.unresolved
             .filter(() => !issuesOf(l.read_issues).some((x) => x.code === "tvetydig_tall"))
             .map((f) => ({ code: "tvetydig_tall", message: `Tvetydig tall i ${f}: kan ikke avgjøres sikkert. Kontroller mot dokumentet.` })),
+          // Samme regel som leseren: ugyldig trykt tallformat (f.eks. feil tusengruppe) erstattes aldri av modelltallet.
+          ...nums.invalid
+            .filter(() => !issuesOf(l.read_issues).some((x) => x.code === "ugyldig_tall"))
+            .map((f) => ({ code: "ugyldig_tall", message: `Ugyldig tallformat i ${f}: tallet er ikke tolket. Les det av originalen.` })),
         ].slice(0, 20),
         evidence: {
           confidence: num(l.confidence),
```
- tripletex-import-invoice-lines/index.ts c1ea294c4e4d1032608ee51bda9580bdae647150aadaed26d917bf2791d13f7e
- tripletex-import-invoice-lines/rows.ts 45a440c2eb5bbcd1723635a2a5feeb37dda9d1d3f9cda73037128af5a7941915
- tripletex-import-invoice-lines/failure-plan.ts e3c23604b26baaf9e4ffe2250d1df78c7143eaeea7bf3e6062dcbf4130512149
- tripletex-import-invoice-lines/ledger-account.ts 37fe5add3b3fccac3d100478ecea267df97807a1d0e6cd746390b9b80ff8c6d0
- _shared/tripletex.ts 2a11f22f87e90c67162bcd2192dcfcde0cf98db099a7dcf160a46e1220412d0f
- _shared/tripletex-crypto.ts 992105b60e92671a3b67a3c143b26393247a201eee5e07b385d0c52c94da9270
- _shared/lines-sum.ts a0d0b5bc833ad325c0a63c781bb34457cdf6ad29260f27d989c56cec1ca20802
- _shared/units.ts 1f970dfd597454c41b075f8ec840c3f1eab8a2104cd900f22889e7f4dd705c0a
- _shared/numberTokens.ts 0e4bb46102bbe8e887a7c8d403b0a50e2c2b922213bcc2b86dc6ca44849c2c41
- _shared/invoiceExtraction.ts 1c42027b90d8ef46ba438f5bef006156159afd492c47a64c7f0dcf18395781d3
- _shared/invoiceReadCheck.ts 2e029048f12727fb35f8f0d097268eea5bfddbdf71f9df0d2a531a41cfcb79d9

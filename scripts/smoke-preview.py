"""Røyktest uten innlogging (punkt 5c). Bruk: python3 scripts/smoke-preview.py [grunnadresse]
Standard grunnadresse er http://localhost:8080. Sjekker at testdatasidene og innloggingen åpner uten feil i konsollen,
og at Råvarer krever innlogging. Skriver OK/FEIL per side og avslutter med kode 1 ved feil."""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/")
PAGES = [
    ("/forhandsvisning/pris", None),
    ("/forhandsvisning/pdf-import", None),
    ("/forhandsvisning/sidehode", None),
    ("/forhandsvisning/nye-varer", None),
]

async def main() -> int:
    failed = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        for path, _ in PAGES:
            page = await (await b.new_context(viewport={"width": 1280, "height": 1800})).new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not m.text.startswith("Warning:") else None)  # Reacts utviklervarsler finnes ikke i publisert bygg
            await page.goto(BASE + path, wait_until="networkidle")
            text = (await page.inner_text("body")).strip()
            good = len(text) > 40 and not errors
            failed += 0 if good else 1
            print(("OK  " if good else "FEIL"), path, "" if good else (errors[:2] or ["tom side"]))
        page = await (await b.new_context()).new_page()
        await page.goto(BASE + "/ravarer/fra-faktura", wait_until="networkidle")
        guarded = "/ravarer/fra-faktura" not in page.url or await page.get_by_role("textbox").count() > 0
        failed += 0 if guarded else 1
        print(("OK  " if guarded else "FEIL"), "/ravarer/fra-faktura krever innlogging ->", page.url)
        await b.close()
    print("Røyktest:", "bestått" if failed == 0 else f"{failed} feil")
    return 1 if failed else 0

sys.exit(asyncio.run(main()))

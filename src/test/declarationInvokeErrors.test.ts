import { describe, expect, it } from "vitest";
import { readFunctionError } from "@/varer/lib/functionError";

/**
 * Ved ikke-2xx gir supabase.functions.invoke `data: null` og en
 * FunctionsHttpError der `context` er selve Response-objektet.
 * Testene etterligner nettopp det — ikke et ferdig utfylt data-objekt.
 */
function httpError(status: number, body: unknown, contentType = "application/json") {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: response,
  });
}

describe("feillesing fra functions.invoke", () => {
  it("leser kode og melding fra responsen når data er null", async () => {
    const err = httpError(400, { error: "Assistenten er ikke satt opp", code: "not_configured" });
    const payload = await readFunctionError(err, null);
    expect(payload.code).toBe("not_configured");
    expect(payload.message).toBe("Assistenten er ikke satt opp");
    expect(payload.status).toBe(400);
  });

  it("lar responsen leses videre av andre (clone)", async () => {
    const err = httpError(429, { error: "Grensen er brukt opp", code: "quota_exceeded" });
    await readFunctionError(err, null);
    const again = await readFunctionError(err, null);
    expect(again.code).toBe("quota_exceeded");
  });

  it("kjenner igjen de andre kodene", async () => {
    for (const code of ["encryption_missing", "provider_error", "bad_key", "bad_cap"]) {
      const payload = await readFunctionError(httpError(400, { code, error: "x" }), null);
      expect(payload.code).toBe(code);
    }
  });

  it("faller tilbake når kroppen ikke er JSON", async () => {
    const payload = await readFunctionError(httpError(500, "<html>feil</html>", "text/html"), null);
    expect(payload.code).toBeUndefined();
    expect(payload.status).toBe(500);
  });

  it("tolker 401/403 uten kropp som manglende tilgang", async () => {
    const payload = await readFunctionError(httpError(401, "", "text/plain"), null);
    expect(payload.code).toBe("forbidden");
  });

  it("klipper altfor lange meldinger og ignorerer feil typer", async () => {
    const payload = await readFunctionError(
      httpError(400, { error: "a".repeat(5000), code: 42 }),
      null,
    );
    expect(payload.message?.length).toBe(500);
    expect(payload.code).toBeUndefined();
  });

  it("bruker data når den unntaksvis er fylt ut", async () => {
    const payload = await readFunctionError(new Error("noe"), { code: "timeout", error: "Tok for lang tid" });
    expect(payload.code).toBe("timeout");
    expect(payload.message).toBe("Tok for lang tid");
  });

  it("tåler feil uten kontekst", async () => {
    const payload = await readFunctionError(new Error("nettverksfeil"), null);
    expect(payload.message).toBe("nettverksfeil");
    expect(payload.code).toBeUndefined();
  });
});

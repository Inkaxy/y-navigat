// ePOS-Print transport — POST rå XML til Epson TM-skriverens innebygde
// ePOS-Print Service (`/cgi-bin/epos/service.cgi`). Ingen Epson-SDK.
//
// Mixed-content-advarsel: hvis appen serveres over HTTPS og skriverens URL er
// HTTP, blokkerer nettleseren fetch-en før den når nettet. Vi gjenkjenner det
// og returnerer en spesifikk feilkode (`mixed_content`) for tydelig UI-melding.

export type PrinterEndpoint = {
  ip: string;
  port: number;
  protocol: "http" | "https";
  device_id: string;
};

export type EposPrintResult =
  | { kind: "ok"; raw: string }
  | { kind: "printer_error"; raw: string; success: string | null; code: string | null; status: string | null }
  | { kind: "http_error"; status: number; statusText: string }
  | { kind: "mixed_content"; pageProtocol: string; printerProtocol: string }
  | { kind: "network_error"; message: string };

export function buildTestXml(): string {
  const ts = new Date().toLocaleString("nb-NO");
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
 <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
  <text lang="no" font="font_a" align="center"/>
  <text>NBOS testutskrift&#10;</text>
  <text>${escapeXml(ts)}&#10;</text>
  <feed line="1"/>
  <cut type="feed"/>
 </epos-print>
</s:Body></s:Envelope>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]!);
}

export function buildEndpointUrl(p: PrinterEndpoint, timeoutMs = 10000): string {
  const portPart =
    (p.protocol === "http" && p.port === 80) || (p.protocol === "https" && p.port === 443)
      ? ""
      : `:${p.port}`;
  return `${p.protocol}://${p.ip}${portPart}/cgi-bin/epos/service.cgi?devid=${encodeURIComponent(
    p.device_id,
  )}&timeout=${timeoutMs}`;
}

export function detectMixedContent(p: PrinterEndpoint): { blocked: boolean; pageProtocol: string } {
  const pageProtocol = typeof window !== "undefined" ? window.location.protocol.replace(":", "") : "http";
  const blocked = pageProtocol === "https" && p.protocol === "http";
  return { blocked, pageProtocol };
}

/** Send rå ePOS-Print XML til skriveren og tolk svaret. */
export async function eposPrint(p: PrinterEndpoint, xml: string): Promise<EposPrintResult> {
  const { blocked, pageProtocol } = detectMixedContent(p);
  if (blocked) {
    return { kind: "mixed_content", pageProtocol, printerProtocol: p.protocol };
  }

  const url = buildEndpointUrl(p);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": '""',
      },
      body: xml,
    });
  } catch (e) {
    // Browser CORS/mixed-content/connection-reset gir alle "TypeError: Failed to fetch".
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "network_error", message: msg };
  }

  const raw = await resp.text();

  if (!resp.ok) {
    return { kind: "http_error", status: resp.status, statusText: resp.statusText };
  }

  // Parse <response success="true|false" code="..." status="..."/>
  const m = raw.match(/<response\b([^/>]*)\/?>/i);
  if (m) {
    const attrs = m[1] || "";
    const success = /success\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? null;
    const code = /code\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? null;
    const status = /status\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? null;
    if (success !== "true") {
      return { kind: "printer_error", raw, success, code, status };
    }
  }

  return { kind: "ok", raw };
}

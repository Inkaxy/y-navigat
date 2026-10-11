/**
 * Streng lesing av `rm_apply_agreement`-svaret (live kontrakt: eneste suksessgren
 * `{ok:true, link_id:uuid, agreed_price:number|null, agreed_price_per_base_unit:number|null, is_primary:boolean}`).
 * Alt annet er ukjent utfall — aldri «lagret».
 */
export interface AppliedAgreement {
  linkId: string;
  agreedPrice: number | null;
  agreedPricePerBaseUnit: number | null;
  isPrimary: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function priceField(o: Record<string, unknown>, k: string): { ok: true; v: number | null } | { ok: false } {
  if (!Object.prototype.hasOwnProperty.call(o, k)) return { ok: false };
  const v = o[k];
  if (v === null) return { ok: true, v: null };
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return { ok: true, v };
  return { ok: false };
}

export function parseApplyAgreementResult(data: unknown): AppliedAgreement | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.ok !== true) return null;
  if (typeof o.link_id !== "string" || !UUID.test(o.link_id)) return null;
  if (typeof o.is_primary !== "boolean") return null;
  const a = priceField(o, "agreed_price");
  const b = priceField(o, "agreed_price_per_base_unit");
  if (!a.ok || !b.ok) return null;
  return { linkId: o.link_id, agreedPrice: a.v, agreedPricePerBaseUnit: b.v, isPrimary: o.is_primary };
}

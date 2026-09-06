import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Loader2,
  Truck,
  Package,
  FileText,
  Tags,
  Search,
  ArrowUpDown,
  AlertTriangle,
} from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { InvoiceStatusBadge } from "@/fakturaer/components/InvoiceStatusBadge";
import { formatNok, formatDate, formatNumber } from "@/ravarer/lib/constants";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import {
  useSupplier,
  useSupplierItems,
  useSupplierInvoices,
  useSupplierSpend,
  useSupplierAliases,
  useUpdateSupplierNotes,
} from "@/ravarer/hooks/useSupplierDetail";

type ItemSort = { key: "name" | "price"; dir: "asc" | "desc" };

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-ink-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-primary">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-secondary">{hint}</p>}
    </Card>
  );
}

function EmptyTab({ icon: Icon, text }: { icon: typeof Package; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <Icon className="mb-3 h-10 w-10 text-ink-secondary" />
      <p className="text-ink-secondary">{text}</p>
    </div>
  );
}

export default function LeverandorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canWrite } = useRavarer();

  const { data: supplier, isLoading } = useSupplier(id);
  const { data: items = [], isLoading: itemsLoading } = useSupplierItems(id);
  const [invoiceLimit, setInvoiceLimit] = useState(50);
  const { data: invoiceData, isLoading: invoicesLoading } = useSupplierInvoices(id, invoiceLimit);
  const { data: spend } = useSupplierSpend(id);
  const linkIds = useMemo(() => items.map((i) => i.id), [items]);
  const { data: aliases = [], isLoading: aliasesLoading } = useSupplierAliases(linkIds);

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const saveNotes = useUpdateSupplierNotes(id);
  useEffect(() => {
    if (supplier && !notesDirty) setNotes(supplier.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, supplier?.notes]);

  const [itemSort, setItemSort] = useState<ItemSort>({ key: "name", dir: "asc" });
  const [aliasSearch, setAliasSearch] = useState("");

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      let cmp = 0;
      if (itemSort.key === "name") {
        cmp = (a.raw_material?.name ?? "").localeCompare(b.raw_material?.name ?? "", "nb");
      } else {
        cmp = Number(a.agreed_price_per_base_unit ?? -1) - Number(b.agreed_price_per_base_unit ?? -1);
      }
      return itemSort.dir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [items, itemSort]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const filteredAliases = useMemo(() => {
    const q = aliasSearch.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter((a) => {
      const item = itemById.get(a.raw_material_supplier_id);
      return (
        a.alias_value.toLowerCase().includes(q) ||
        (item?.raw_material?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [aliases, aliasSearch, itemById]);

  function toggleSort(key: ItemSort["key"]) {
    setItemSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-ink-secondary">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
      </div>
    );
  }

  if (!supplier) {
    return (
      <Card className="p-12 text-center">
        <Truck className="mx-auto mb-3 h-10 w-10 text-ink-secondary" />
        <p className="text-ink-secondary">Fant ikke leverandøren.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/ravarer/leverandorer")}>
          Tilbake til leverandører
        </Button>
      </Card>
    );
  }

  const invoices = invoiceData?.rows ?? [];
  const invoiceTotal = invoiceData?.total ?? 0;

  return (
    <div className="space-y-5">
      <RavarerHeaderBanner
        title={supplier.name}
        subtitle="Leverandørkort — varer, fakturaer og aliaser"
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/ravarer/leverandorer")}>
            <ArrowLeft className="h-4 w-4" /> Tilbake
          </Button>
        }
      />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {supplier.tripletex_is_inactive ? (
            <Badge variant="outline" className="text-ink-secondary">Inaktiv i Tripletex</Badge>
          ) : supplier.is_active ? (
            <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Aktiv</Badge>
          ) : (
            <Badge variant="outline" className="text-ink-secondary">Inaktiv</Badge>
          )}
          {supplier.track_invoice_lines && (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              Følger fakturalinjer
            </Badge>
          )}
          {supplier.tripletex_supplier_number && (
            <Badge variant="outline" className="text-ink-secondary">
              Tripletex #{supplier.tripletex_supplier_number}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Org.nr</p>
            <p className="font-mono text-sm">{supplier.org_number ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">E-post</p>
            {supplier.contact_email ? (
              <a href={`mailto:${supplier.contact_email}`} className="text-sm text-primary hover:underline">
                {supplier.contact_email}
              </a>
            ) : (
              <p className="text-sm text-ink-secondary">—</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Telefon</p>
            {supplier.contact_phone ? (
              <a href={`tel:${supplier.contact_phone}`} className="text-sm text-primary hover:underline">
                {supplier.contact_phone}
              </a>
            ) : (
              <p className="text-sm text-ink-secondary">—</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Notater</p>
          <Textarea
            value={notes}
            disabled={!canWrite}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            placeholder="Avtalevilkår, kontaktpersoner, leveringsdager …"
            rows={3}
          />
          {canWrite && notesDirty && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saveNotes.isPending}
                onClick={() => saveNotes.mutate(notes, { onSuccess: () => setNotesDirty(false) })}
              >
                {saveNotes.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Lagre notat
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNotes(supplier.notes ?? "");
                  setNotesDirty(false);
                }}
              >
                Avbryt
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Fakturaer" value={String(supplier.invoice_count ?? invoiceTotal ?? 0)} />
        <Kpi label="Siste faktura" value={formatDate(supplier.last_invoice_date)} />
        <Kpi label="Varer koblet" value={String(items.length)} />
        <Kpi label="Kjøpt siste 12 mnd (eks. mva)" value={formatNok(spend ?? 0)} hint="Fakturabeløp eks. mva, kreditnotaer trukket fra" />
      </div>

      <Tabs defaultValue="varer">
        <TabsList>
          <TabsTrigger value="varer">Varer ({items.length})</TabsTrigger>
          <TabsTrigger value="fakturaer">Fakturaer ({invoiceTotal})</TabsTrigger>
          <TabsTrigger value="aliaser">Aliaser ({aliases.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="varer">
          <Card className="overflow-hidden">
            {itemsLoading ? (
              <div className="flex items-center justify-center p-12 text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            ) : items.length === 0 ? (
              <EmptyTab icon={Package} text="Ingen varer er koblet til denne leverandøren ennå." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                    <tr>
                      <th className="px-4 py-3">
                        <button className="inline-flex items-center gap-1" onClick={() => toggleSort("name")}>
                          Vare <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3">Leverandørens SKU</th>
                      <th className="px-4 py-3">Pakning</th>
                      <th className="px-4 py-3 text-right">
                        <button className="inline-flex items-center gap-1" onClick={() => toggleSort("price")}>
                          Avtalepris/baseenhet <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-4 py-3 text-right">Siste kjøpspris</th>
                      <th className="px-4 py-3">Avtale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((r) => {
                      const hasAgreement = r.agreed_price_per_base_unit != null;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => navigate(`/ravarer/vareliste/${r.raw_material_id}`)}
                          className="cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40"
                        >
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/ravarer/vareliste/${r.raw_material_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:underline"
                              >
                                {r.raw_material?.name ?? "—"}
                              </Link>
                              <ItemTypeBadge itemType={r.raw_material?.item_type ?? null} />
                            </div>
                            {r.supplier_product_name && (
                              <p className="text-xs text-ink-secondary">{r.supplier_product_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{r.supplier_sku ?? "—"}</td>
                          <td className="px-4 py-3 text-ink-secondary">
                            {r.package_size != null
                              ? `${formatNumber(r.package_size)} ${r.package_unit ?? ""}`.trim()
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatNok(r.agreed_price_per_base_unit)}
                            {r.raw_material?.base_unit && r.agreed_price_per_base_unit != null && (
                              <span className="text-xs text-ink-secondary"> /{r.raw_material.base_unit}</span>
                            )}
                            {(r.agreement_valid_from || r.agreement_valid_to) && (
                              <p className="text-xs text-ink-secondary">
                                {formatDate(r.agreement_valid_from)} – {formatDate(r.agreement_valid_to)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatNok(r.last_invoice_price)}
                            {r.last_invoice_date && (
                              <p className="text-xs text-ink-secondary">{formatDate(r.last_invoice_date)}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {hasAgreement ? (
                              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                                Avtale
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-ink-secondary">Ingen avtale</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="fakturaer">
          <Card className="overflow-hidden">
            {invoicesLoading ? (
              <div className="flex items-center justify-center p-12 text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            ) : invoices.length === 0 ? (
              <EmptyTab icon={FileText} text="Det er ikke hentet inn noen fakturaer fra denne leverandøren ennå." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                      <tr>
                        <th className="px-4 py-3">Fakturanr</th>
                        <th className="px-4 py-3">Dato</th>
                        <th className="px-4 py-3 text-right">Beløp</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr
                          key={inv.id}
                          onClick={() => navigate(`/ravarer/fakturaer/${inv.id}`)}
                          className="cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40"
                        >
                          <td className="px-4 py-3 font-mono text-xs">
                            <Link
                              to={`/ravarer/fakturaer/${inv.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-primary hover:underline"
                            >
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-ink-secondary">{formatDate(inv.invoice_date)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNok(inv.total_amount)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <InvoiceStatusBadge status={inv.status} />
                              {inv.lines_sum_status === "mismatch" && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-warning/30 bg-warning/15 text-warning"
                                  title="Varelinjene summerer seg ikke til fakturabeløpet"
                                >
                                  <AlertTriangle className="h-3 w-3" /> Sum-avvik
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-line-subtle px-4 py-3 text-sm text-ink-secondary">
                  <span>
                    Viser {invoices.length} av {invoiceTotal}
                  </span>
                  {invoices.length < invoiceTotal && (
                    <Button size="sm" variant="outline" onClick={() => setInvoiceLimit((l) => l + 50)}>
                      Vis flere
                    </Button>
                  )}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="aliaser">
          <Card className="overflow-hidden">
            <div className="border-b border-line-subtle p-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <Input
                  value={aliasSearch}
                  onChange={(e) => setAliasSearch(e.target.value)}
                  placeholder="Søk alias eller vare…"
                  className="pl-9"
                />
              </div>
            </div>
            {aliasesLoading ? (
              <div className="flex items-center justify-center p-12 text-ink-secondary">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
              </div>
            ) : aliases.length === 0 ? (
              <EmptyTab
                icon={Tags}
                text="Ingen aliaser er registrert — aliaser lages når fakturalinjer kobles til varer."
              />
            ) : filteredAliases.length === 0 ? (
              <EmptyTab icon={Search} text="Ingen aliaser matcher søket." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                    <tr>
                      <th className="px-4 py-3">Alias</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Peker på vare</th>
                      <th className="px-4 py-3 text-right">Treff</th>
                      <th className="px-4 py-3">Sist sett</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAliases.map((a) => {
                      const item = itemById.get(a.raw_material_supplier_id);
                      return (
                        <tr key={a.id} className="border-t border-line-subtle">
                          <td className="px-4 py-3 font-mono text-xs">{a.alias_value}</td>
                          <td className="px-4 py-3 text-ink-secondary">
                            {a.alias_type === "supplier_sku" ? "SKU" : a.alias_type === "product_name" ? "Navn" : a.alias_type}
                          </td>
                          <td className="px-4 py-3">
                            {item ? (
                              <Link
                                to={`/ravarer/vareliste/${item.raw_material_id}`}
                                className="text-primary hover:underline"
                              >
                                {item.raw_material?.name ?? "—"}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{a.match_count ?? 0}</td>
                          <td className="px-4 py-3 text-ink-secondary">{formatDate(a.last_seen_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

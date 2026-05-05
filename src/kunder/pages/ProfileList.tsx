import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserCog, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppBanner } from "@/kunder/components/shell/AppBanner";
import { useSelectedEntity, ALL_ENTITIES } from "@/kunder/state/SelectedEntityContext";
import {
  useCustomerProfiles,
  useProfileCustomerCounts,
} from "@/kunder/hooks/useCustomerProfiles";
import { NewProfileDialog } from "@/kunder/components/profiles/NewProfileDialog";
import {
  CreatePriceListPrompt,
  type NewProfileSeed,
} from "@/kunder/components/profiles/CreatePriceListPrompt";
import { useUserAccess } from "@/kunder/hooks/useUserAccess";
import { useAuth } from "@/hooks/useAuth";

export default function ProfileList() {
  const navigate = useNavigate();
  const { selected } = useSelectedEntity();
  const { user } = useAuth();
  const { data: access } = useUserAccess(user);
  const { data: profiles, isLoading } = useCustomerProfiles(selected);
  const { data: counts } = useProfileCustomerCounts(selected);
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [createdProfile, setCreatedProfile] = useState<NewProfileSeed | null>(null);

  const canWrite = !!access?.hasKunderWrite;
  const showEntity = selected === ALL_ENTITIES;

  const entityById = new Map<string, string>(
    (access?.entities ?? []).map((e) => [e.id, e.short_code] as [string, string]),
  );

  return (
    <div>
      <AppBanner
        icon={UserCog}
        title="Kundeprofiler"
        subtitle="Maler for kunde-opprettelse — definerer fakturering, pris og utkjøring"
        actions={
          canWrite && selected && selected !== ALL_ENTITIES ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Ny profil
            </Button>
          ) : null
        }
      />

      <div className="container py-6">
        {selected === ALL_ENTITIES && (
          <p className="mb-4 text-sm text-muted-foreground">
            Profiler er per selskap. Velg et spesifikt selskap for å opprette nye.
          </p>
        )}

        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Navn</TableHead>
                {showEntity && <TableHead>Selskap</TableHead>}
                <TableHead className="text-right">Neste kundenr</TableHead>
                <TableHead className="text-right">Antall kunder</TableHead>
                <TableHead>Privatperson</TableHead>
                <TableHead className="text-right">Bet.bet.</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={showEntity ? 8 : 7} className="py-8 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && (profiles ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={showEntity ? 8 : 7}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Ingen profiler ennå. Opprett den første for å komme i gang.
                  </TableCell>
                </TableRow>
              )}
              {(profiles ?? []).map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/kunder/profiler/${p.id}`)}
                >
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">{p.display_name}</TableCell>
                  {showEntity && (
                    <TableCell className="text-xs text-muted-foreground">
                      {entityById.get(p.legal_entity_id) ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono">
                    {p.next_customer_number}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {counts?.[p.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    {p.is_private_person_default ? (
                      <Badge variant="outline">Ja</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Nei</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.payment_terms_days ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        p.status === "active"
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }
                    >
                      {p.status === "active" ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {selected && selected !== ALL_ENTITIES && (
        <NewProfileDialog
          open={open}
          onOpenChange={setOpen}
          legalEntityId={selected}
          onCreated={(p) => {
            setCreatedProfile(p);
            setPromptOpen(true);
          }}
        />
      )}

      <CreatePriceListPrompt
        open={promptOpen}
        onOpenChange={setPromptOpen}
        profile={createdProfile}
        onDone={() => {
          const id = createdProfile?.id;
          setCreatedProfile(null);
          if (id) navigate(`/kunder/profiler/${id}`);
        }}
      />
    </div>
  );
}

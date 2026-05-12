import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SettingsAccordion } from "./SettingsAccordion";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // forwarded
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  setMarginTop: (v: number) => void;
  setMarginRight: (v: number) => void;
  setMarginBottom: (v: number) => void;
  setMarginLeft: (v: number) => void;
  paperWidth: number;
  paperHeight: number;
  setPaperWidth: (v: number) => void;
  setPaperHeight: (v: number) => void;
  companyName: string;
  setCompanyName: (v: string) => void;
  companyNote: string;
  setCompanyNote: (v: string) => void;
  logoUrl: string | null;
  setLogoUrl: (v: string | null) => void;
  logoHeight: number | "";
  setLogoHeight: (v: number | "") => void;
  logoUploading: boolean;
  onLogoFileSelected: (file: File) => void;
  commentFt1: boolean;
  commentFt2: boolean;
  commentFt3: boolean;
  setCommentFt1: (v: boolean) => void;
  setCommentFt2: (v: boolean) => void;
  setCommentFt3: (v: boolean) => void;
  includeFieldLabels: boolean;
  setIncludeFieldLabels: (v: boolean) => void;
  fieldLabelsBold: boolean;
  setFieldLabelsBold: (v: boolean) => void;
  skipLeveresHentes: boolean;
  setSkipLeveresHentes: (v: boolean) => void;
  includeRouteName: boolean;
  setIncludeRouteName: (v: boolean) => void;
  notes: string;
  setNotes: (v: string) => void;
}

export function SettingsSheet({ open, onOpenChange, ...rest }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] overflow-y-auto sm:max-w-none">
        <SheetHeader className="mb-4">
          <SheetTitle>Profil-innstillinger</SheetTitle>
          <SheetDescription>
            Papir, marger, firma, logo og globale visningsvalg.
          </SheetDescription>
        </SheetHeader>
        <SettingsAccordion {...rest} />
      </SheetContent>
    </Sheet>
  );
}

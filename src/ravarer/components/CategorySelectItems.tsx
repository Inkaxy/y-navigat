import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { categoryGroups } from "@/ravarer/lib/categories";

interface Props {
  /** Eksisterende verdier fra data som skal unioneres inn (så ingen vare mister kategorien sin). */
  existing?: readonly (string | null | undefined)[];
  /** Legg til «+ Ny kategori…» nederst med verdien `__new__`. */
  allowNew?: boolean;
}

export const NEW_CATEGORY_VALUE = "__new__";

/** Grupperte kategorivalg for bruk inne i <SelectContent>. */
export function CategorySelectItems({ existing = [], allowNew = false }: Props) {
  return (
    <>
      {categoryGroups(existing).map((g) => (
        <SelectGroup key={g.label}>
          <SelectLabel>{g.label}</SelectLabel>
          {g.items.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectGroup>
      ))}
      {allowNew && (
        <SelectGroup>
          <SelectLabel>Unntak</SelectLabel>
          <SelectItem value={NEW_CATEGORY_VALUE}>+ Ny kategori…</SelectItem>
        </SelectGroup>
      )}
    </>
  );
}

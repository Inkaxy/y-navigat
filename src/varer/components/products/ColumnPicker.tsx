import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3 } from "lucide-react";

export type ColumnOption = {
  key: string;
  label: string;
  fixed?: boolean;
};

type Props = {
  columns: ColumnOption[];
  visible: string[];
  onChange: (next: string[]) => void;
  onReset: () => void;
};

export function ColumnPicker({ columns, visible, onChange, onReset }: Props) {
  const toggle = (key: string) => {
    if (visible.includes(key)) onChange(visible.filter((k) => k !== key));
    else onChange([...visible, key]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="h-4 w-4" /> Kolonner
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Vis kolonner
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {columns.map((col) => {
            const checked = col.fixed || visible.includes(col.key);
            return (
              <label
                key={col.key}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  col.fixed ? "opacity-60" : "cursor-pointer hover:bg-accent"
                }`}
              >
                <Checkbox
                  checked={checked}
                  disabled={col.fixed}
                  onCheckedChange={() => !col.fixed && toggle(col.key)}
                />
                <span>{col.label}</span>
                {col.fixed && (
                  <span className="ml-auto text-[10px] uppercase text-muted-foreground">fast</span>
                )}
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            Tilbakestill
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

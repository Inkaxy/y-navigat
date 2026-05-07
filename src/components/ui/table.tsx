import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * NBhub-tabell — paper-feel rader, eyebrow-headere, sticky-støtte og bronze
 * selection-aksent. API-kompatibel med shadcn/ui sin Table — ingen kalle-side
 * må endres. Nye props:
 *   - <Table density="comfortable|compact">          (default comfortable)
 *   - <TableHeader sticky>                            (kleber til toppen)
 *   - <TableRow interactive>                          (cursor-pointer + sterkere hover)
 */

type Density = "comfortable" | "compact";
const DensityCtx = React.createContext<Density>("comfortable");

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  density?: Density;
  /** Pakk inn i et kort med ramme + skygge (paper-feel). Default true. */
  card?: boolean;
  wrapperClassName?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = "comfortable", card = true, wrapperClassName, ...props }, ref) => {
    const inner = (
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    );
    return (
      <DensityCtx.Provider value={density}>
        {card ? (
          <div
            className={cn(
              "relative w-full overflow-auto rounded-xl border border-line-subtle bg-card",
              "shadow-[var(--shadow-xs)]",
              wrapperClassName,
            )}
          >
            {inner}
          </div>
        ) : (
          <div className={cn("relative w-full overflow-auto", wrapperClassName)}>{inner}</div>
        )}
      </DensityCtx.Provider>
    );
  },
);
Table.displayName = "Table";

interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  sticky?: boolean;
}

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, sticky, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "[&_tr]:border-b [&_tr]:border-line-subtle bg-muted/40",
        sticky && "sticky top-0 z-10 backdrop-blur",
        className,
      )}
      {...props}
    />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        "border-t border-line-subtle bg-muted/30 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  ),
);
TableFooter.displayName = "TableFooter";

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-line-subtle transition-colors",
        // Bronze selection-aksent
        "data-[state=selected]:bg-[hsl(var(--brand-bronze)/0.08)]",
        "data-[state=selected]:shadow-[inset_3px_0_0_0_hsl(var(--brand-bronze))]",
        // Hover
        interactive
          ? "cursor-pointer hover:bg-muted/60"
          : "hover:bg-muted/40",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(DensityCtx);
    return (
      <th
        ref={ref}
        className={cn(
          density === "compact" ? "h-9 px-3" : "h-11 px-4",
          "text-left align-middle text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
          "[&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      />
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(DensityCtx);
    return (
      <td
        ref={ref}
        className={cn(
          density === "compact" ? "px-3 py-2" : "px-4 py-3",
          "align-middle [&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      />
    );
  },
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };

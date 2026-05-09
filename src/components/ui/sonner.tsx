import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:rounded-[10px] group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-popover-foreground/70",
          actionButton:
            "group-[.toast]:bg-brand-bronze group-[.toast]:text-brand-cream",
          cancelButton:
            "group-[.toast]:bg-accent group-[.toast]:text-accent-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

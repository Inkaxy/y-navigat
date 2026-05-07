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
            "group toast group-[.toaster]:bg-brand-ink group-[.toaster]:text-brand-cream group-[.toaster]:border group-[.toaster]:border-brand-bronze/30 group-[.toaster]:rounded-[10px] group-[.toaster]:shadow-[0_12px_32px_-8px_hsl(0_0%_0%/0.45)]",
          description: "group-[.toast]:text-brand-cream/70",
          actionButton:
            "group-[.toast]:bg-brand-bronze group-[.toast]:text-brand-cream",
          cancelButton:
            "group-[.toast]:bg-brand-cream/10 group-[.toast]:text-brand-cream/80",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

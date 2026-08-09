// «Rediger ordren» fra henvendelsen: åpner den eksisterende CustomerOrderModal
// i redigeringsmodus for den koblede ordren.
import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCustomerById } from "@/ordre/hooks/useNBCustomers";
import { CustomerOrderModal } from "@/ordre/components/orders/CustomerOrderModal";

export default function EditLinkedOrderButton({
  orderId,
  customerId,
  onSaved,
}: {
  orderId: string;
  customerId: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: customer, isLoading } = useCustomerById(open ? customerId : null);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-full gap-2"
        disabled={!customerId}
        onClick={() => setOpen(true)}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Pencil className="h-3.5 w-3.5" />
        )}
        Rediger ordren
      </Button>

      {open && customer && (
        <CustomerOrderModal
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) onSaved();
          }}
          customer={customer}
          orderId={orderId}
        />
      )}
    </>
  );
}

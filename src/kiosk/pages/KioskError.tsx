import { ErrorFullScreen } from "@/kiosk/components/ErrorFullScreen";

export default function KioskError({ reason }: { reason?: string }) {
  return (
    <ErrorFullScreen
      title="Kiosk-feil"
      message={reason ?? "En uventet feil oppstod i Kiosk."}
    />
  );
}

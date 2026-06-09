export const kioskRoutes = {
  operator: (terminalId: string) => `/kiosk/o/${terminalId}`,
  customer: (terminalId: string) => `/kiosk/k/${terminalId}`,
};

export const KIOSK_REALTIME_CHANNEL = (terminalId: string) => `kiosk:${terminalId}`;

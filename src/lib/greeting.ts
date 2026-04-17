export function getTimeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "God natt";
  if (h < 11) return "God morgen";
  if (h < 17) return "God dag";
  return "God kveld";
}

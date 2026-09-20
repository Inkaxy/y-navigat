// Ett sted for XML-parseren, slik at edge-koden kan kjøres i tester uten at
// Deno-URL-importen må lastes av Node sin ESM-laster.
export { parse } from "https://deno.land/x/xml@2.1.3/mod.ts";

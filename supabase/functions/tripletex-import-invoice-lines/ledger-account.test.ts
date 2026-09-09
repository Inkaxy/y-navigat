import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickLedgerAccount } from "./ledger-account.ts";

Deno.test("én kostnadskonto velges", () => {
  assertEquals(
    pickLedgerAccount([
      { account: { number: 2400 }, amountGross: -1000 },
      { account: { number: 4300 }, amountGross: 800 },
      { account: { number: "4300" }, amountGross: 200 },
    ]),
    "4300",
  );
});

Deno.test("flere ulike kostnadskontoer gir ingen konto", () => {
  assertEquals(
    pickLedgerAccount([{ account: { number: 4300 } }, { account: { number: 6540 } }]),
    null,
  );
});

Deno.test("ingen kostnadskonto gir null", () => {
  assertEquals(pickLedgerAccount([{ account: { number: 2400 } }, { account: null }]), null);
});

Deno.test("ugyldig inndata gir null", () => {
  assertEquals(pickLedgerAccount(null), null);
  assertEquals(pickLedgerAccount([]), null);
  assertEquals(pickLedgerAccount([{ account: { number: "abc" } }]), null);
});

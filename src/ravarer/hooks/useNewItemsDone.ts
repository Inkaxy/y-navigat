import { useSyncExternalStore } from "react";
import { createDoneStore, type DoneEntry } from "@/ravarer/lib/fraFaktura/newItemsDone";
import type { NewItemReceipt } from "@/ravarer/hooks/useNewItemActions";

/** Ferdige svar i Nye varer for denne fanen (til siden lastes på nytt). Brukes av listen, kvitteringene og tellerne. */
export const newItemsDoneStore = createDoneStore<NewItemReceipt>();

export function useNewItemsDone(le: string | null): readonly DoneEntry<NewItemReceipt>[] {
  return useSyncExternalStore(newItemsDoneStore.subscribe, () => newItemsDoneStore.list(le), () => newItemsDoneStore.list(le));
}

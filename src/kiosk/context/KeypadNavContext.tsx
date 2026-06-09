import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Ctx {
  rootPageId: string | null;
  currentPageId: string | null;
  canGoBack: boolean;
  navigateTo: (pageId: string) => void;
  replaceTo: (pageId: string) => void;
  goBack: () => void;
  reset: () => void;
}

const C = createContext<Ctx | null>(null);

export function KeypadNavProvider({
  rootPageId,
  children,
}: {
  rootPageId: string | null;
  children: ReactNode;
}) {
  const [stack, setStack] = useState<string[]>(rootPageId ? [rootPageId] : []);

  // Hvis rootPageId endrer seg (nytt layout), reset stack.
  useEffect(() => {
    setStack(rootPageId ? [rootPageId] : []);
  }, [rootPageId]);

  const navigateTo = useCallback((id: string) => setStack((s) => [...s, id]), []);
  const replaceTo = useCallback((id: string) => setStack([id]), []);
  const goBack = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  );
  const reset = useCallback(
    () => setStack(rootPageId ? [rootPageId] : []),
    [rootPageId],
  );

  const value = useMemo<Ctx>(
    () => ({
      rootPageId,
      currentPageId: stack[stack.length - 1] ?? rootPageId,
      canGoBack: stack.length > 1,
      navigateTo,
      replaceTo,
      goBack,
      reset,
    }),
    [rootPageId, stack, navigateTo, replaceTo, goBack, reset],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useKeypadNav() {
  const v = useContext(C);
  if (!v) throw new Error("useKeypadNav must be used inside KeypadNavProvider");
  return v;
}

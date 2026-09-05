// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useUnsavedChangesGuard", () => {
  it("kjører handlingen direkte når ingenting er ulagret", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(false), { wrapper });

    act(() => result.current.requestAction(action));

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.isBlocked).toBe(false);
  });

  it("blokkerer handlingen når det finnes ulagrede endringer", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true), { wrapper });

    act(() => result.current.requestAction(action));

    expect(action).not.toHaveBeenCalled();
    expect(result.current.isBlocked).toBe(true);
    expect(result.current.dialogProps.open).toBe(true);
  });

  it("«Forkast endringer» kjører handlingen og varsler onDiscard", () => {
    const action = vi.fn();
    const onDiscard = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, onDiscard), { wrapper });

    act(() => result.current.requestAction(action));
    act(() => result.current.discard());

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.isBlocked).toBe(false);
  });

  it("«Bli på siden» avbryter handlingen", () => {
    const action = vi.fn();
    const onDiscard = vi.fn();
    const { result } = renderHook(() => useUnsavedChangesGuard(true, onDiscard), { wrapper });

    act(() => result.current.requestAction(action));
    act(() => result.current.stay());

    expect(action).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(result.current.isBlocked).toBe(false);
  });

  it("slutter å blokkere når endringene er lagret", () => {
    const action = vi.fn();
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useUnsavedChangesGuard(dirty),
      { wrapper, initialProps: { dirty: true } },
    );

    rerender({ dirty: false });
    act(() => result.current.requestAction(action));

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.isBlocked).toBe(false);
  });
});

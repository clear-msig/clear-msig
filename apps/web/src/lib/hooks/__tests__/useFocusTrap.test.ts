import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "../useFocusTrap";

vi.mock("react", () => ({ useEffect: vi.fn() }));

function harness() {
  let focused: HTMLElement | null = null;
  let keydown: ((event: KeyboardEvent) => void) | undefined;
  let cleanup: (() => void) | undefined;
  const element = (visible = true, disabled = false) => {
    const value = {
      offsetParent: visible ? {} : null,
      hasAttribute: (name: string) => name === "disabled" && disabled,
      focus: vi.fn(() => { focused = value; }),
    } as unknown as HTMLElement;
    return value;
  };
  const trigger = element();
  const heading = element();
  const first = element();
  const last = element();
  const hidden = element(false);
  const disabled = element(true, true);
  focused = trigger;
  const container = {
    querySelector: () => heading,
    querySelectorAll: () => [hidden, first, last, disabled],
    focus: vi.fn(),
  } as unknown as HTMLElement;
  vi.stubGlobal("document", {
    get activeElement() { return focused; },
    contains: () => true,
    addEventListener: (_name: string, handler: typeof keydown) => { keydown = handler; },
    removeEventListener: () => { keydown = undefined; },
  });
  vi.mocked(useEffect).mockImplementation((effect) => {
    cleanup = effect() || undefined;
  });
  function useActivate(active = true) {
    useFocusTrap({ current: container }, active);
  }
  return {
    heading, first, last, trigger, hidden, disabled, container,
    activate: useActivate,
    focus: (value: HTMLElement) => { focused = value; },
    get focused() { return focused; },
    get listening() { return !!keydown; },
    close: () => cleanup?.(),
    tab(shiftKey = false) {
      const event = { key: "Tab", shiftKey, preventDefault: vi.fn() };
      keydown?.(event as unknown as KeyboardEvent);
      return event;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("modal focus trap", () => {
  it("wraps Shift+Tab from the initially focused heading", () => {
    const dialog = harness();
    dialog.activate();
    expect(dialog.focused).toBe(dialog.heading);
    expect(dialog.tab(true).preventDefault).toHaveBeenCalledOnce();
    expect(dialog.focused).toBe(dialog.last);
  });

  it("moves forward from initial heading focus into the first control", () => {
    const dialog = harness();
    dialog.activate();
    expect(dialog.tab().preventDefault).toHaveBeenCalledOnce();
    expect(dialog.focused).toBe(dialog.first);
  });

  it("recovers focus that moved outside the modal in either direction", () => {
    const dialog = harness();
    dialog.activate();
    dialog.focus(dialog.trigger);
    dialog.tab();
    expect(dialog.focused).toBe(dialog.first);
    dialog.focus(dialog.trigger);
    dialog.tab(true);
    expect(dialog.focused).toBe(dialog.last);
  });

  it("wraps at each end without including hidden or disabled controls", () => {
    const dialog = harness();
    dialog.activate();
    dialog.focus(dialog.first);
    dialog.tab(true);
    expect(dialog.focused).toBe(dialog.last);
    dialog.tab();
    expect(dialog.focused).toBe(dialog.first);
    expect(dialog.hidden.focus).not.toHaveBeenCalled();
    expect(dialog.disabled.focus).not.toHaveBeenCalled();
  });

  it("leaves normal tab navigation alone between controls", () => {
    const dialog = harness();
    dialog.activate();
    dialog.focus(dialog.first);
    expect(dialog.tab().preventDefault).not.toHaveBeenCalled();
    dialog.focus(dialog.last);
    expect(dialog.tab(true).preventDefault).not.toHaveBeenCalled();
  });

  it("restores the trigger and removes the listener on dismissal", () => {
    const dialog = harness();
    dialog.activate();
    dialog.close();
    expect(dialog.focused).toBe(dialog.trigger);
    expect(dialog.listening).toBe(false);
  });

  it("does not move focus or listen while closed", () => {
    const dialog = harness();
    dialog.activate(false);
    expect(dialog.focused).toBe(dialog.trigger);
    expect(dialog.listening).toBe(false);
  });
});

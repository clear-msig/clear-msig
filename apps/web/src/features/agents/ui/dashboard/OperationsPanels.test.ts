import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KillSwitchPanel } from "./OperationsPanels";

describe("dashboard emergency-stop availability", () => {
  it.each([
    { paused: false, pending: false, resumeBlocked: false, disabled: false },
    { paused: false, pending: false, resumeBlocked: true, disabled: false },
    { paused: false, pending: true, resumeBlocked: false, disabled: true },
    { paused: false, pending: true, resumeBlocked: true, disabled: true },
    { paused: true, pending: false, resumeBlocked: false, disabled: false },
    { paused: true, pending: false, resumeBlocked: true, disabled: true },
    { paused: true, pending: true, resumeBlocked: false, disabled: true },
    { paused: true, pending: true, resumeBlocked: true, disabled: true },
  ])("paused=$paused kill-switch-pending=$pending other-work-pending=$resumeBlocked", ({ disabled, ...props }) => {
    const html = renderToStaticMarkup(createElement(KillSwitchPanel, {
      ...props, executorState: "ready", handoff: null, onToggle: vi.fn(),
    }));
    const button = html.match(/<button\b([^>]*)>/)?.[1];
    expect(button).toBeDefined();
    expect(button?.includes('disabled=""')).toBe(disabled);
    expect(html).toContain(props.paused ? "Allow trading again" : "Stop all trading");
  });
});

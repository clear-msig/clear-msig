import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeSigningReviewInvalidation } from "../reviewEvents";

describe("signing review input invalidation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("revokes stale review synchronously without rendering ahead of the input handler", async () => {
    const target = new EventTarget();
    let revision = 0;
    let draft = "old";
    const capturedRevision = revision;
    const refresh = vi.fn(() => expect(draft).toBe("edited"));
    const stop = subscribeSigningReviewInvalidation(
      target,
      () => {
        revision += 1;
      },
      refresh,
    );
    target.addEventListener("input", () => {
      expect(revision).not.toBe(capturedRevision);
      expect(refresh).not.toHaveBeenCalled();
      draft = "edited";
    });
    target.dispatchEvent(new Event("input"));
    expect(revision).toBe(1);
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledOnce();
    stop();
  });

  it("invalidates every edit while coalescing deferred display refreshes", async () => {
    const target = new EventTarget();
    const invalidate = vi.fn();
    const refresh = vi.fn();
    const stop = subscribeSigningReviewInvalidation(
      target,
      invalidate,
      refresh,
    );
    target.dispatchEvent(new Event("input"));
    target.dispatchEvent(new Event("clear:policies-changed"));
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledOnce();
    stop();
  });

  it("does not refresh or listen after unmount", async () => {
    const target = new EventTarget();
    const invalidate = vi.fn();
    const refresh = vi.fn();
    const stop = subscribeSigningReviewInvalidation(
      target,
      invalidate,
      refresh,
    );
    target.dispatchEvent(new Event("input"));
    stop();
    target.dispatchEvent(new Event("input"));
    await vi.runAllTimersAsync();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores unrelated storage but immediately revokes policy changes and storage clears", () => {
    const target = new EventTarget();
    const invalidate = vi.fn();
    const stop = subscribeSigningReviewInvalidation(
      target,
      invalidate,
      () => {},
    );
    for (const key of ["unrelated", "clear.policies.v1", null]) {
      const event = new Event("storage");
      Object.defineProperty(event, "key", { value: key });
      target.dispatchEvent(event);
    }
    expect(invalidate).toHaveBeenCalledTimes(2);
    stop();
  });
});

const policyKeys = new Set([
  "clear.policies.v1",
  "clear-msig:spending-budget:v1",
  "clear-msig:policy.allowlist:v1",
  "clear-msig:policy.timeWindow:v1",
  "clear-msig:allowances:v1",
]);
export function affectsSigningReview(event: Event): boolean {
  return (
    event.type !== "storage" ||
    (event as StorageEvent).key === null ||
    policyKeys.has((event as StorageEvent).key ?? "")
  );
}

/** Revoke signing authority immediately, but refresh React after native input dispatch.
 * A capture-phase render can restore a controlled input before React sees its edit.
 */
export function subscribeSigningReviewInvalidation(
  target: EventTarget,
  invalidate: () => void,
  refresh: () => void,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (event: Event) => {
    if (!affectsSigningReview(event)) return;
    invalidate();
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (active) refresh();
    }, 0);
  };
  const events = [
    "input",
    "storage",
    "clear:policies-changed",
    "clear:spending-budget-changed",
    "clear:personal-policy-changed",
  ];
  const options = { capture: true };
  for (const event of events) target.addEventListener(event, changed, options);
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    for (const event of events)
      target.removeEventListener(event, changed, options);
  };
}

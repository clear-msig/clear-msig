const policyKeys = new Set(["clear.policies.v1", "clear-msig:spending-budget:v1", "clear-msig:policy.allowlist:v1", "clear-msig:policy.timeWindow:v1", "clear-msig:allowances:v1"]);
export function affectsSigningReview(event: Event): boolean {
  return event.type !== "storage" || (event as StorageEvent).key === null || policyKeys.has((event as StorageEvent).key ?? "");
}

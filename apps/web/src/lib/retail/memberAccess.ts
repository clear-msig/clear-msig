export type WalletRole = "full" | "approver" | "watcher";

export function isWalletRole(value: string): value is WalletRole {
  return value === "full" || value === "approver" || value === "watcher";
}

export function describeWalletRole(role: WalletRole): string {
  switch (role) {
    case "full":
      return "Can request and approve";
    case "approver":
      return "Can approve";
    case "watcher":
      return "Can view";
  }
}

export function describeWalletRights(role: WalletRole): string {
  switch (role) {
    case "full":
      return "You can request sends and approve requests.";
    case "approver":
      return "You can approve requests, but you cannot start them.";
    case "watcher":
      return "You can see wallet activity, but you cannot start or approve requests.";
  }
}

export function describeRolesSummary(roles: readonly string[]): string {
  const normalized = new Set(roles);
  const isApprover = normalized.has("approver");
  const isProposer = normalized.has("proposer");
  if (isApprover && isProposer) return "Can request and approve";
  if (isApprover) return "Can approve";
  if (isProposer) return "Can request";
  return "Can view";
}

export function describeRolesRights(roles: readonly string[]): string {
  const normalized = new Set(roles);
  const isApprover = normalized.has("approver");
  const isProposer = normalized.has("proposer");
  if (isApprover && isProposer) {
    return "You can request sends and approve requests.";
  }
  if (isApprover) {
    return "You can approve requests, but you cannot start them.";
  }
  if (isProposer) {
    return "You can request sends, but you cannot approve them.";
  }
  return "You can see wallet activity, but you cannot start or approve requests.";
}

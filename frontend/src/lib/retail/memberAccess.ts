export type WalletRole = "full" | "approver" | "watcher";

export function isWalletRole(value: string): value is WalletRole {
  return value === "full" || value === "approver" || value === "watcher";
}

export function describeWalletRole(role: WalletRole): string {
  switch (role) {
    case "full":
      return "proposer + approver access";
    case "approver":
      return "approver access";
    case "watcher":
      return "watch-only access";
  }
}

export function describeWalletRights(role: WalletRole): string {
  switch (role) {
    case "full":
      return "You can create requests and approve them.";
    case "approver":
      return "You can approve requests, but you cannot create them.";
    case "watcher":
      return "You can see the wallet activity, but you cannot create or approve requests.";
  }
}

export function describeRolesSummary(roles: readonly string[]): string {
  const normalized = new Set(roles);
  const isApprover = normalized.has("approver");
  const isProposer = normalized.has("proposer");
  if (isApprover && isProposer) return "proposer + approver access";
  if (isApprover) return "approver access";
  if (isProposer) return "proposer access";
  return "watch-only access";
}

export function describeRolesRights(roles: readonly string[]): string {
  const normalized = new Set(roles);
  const isApprover = normalized.has("approver");
  const isProposer = normalized.has("proposer");
  if (isApprover && isProposer) {
    return "You can create requests and approve them.";
  }
  if (isApprover) {
    return "You can approve requests, but you cannot create them.";
  }
  if (isProposer) {
    return "You can create requests, but you cannot approve them.";
  }
  return "You can see the wallet activity, but you cannot create or approve requests.";
}

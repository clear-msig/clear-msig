import type { OrganizationMember } from "@/lib/organizations/types";

type InviteInput = {
  walletName: string;
  reason: string;
  invitee: OrganizationMember;
  inviterAddress: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.length > 0) {
      return maybeError;
    }
  }
  return fallback;
}

export async function sendOrganizationInvite(input: InviteInput): Promise<void> {
  const response = await fetch("/api/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const payload = await readJson<{ error?: string }>(response).catch(() => ({}));
    throw new Error(errorMessage(payload, "Failed to send invite email"));
  }
}

type RevokeInput = {
  walletName: string;
  invitee: OrganizationMember;
  inviterAddress: string;
};

export async function revokeOrganizationInvite(input: RevokeInput): Promise<void> {
  const response = await fetch("/api/invitations/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const payload = await readJson<{ error?: string }>(response).catch(() => ({}));
    throw new Error(errorMessage(payload, "Failed to send revocation email"));
  }
}

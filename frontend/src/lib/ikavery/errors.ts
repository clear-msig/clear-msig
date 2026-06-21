export interface SecureActionErrorCopy {
  title: string;
  details: string;
}

export function secureActionErrorCopy(
  error: unknown,
  fallbackTitle: string,
): SecureActionErrorCopy {
  const details = error instanceof Error ? error.message : String(error);
  const message = details.toLowerCase();

  if (
    message.includes("web authentication") ||
    message.includes("webauthn") ||
    message.includes("publickeycredential") ||
    message.includes("passkey") ||
    message.includes("notallowederror")
  ) {
    return {
      title: "Passkey unavailable",
      details:
        "Multi-member Secure vaults use passkeys. Open ClearSig in Chrome, Safari, or Edge in a normal browser tab, or build a Just me vault for now.",
    };
  }

  if (
    message.includes("user rejected") ||
    message.includes("rejected") ||
    message.includes("declined") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  ) {
    return {
      title: "Signature cancelled",
      details: "Nothing changed. Approve the wallet prompt to continue.",
    };
  }

  return { title: fallbackTitle, details };
}

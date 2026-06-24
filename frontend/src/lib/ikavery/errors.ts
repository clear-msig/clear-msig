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
        "Use Chrome, Safari, or Edge in a normal browser tab, then try again.",
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

  return {
    title: fallbackTitle,
    details: "Nothing moved. Try again, or switch to a Solana wallet and retry.",
  };
}

export const FULL_CLEARSIGN_PROFILE_ID = "clearsig-full-v1" as const;
export const LEDGER_SOLANA_CLEARSIGN_PROFILE_ID =
  "clearsig-ledger-solana-v1" as const;

export type ClearSignDeviceProfileId =
  | typeof FULL_CLEARSIGN_PROFILE_ID
  | typeof LEDGER_SOLANA_CLEARSIGN_PROFILE_ID;

export interface ClearSignDeviceCapability {
  vendor: "Ledger";
  app: "Solana";
  appVersion: string;
}

export interface ClearSignDeviceProfileRequest {
  id: ClearSignDeviceProfileId;
  capability?: ClearSignDeviceCapability;
}

export interface ClearSignDeviceProfile {
  id: ClearSignDeviceProfileId;
  version: 1;
  mode: "full" | "compact";
  maxDocumentBytes: 1792 | 1024;
}

export const FULL_CLEARSIGN_PROFILE: ClearSignDeviceProfileRequest = {
  id: FULL_CLEARSIGN_PROFILE_ID,
};

export function clearSignProfileForSigner(
  input: {
    isLedger: boolean;
    ledgerAppVersion: string | null;
    ledgerPublicKey?: { toBase58(): string } | null;
  },
  selectedSigner?: { toBase58(): string } | string | null,
): ClearSignDeviceProfileRequest {
  const selectedSignerAddress =
    typeof selectedSigner === "string"
      ? selectedSigner
      : selectedSigner?.toBase58();
  const ledgerAddress = input.ledgerPublicKey?.toBase58();
  const ledgerWillSign =
    input.isLedger &&
    (!selectedSignerAddress ||
      (Boolean(ledgerAddress) && selectedSignerAddress === ledgerAddress));
  if (ledgerWillSign && versionAtLeast(input.ledgerAppVersion, [1, 14, 0])) {
    return {
      id: LEDGER_SOLANA_CLEARSIGN_PROFILE_ID,
      capability: {
        vendor: "Ledger",
        app: "Solana",
        appVersion: input.ledgerAppVersion!,
      },
    };
  }
  return FULL_CLEARSIGN_PROFILE;
}

export function resolveClearSignDeviceProfile(
  request: ClearSignDeviceProfileRequest = FULL_CLEARSIGN_PROFILE,
): ClearSignDeviceProfile {
  if (request.id === FULL_CLEARSIGN_PROFILE_ID) {
    return {
      id: request.id,
      version: 1,
      mode: "full",
      maxDocumentBytes: 1792,
    };
  }
  const capability = request.capability;
  if (
    capability?.vendor !== "Ledger" ||
    capability.app !== "Solana" ||
    !versionAtLeast(capability.appVersion, [1, 14, 0])
  ) {
    throw new Error(
      "Ledger compact ClearSign requires Solana app version 1.14.0 or newer.",
    );
  }
  return {
    id: request.id,
    version: 1,
    mode: "compact",
    maxDocumentBytes: 1024,
  };
}

function versionAtLeast(
  value: string | null,
  minimum: readonly [number, number, number],
): boolean {
  if (!value) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return false;
  const version = match.slice(1).map(Number) as [number, number, number];
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

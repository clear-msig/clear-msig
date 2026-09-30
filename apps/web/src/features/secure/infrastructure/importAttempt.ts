import type { CreateVaultStage } from "@/lib/ikavery/clearmsig-actions";

type ImportAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; submissionMayHaveStarted: boolean };

// Key custody ends with this attempt. A failed wallet popup can happen after the
// local key was already wiped, so retrying its old object is never supported.
export async function runImportAttempt<T>(options: {
  run: (onProgress: (stage: CreateVaultStage) => void) => Promise<T>;
  wipe: () => void;
  onProgress: (stage: CreateVaultStage) => void;
}): Promise<ImportAttempt<T>> {
  let submissionMayHaveStarted = false;
  try {
    const value = await options.run((stage) => {
      if (stage === "submit" || stage === "confirm") submissionMayHaveStarted = true;
      options.onProgress(stage);
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error, submissionMayHaveStarted };
  } finally {
    options.wipe();
  }
}

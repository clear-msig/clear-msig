// Atomic SOL batch executor limit. Shared by composition and submission so the
// UI never prepares a recipient count the transaction adapter cannot execute.
export const MAX_BATCH_RECIPIENTS = 16;

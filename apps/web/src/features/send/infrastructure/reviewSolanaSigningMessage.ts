import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { verifiedTypedClearSignMessageBytes, type ExpectedTypedClearSignMessage } from "@/lib/clearsign/typedMessage";
import type { ExecuteSolanaSendInput } from "./executeSolanaSend";

/** Exact-message review, including the role-specific approval suffix. No signing here. */
export async function reviewSolanaSigningMessage(
  input: ExecuteSolanaSendInput,
  descriptor: TypedDryRunDescriptor,
  expected: ExpectedTypedClearSignMessage,
  destination: string,
) {
  input.attempt.assertCurrent();
  input.assertFormCurrent();
  const document = new TextDecoder("utf-8", { fatal: true }).decode(
    verifiedTypedClearSignMessageBytes(descriptor, expected),
  );
  await input.reviewBeforeSigning(Object.freeze({ document, destination, amount: input.amount }));
  input.attempt.assertCurrent();
  input.assertFormCurrent();
  if (!Number.isSafeInteger(descriptor.expiry) || Math.floor(Date.now() / 1000) >= descriptor.expiry)
    throw new Error("Signing review expired. Prepare and review a new request.");
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SigningReview } from "../domain/signingReview";

/** A review is a one-use decision for one form revision, never authority itself. */
export function useSigningReview(scope: string, subscribeInvalidation?: (invalidate: () => void) => () => void) {
  const current = useRef({ scope, revision: 0, mounted: true });
  if (current.current.scope !== scope) {
    current.current.scope = scope;
    current.current.revision += 1;
  }
  const [review, setReview] = useState<SigningReview | null>(null);
  const pending = useRef<{
    accept: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const cancel = useCallback(() => {
    const waiting = pending.current;
    pending.current = null;
    setReview(null);
    waiting?.reject(new Error("Signing review cancelled. No signing was authorized by this review."));
  }, []);
  useEffect(() => subscribeInvalidation?.(() => {
    current.current.revision += 1;
    cancel();
  }), [subscribeInvalidation, cancel]);
  useEffect(() => {
    // Includes recipient/amount/policy and account changes; never reuse an old review.
    cancel();
  }, [scope, cancel]);
  useEffect(() => {
    const lifetime = current.current;
    lifetime.mounted = true;
    return () => {
      lifetime.mounted = false;
      lifetime.revision += 1;
      pending.current?.reject(new Error("Signing review closed."));
      pending.current = null;
    };
  }, []);
  const begin = () => {
    const revision = current.current.revision;
    const assertCurrent = () => {
      if (!current.current.mounted || revision !== current.current.revision)
        throw new Error("Send details changed. Review the new request before signing.");
    };
    return {
      assertCurrent,
      request: (details: SigningReview) => {
        assertCurrent();
        if (pending.current) throw new Error("A signing review is already open.");
        return new Promise<void>((resolve, reject) => {
          pending.current = { accept: () => {
            try { assertCurrent(); resolve(); } catch (error) { reject(error as Error); }
          }, reject };
          setReview(Object.freeze({ ...details }));
        });
      },
    };
  };
  const confirm = () => {
    const waiting = pending.current;
    pending.current = null;
    setReview(null);
    waiting?.accept();
  };
  return { review, begin, confirm, cancel };
}

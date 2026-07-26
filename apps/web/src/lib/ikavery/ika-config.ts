"use client";

// Config knobs for the Ika integration. Read once at module load and
// memoised - the values don't change between page loads. Override
// via NEXT_PUBLIC_* env vars at deploy time.

/**
 * gRPC-Web endpoint for the Ika dWallet service. The pre-alpha network's
 * tonic gateway speaks both gRPC and gRPC-Web on the same host so a
 * browser fetch over HTTPS works without a Node-side hop. Default
 * matches the live `solana.ikavery.com` deploy.
 *
 * Override via `NEXT_PUBLIC_IKA_GRPC_WEB` for a different epoch /
 * regional endpoint.
 */
export const IKA_GRPC_WEB_URL: string =
  (typeof process !== "undefined" &&
    process.env?.NEXT_PUBLIC_IKA_GRPC_WEB) ||
  "https://pre-alpha-dev-1.ika.ika-network.net";

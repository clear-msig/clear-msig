import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { appConfig } from "@/lib/config";

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function getFrontendVersion() {
  return {
    status: "ok",
    service: "clear-msig-frontend",
    packageVersion: process.env.npm_package_version ?? "0.1.0",
    environment:
      firstEnv([
        "NEXT_PUBLIC_CLEARSIG_ENV",
        "VERCEL_ENV",
        "NODE_ENV",
      ]) ?? "development",
    provider: process.env.VERCEL ? "vercel" : "unknown",
    commitSha: firstEnv([
      "NEXT_PUBLIC_CLEARSIG_GIT_COMMIT_SHA",
      "VERCEL_GIT_COMMIT_SHA",
      "GITHUB_SHA",
    ]),
    buildTime: firstEnv([
      "NEXT_PUBLIC_CLEARSIG_BUILD_TIME",
      "CLEARSIG_BUILD_TIME",
      "SOURCE_DATE_EPOCH",
    ]),
    deploymentId: firstEnv(["VERCEL_DEPLOYMENT_ID", "VERCEL_URL"]),
    backendUrl: appConfig.backendApiUrl,
    program: {
      id: CLEAR_WALLET_PROGRAM_ID.toBase58(),
      rpcUrl: appConfig.preAlpha.solanaRpcUrl,
      expectedDeployedSlot: firstEnv(["NEXT_PUBLIC_CLEAR_WALLET_DEPLOY_SLOT"]),
      expectedArtifactSha256: firstEnv(["NEXT_PUBLIC_CLEAR_WALLET_SO_SHA256"]),
    },
  };
}

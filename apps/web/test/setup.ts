import { beforeEach } from "vitest";
import { activateAgentLocalStateScope } from "../src/features/agents/local-state/scope";

beforeEach(() => {
  // Tests explicitly select their synthetic local identity; production never defaults one.
  activateAgentLocalStateScope({ sessionSubject: "test-session", walletPda: "11111111111111111111111111111111", chainNamespace: "11111111111111111111111111111111" });
  Object.assign(process.env, {
    NODE_ENV: "test",
    VERCEL_ENV: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  });
});

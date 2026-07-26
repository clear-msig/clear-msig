import { createHash } from "crypto";
import {
  AgentServerStatePersistenceError,
  type AgentServerWalletState,
} from "@/features/agents/server/stateTypes";

interface UpstashEnv {
  url: string;
  token: string;
}

const MEMORY_STATES = new Map<string, AgentServerWalletState>();

export async function readPersistedAgentState(
  walletName: string,
  normalize: (state: AgentServerWalletState) => AgentServerWalletState,
): Promise<AgentServerWalletState | null> {
  const redis = readUpstashEnv();
  if (redis) {
    const state = await redisGet<AgentServerWalletState>(
      stateRedisKey(walletName),
      redis,
    );
    return state ? normalize(state) : null;
  }
  const state = MEMORY_STATES.get(walletName);
  return state ? normalize(state) : null;
}

export async function writePersistedAgentState(
  state: AgentServerWalletState,
  normalize: (state: AgentServerWalletState) => AgentServerWalletState,
): Promise<void> {
  assertDurableAgentStateAvailable();
  const redis = readUpstashEnv();
  if (redis) {
    await redisSet(stateRedisKey(state.walletName), state, redis);
    return;
  }
  MEMORY_STATES.set(state.walletName, normalize(state));
}

export function assertDurableAgentStateAvailable(): void {
  if (readUpstashEnv() || isMemoryStateAllowed()) return;
  throw new AgentServerStatePersistenceError(
    "Agent state requires Redis in production. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set CLEARSIG_ALLOW_AGENT_MEMORY_STATE=1 only for development.",
  );
}

export function agentServerStateStorageMode(): "redis" | "memory" {
  return readUpstashEnv() ? "redis" : "memory";
}

export function agentServerStatePersistenceStatus(): {
  storage: "redis" | "memory";
  durable: boolean;
  memoryAllowed: boolean;
  production: boolean;
  message: string;
} {
  const storage = agentServerStateStorageMode();
  const production = isProductionRuntime();
  const memoryAllowed = isMemoryStateAllowed();
  return {
    storage,
    durable: storage === "redis",
    memoryAllowed,
    production,
    message:
      storage === "redis"
        ? "Agent state is using Redis."
        : production && !memoryAllowed
          ? "Agent state requires Redis in production."
          : "Agent state is using development memory storage.",
  };
}

function isMemoryStateAllowed(): boolean {
  return (
    !isProductionRuntime() ||
    process.env.CLEARSIG_ALLOW_AGENT_MEMORY_STATE === "1"
  );
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

function stateRedisKey(walletName: string): string {
  const hash = createHash("sha256").update(walletName).digest("hex").slice(0, 40);
  return `agent:state:${hash}`;
}

function readUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

async function redisGet<T>(key: string, env: UpstashEnv): Promise<T | null> {
  const result = await redisCommand(["GET", key], env);
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}

async function redisSet<T>(key: string, value: T, env: UpstashEnv): Promise<void> {
  await redisCommand(["SET", key, JSON.stringify(value)], env);
}

async function redisCommand(command: string[], env: UpstashEnv): Promise<unknown> {
  const response = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.token}`,
    },
    body: JSON.stringify([command]),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`Agent state store returned ${response.status}`);
  }
  const payload = (await response.json()) as Array<{
    result?: unknown;
    error?: string;
  }>;
  if (payload[0]?.error) throw new Error(payload[0].error);
  return payload[0]?.result ?? null;
}

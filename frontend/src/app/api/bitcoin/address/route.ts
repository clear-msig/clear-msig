import { NextRequest, NextResponse } from "next/server";

type BitcoinNetwork = "mainnet" | "testnet" | "signet" | "regtest";

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

interface BitcoinAddressSnapshotJson {
  network: BitcoinNetwork;
  balanceSats: string;
  utxos: EsploraUtxo[];
}

const DEFAULT_NETWORK: BitcoinNetwork = "testnet";
const PROVIDER_TIMEOUT_MS = 6000;

const PROVIDERS: Record<BitcoinNetwork, string[]> = {
  mainnet: [
    process.env.NEXT_PUBLIC_BITCOIN_MAINNET_RPC_URL ?? "",
    "https://mempool.space/api",
    "https://blockstream.info/api",
  ].filter(Boolean),
  testnet: [
    process.env.NEXT_PUBLIC_BITCOIN_TESTNET_RPC_URL ?? "",
    "https://mempool.space/testnet/api",
    "https://blockstream.info/testnet/api",
  ].filter(Boolean),
  signet: [
    process.env.NEXT_PUBLIC_BITCOIN_SIGNET_RPC_URL ?? "",
    "https://mempool.space/signet/api",
  ].filter(Boolean),
  regtest: ["http://localhost:3002"],
};

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address) {
    return NextResponse.json(
      { error: "Missing Bitcoin address." },
      { status: 400 },
    );
  }

  try {
    const snapshot = await fetchRobustSnapshot(address);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bitcoin balance source unavailable.",
      },
      { status: 502 },
    );
  }
}

async function fetchRobustSnapshot(
  address: string,
): Promise<BitcoinAddressSnapshotJson> {
  const lower = address.toLowerCase();
  if (lower.startsWith("bc1")) return fetchNetworkSnapshot(address, "mainnet");
  if (lower.startsWith("bcrt1")) return fetchNetworkSnapshot(address, "regtest");
  if (!lower.startsWith("tb1")) return fetchNetworkSnapshot(address, DEFAULT_NETWORK);

  const settled = await Promise.allSettled(
    (["testnet", "signet"] as const).map((network) =>
      fetchNetworkSnapshot(address, network),
    ),
  );
  const snapshots = settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((value): value is BitcoinAddressSnapshotJson => value !== null);

  const funded = snapshots.find(
    (snapshot) => BigInt(snapshot.balanceSats) > 0n || snapshot.utxos.length > 0,
  );
  if (funded) return funded;
  const preferred = snapshots.find((snapshot) => snapshot.network === DEFAULT_NETWORK);
  if (preferred) return preferred;
  if (snapshots[0]) return snapshots[0];

  const reasons = settled
    .map((result) =>
      result.status === "rejected"
        ? result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
        : null,
    )
    .filter((reason): reason is string => !!reason);
  throw new Error(
    reasons.length
      ? `Bitcoin indexers unavailable: ${reasons.join("; ")}`
      : "Bitcoin indexers unavailable.",
  );
}

async function fetchNetworkSnapshot(
  address: string,
  network: BitcoinNetwork,
): Promise<BitcoinAddressSnapshotJson> {
  const errors: string[] = [];
  for (const provider of PROVIDERS[network]) {
    const base = provider.replace(/\/+$/, "");
    try {
      const [balanceSats, utxos] = await Promise.all([
        fetchProviderBalance(base, address),
        fetchProviderUtxos(base, address),
      ]);
      return {
        network,
        balanceSats: balanceSats.toString(),
        utxos,
      };
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  throw new Error(`${network}: ${errors.join("; ") || "no provider configured"}`);
}

async function fetchProviderBalance(base: string, address: string): Promise<bigint> {
  const res = await fetch(`${base}/address/${encodeURIComponent(address)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 404) return 0n;
    throw new Error(`${base} address HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const chain =
    BigInt(json.chain_stats?.funded_txo_sum ?? 0) -
    BigInt(json.chain_stats?.spent_txo_sum ?? 0);
  const mempool =
    BigInt(json.mempool_stats?.funded_txo_sum ?? 0) -
    BigInt(json.mempool_stats?.spent_txo_sum ?? 0);
  const total = chain + mempool;
  return total < 0n ? 0n : total;
}

async function fetchProviderUtxos(base: string, address: string): Promise<EsploraUtxo[]> {
  const res = await fetch(`${base}/address/${encodeURIComponent(address)}/utxo`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`${base} utxo HTTP ${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map(normalizeUtxo)
    .filter((utxo): utxo is EsploraUtxo => utxo !== null)
    .sort((a, b) => b.value - a.value);
}

function normalizeUtxo(value: unknown): EsploraUtxo | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const txid = typeof row.txid === "string" ? row.txid : null;
  const vout = typeof row.vout === "number" ? row.vout : null;
  const sats = typeof row.value === "number" ? row.value : null;
  if (!txid || vout === null || sats === null || !Number.isFinite(sats)) {
    return null;
  }
  const status =
    typeof row.status === "object" && row.status !== null
      ? (row.status as EsploraUtxo["status"])
      : { confirmed: false };
  return { txid, vout, value: sats, status };
}

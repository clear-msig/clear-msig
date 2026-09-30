import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { PublicKey } from "@solana/web3.js";
import {
  createVenueRedisStore,
  type VenueRedisCommand,
} from "../serverVenueRedis";
import type {
  ProtectedVenueReceipt,
  VenueDeliveryClaim,
} from "../serverVenueBridge";

// Opt-in real Redis integration; never contacts the application's database.
const bin = process.env.CLEARSIG_TEST_REDIS_BIN;
const cli = process.env.CLEARSIG_TEST_REDIS_CLI;
const exec = promisify(execFile);
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const hex = (n: number) => n.toString(16).padStart(64, "0");
const account = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const deployment = { chainGenesisHash: key(1), programId: key(2) };
const lease = (c: VenueDeliveryClaim) => {
  if (c.state !== "acquired") throw new Error("Not acquired");
  return c.leaseId;
};

describe.skipIf(!bin || !cli)("real Redis durable venue ledger", () => {
  let directory: string;
  let port: number;
  let server: ChildProcess;
  let command: VenueRedisCommand;
  const store = () => createVenueRedisStore(command, deployment, 1000);
  const start = async () => {
    server = spawn(
      bin!,
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--dir",
        directory,
        "--appendonly",
        "yes",
        "--appendfsync",
        "always",
        "--save",
        "",
        "--maxmemory-policy",
        "noeviction",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Local Redis startup timed out")),
        5000,
      );
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Local Redis exited ${code}`));
      });
      server.stdout!.on("data", (chunk) => {
        if (String(chunk).includes("Ready to accept connections")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  };
  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill("SIGTERM");
    });
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "clearsig-venue-redis-"));
    const listener = createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("No isolated test port");
    port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    command = async (args) => {
      const { stdout } = await exec(
        cli!,
        ["-h", "127.0.0.1", "-p", String(port), "--json", ...args],
        { timeout: 5000, maxBuffer: 128 * 1024 },
      );
      if (stdout.startsWith("error:")) throw new Error(stdout.trim());
      return JSON.parse(stdout);
    };
    await start();
  });
  afterAll(async () => {
    await stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("atomically isolates venue and API accounts including cross-role collisions", async () => {
    const binding = {
      walletPda: key(3),
      accountAddress: account(1),
      agentWalletAddress: account(2),
    };
    const results = await Promise.allSettled([
      store().registerInitialBinding(binding, "review-1"),
      store().registerInitialBinding(
        { ...binding, walletPda: key(4) },
        "review-2",
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results[0].status === "fulfilled" ? key(3) : key(4);
    expect(
      (await store().readDedicatedBinding(winner)).assignedWalletPdas,
    ).toEqual([winner]);
    await expect(
      store().registerInitialBinding(
        {
          walletPda: key(5),
          accountAddress: account(2),
          agentWalletAddress: account(3),
        },
        "review-3",
      ),
    ).rejects.toThrow("already assigned");
    await expect(
      store().registerInitialBinding(
        {
          walletPda: winner,
          accountAddress: account(4),
          agentWalletAddress: account(5),
        },
        "review-4",
      ),
    ).rejects.toThrow("immutable");
  });
  it("allows one concurrent claim and permanently binds commitment and account", async () => {
    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        store().ledger.claim(hex(1), hex(2), account(10)),
      ),
    );
    expect(claims.filter((c) => c.state === "acquired")).toHaveLength(1);
    expect(claims.filter((c) => c.state === "in_flight")).toHaveLength(11);
    await expect(
      store().ledger.claim(hex(1), hex(3), account(10)),
    ).rejects.toThrow("Changed");
    expect(await store().ledger.claim(hex(2), hex(2), account(10))).toEqual({
      state: "in_flight",
    });
    expect(
      await store().ledger.lookup(hex(999), hex(2), account(10)),
    ).toBeNull();
  });
  it("releases only pre-handoff reservations and rejects stale leases", async () => {
    const first = lease(
      await store().ledger.claim(hex(10), hex(11), account(11)),
    );
    await expect(
      store().ledger.beginSubmission(hex(10), "stale"),
    ).rejects.toThrow("Stale");
    await store().ledger.blockBeforeSubmission(hex(10), first);
    const second = lease(
      await store().ledger.claim(hex(10), hex(11), account(11)),
    );
    expect(second).not.toBe(first);
    await expect(
      store().ledger.blockBeforeSubmission(hex(10), first),
    ).rejects.toThrow("Stale");
    await store().ledger.beginSubmission(hex(10), second);
    await expect(
      store().ledger.blockBeforeSubmission(hex(10), second),
    ).rejects.toThrow("cannot be released");
  });
  it("survives database restart without automatic resubmission and reconciles idempotently", async () => {
    const id = hex(20);
    const commitment = hex(21);
    const venue = account(12);
    const originalLease = lease(
      await store().ledger.claim(id, commitment, venue),
    );
    await store().ledger.beginSubmission(id, originalLease);
    await stop();
    await start();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await store().ledger.claim(id, commitment, venue)).toEqual({
      state: "uncertain",
    });
    expect(await store().ledger.claim(hex(22), commitment, venue)).toEqual({
      state: "in_flight",
    });
    await expect(
      store().ledger.beginSubmission(id, originalLease),
    ).rejects.toThrow("unavailable");
    const receipt: ProtectedVenueReceipt = {
      deliveryKey: id,
      commitment,
      accountAddress: venue,
      walletPda: key(3),
      proposalPda: key(6),
      entryOrderId: "entry",
      stopLossOrderId: "stop",
      takeProfitOrderId: null,
      protectionVerified: true,
      observedAtMs: Date.now(),
    };
    await expect(store().ledger.complete(id, "stale", receipt)).rejects.toThrow(
      "authority",
    );
    await store().ledger.complete(id, null, receipt);
    await store().ledger.complete(id, null, receipt);
    expect(await store().ledger.lookup(id, commitment, venue)).toEqual({
      state: "completed",
      receipt,
    });
    await expect(
      store().ledger.complete(id, null, {
        ...receipt,
        entryOrderId: "different",
      }),
    ).rejects.toThrow("Conflicting");
    expect((await store().ledger.claim(hex(22), commitment, venue)).state).toBe(
      "acquired",
    );
  });
  it("isolates delivery records but prevents account reuse across chain deployments", async () => {
    const alternate = createVenueRedisStore(command, {
      ...deployment,
      programId: key(8),
    });
    expect(
      await alternate.ledger.lookup(hex(1), hex(2), account(10)),
    ).toBeNull();
    expect(
      (await alternate.ledger.claim(hex(1), hex(2), account(10))).state,
    ).toBe("in_flight");
    await expect(
      alternate.registerInitialBinding(
        {
          walletPda: key(3),
          accountAddress: account(1),
          agentWalletAddress: account(2),
        },
        "other-chain",
      ),
    ).rejects.toThrow("already assigned");
  });
});

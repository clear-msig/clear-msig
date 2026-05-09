"use client";

// /app/secure/[recovery]/enroll — passkey enrollment wizard.
//
// Adds a new passkey to an existing solo Recovery's roster. Three
// stages:
//
//   1. intro    — explain what a passkey adds (an extra signer,
//                 device-bound) and the v3 limits (solo today, the
//                 wizard fails fast on multi-member vaults).
//   2. enrolling — call navigator.credentials.create to mint a new
//                 passkey on this device, then submit the on-chain
//                 propose+approve+execute bundle in one user
//                 signature. Live progress dots track the stage.
//   3. done     — success state with the new credential id and a
//                 link back to the vault detail.
//
// One signed transaction, one passkey-create prompt. No round-trips
// to upstream Ikavery.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Fingerprint,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import {
  enrollPasskeyForVault,
  type EnrollDeviceStage,
} from "@/lib/ikavery/clearmsig-enrollment";
import { registerPasskey } from "@/lib/ikavery/passkey/registration";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";

type Stage = "intro" | "enrolling" | "done";

const ENROLL_STAGES: {
  id: EnrollDeviceStage | "create-passkey";
  label: string;
  detail: string;
}[] = [
  {
    id: "create-passkey",
    label: "Creating passkey",
    detail: "Touch ID / Face ID prompt — confirm to mint a new credential.",
  },
  {
    id: "build",
    label: "Building transaction",
    detail: "Packing propose, approve, and execute into one bundle.",
  },
  {
    id: "sign",
    label: "Waiting for your signature",
    detail: "Your wallet authorises the new device joining the roster.",
  },
  {
    id: "submit",
    label: "Submitting on Solana",
    detail: "Sending the bundle to the validator pool.",
  },
  {
    id: "confirm",
    label: "Waiting for confirmation",
    detail: "Solana confirms the new device is now on the roster.",
  },
];

export default function EnrollDevicePageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <EnrollDevicePage />
    </Suspense>
  );
}

function EnrollDevicePage() {
  const reduce = useReducedMotion();
  const router = useRouter();
  const params = useParams<{ recovery: string }>();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();

  const recoveryStr = useMemo(() => {
    try {
      return decodeURIComponent(params?.recovery ?? "");
    } catch {
      return params?.recovery ?? "";
    }
  }, [params?.recovery]);

  const recoveryPk = useMemo(() => {
    try {
      return new PublicKey(recoveryStr);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const vaultQuery = useQuery({
    queryKey: ["ikavery-vault", recoveryStr],
    queryFn: () => {
      if (!recoveryPk) throw new Error("Invalid recovery address");
      return fetchVault(connection, recoveryPk);
    },
    enabled: !!recoveryPk,
    staleTime: 30_000,
  });

  const [stage, setStage] = useState<Stage>("intro");
  const [subStage, setSubStage] = useState<
    EnrollDeviceStage | "create-passkey" | null
  >(null);
  const [credentialIdHex, setCredentialIdHex] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  const handleEnroll = async () => {
    if (!recoveryPk || !vaultQuery.data) return;
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (wallet.isLedger) {
      toast.error("Ledger not supported yet", {
        details:
          "Ledger transaction signing for vault is on the v3 list. Use a hot wallet for now.",
      });
      return;
    }
    if (vaultQuery.data.account.threshold !== 1) {
      toast.error("Solo vaults only at v3a", {
        details:
          "Multi-member enrollment needs every existing member to sign the proposal — that flow lands in v3b.",
      });
      return;
    }
    setStage("enrolling");
    setSubStage("create-passkey");

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdSrc = wallet.publicKey.toBytes();

      const reg = await registerPasskey({
        rpName: "Clear · Secure",
        userId: userIdSrc,
        userName: shortAddress(wallet.publicKey.toBase58()),
        userDisplayName: `Passkey for vault ${shortAddress(recoveryStr)}`,
        challenge,
        authenticatorAttachment: "platform",
      });

      // Encryption-key address. The pre-alpha program stores it but
      // doesn't enforce it — re-encrypt CPI lands at mainnet. Using the
      // saved DKG dwallet pubkey keeps the field meaningful for the
      // forthcoming sweep flow.
      const att = loadAttestation(recoveryStr);
      const encryptionKeyAddress =
        att?.publicKey ?? new Uint8Array(32);

      const result = await enrollPasskeyForVault({
        connection,
        recovery: recoveryPk,
        recoveryId: vaultQuery.data.account.recoveryId,
        creator: wallet.publicKey,
        newPasskeyPubkey: reg.publicKey,
        encryptionKeyAddress,
        signTransaction: wallet.signTransaction,
        onProgress: (s) => setSubStage(s),
      });

      setCredentialIdHex(bytesToHex(reg.credentialId));
      setTxSig(result.txSignature);
      setSubStage(null);
      setStage("done");
    } catch (e) {
      console.error("[secure/enroll]", e);
      toast.error("Couldn't enroll the device", {
        details: e instanceof Error ? e.message : String(e),
      });
      setSubStage(null);
      setStage("intro");
    }
  };

  // Not signed in or invalid recovery - bail fast with a useful state.
  if (!recoveryPk) {
    return (
      <div className="px-gutter">
        <p className="text-sm text-text-soft">Invalid vault address.</p>
      </div>
    );
  }
  const blockedByDisconnect = !wallet.connected;
  const blockedByLedger = wallet.isLedger;

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      {stage !== "done" && (
        <div className="px-gutter">
          <Link
            href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
            className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to vault
          </Link>
        </div>
      )}

      {blockedByDisconnect && (
        <PageEyebrow label="Sign in to continue" align="center">
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
            Connect a wallet first
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
            Only the vault&rsquo;s existing roster can enroll a new device.
          </p>
          <Link
            href={`/connect?next=/app/secure/${encodeURIComponent(recoveryStr)}/enroll`}
            className="mt-5 inline-flex"
          >
            <Button size="lg">
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </PageEyebrow>
      )}

      {!blockedByDisconnect && blockedByLedger && (
        <PageEyebrow label="Ledger" align="center">
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
            Enrollment needs a hot wallet
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
            clear-msig&rsquo;s Ledger path doesn&rsquo;t sign vault transactions
            yet. Disconnect Ledger and use your Dynamic embedded wallet.
          </p>
        </PageEyebrow>
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "intro" && (
        <IntroStage
          onContinue={handleEnroll}
          loading={vaultQuery.isLoading}
          recoveryShort={`${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "enrolling" && (
        <EnrollingStage subStage={subStage} reduce={!!reduce} />
      )}

      {stage === "done" && (
        <DoneStage
          credentialIdHex={credentialIdHex}
          txSig={txSig}
          onContinue={() =>
            router.push(`/app/secure/${encodeURIComponent(recoveryStr)}`)
          }
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}

interface IntroStageProps {
  onContinue: () => void;
  loading: boolean;
  recoveryShort: string;
  reduce: boolean;
}

function IntroStage({ onContinue, loading, recoveryShort, reduce }: IntroStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · device" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Add a passkey
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          A passkey is a device-bound signer — Touch ID, Face ID, or a
          security key. Once enrolled it joins the roster of vault{" "}
          <span className="font-mono text-text-strong">{recoveryShort}</span>.
        </p>
      </PageEyebrow>

      <ul className="flex flex-col gap-2 self-center w-full max-w-md">
        <li className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-4">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-accent"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="text-sm text-text-soft">
            <span className="font-medium text-text-strong">Hardware-bound.</span>{" "}
            The private key never leaves the device. Each sign requires
            Touch ID / Face ID / PIN.
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-4">
          <Fingerprint
            className="mt-0.5 h-5 w-5 shrink-0 text-accent"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="text-sm text-text-soft">
            <span className="font-medium text-text-strong">One signature.</span>{" "}
            propose + approve + execute travel in a single transaction —
            you sign once, and the new device is live.
          </span>
        </li>
      </ul>

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={onContinue} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading vault…
            </>
          ) : (
            <>
              <Fingerprint className="h-4 w-4" aria-hidden="true" />
              Enroll on this device
            </>
          )}
        </Button>
        <p className="text-[11px] text-text-soft">
          Your browser will prompt to mint a new passkey.
        </p>
      </div>
    </motion.section>
  );
}

interface EnrollingStageProps {
  subStage: EnrollDeviceStage | "create-passkey" | null;
  reduce: boolean;
}

function EnrollingStage({ subStage, reduce }: EnrollingStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const activeIndex = ENROLL_STAGES.findIndex((s) => s.id === subStage);
  const active = activeIndex >= 0 ? ENROLL_STAGES[activeIndex] : null;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      <Loader2
        className="h-10 w-10 animate-spin text-accent"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-display text-xl font-semibold text-text-strong">
          {active?.label ?? "Enrolling…"}
        </p>
        <p className="max-w-sm text-sm text-text-soft">
          {active?.detail ?? "Working through the enrollment steps."}
        </p>
      </div>
      <ol
        className="flex items-center gap-1.5"
        aria-label="enrollment progress"
      >
        {ENROLL_STAGES.map((s, i) => {
          const completed = activeIndex > i;
          const current = activeIndex === i;
          return (
            <li
              key={s.id}
              aria-label={s.label}
              className={
                "h-1.5 w-8 rounded-full " +
                (completed
                  ? "bg-accent"
                  : current
                    ? "bg-accent/60"
                    : "bg-border-soft")
              }
            />
          );
        })}
      </ol>
    </motion.section>
  );
}

interface DoneStageProps {
  credentialIdHex: string | null;
  txSig: string | null;
  onContinue: () => void;
  reduce: boolean;
}

function DoneStage({ credentialIdHex, txSig, onContinue, reduce }: DoneStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const credShort = credentialIdHex
    ? `${credentialIdHex.slice(0, 4)}…${credentialIdHex.slice(-4)}`
    : "—";
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · device" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Device enrolled
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          The passkey{" "}
          <span className="font-mono text-text-strong">{credShort}</span> is
          now on the roster. You can sign vault actions from this device
          without your wallet popup.
        </p>
      </PageEyebrow>

      {txSig && (
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mx-auto inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on Solana Explorer
        </a>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={onContinue}>
          Back to vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

function shortAddress(s: string): string {
  if (s.length < 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return s;
}

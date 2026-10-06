"use client";
import { useEffect, useState, useRef } from "react";
import { WalletHero } from "@/components/wallet/detail/WalletHero";
import { RequestOverview } from "@/components/review/RequestOverview";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { Button } from "@/components/retail/Button";
import { BrandMark } from "@/components/retail/BrandMark";
const address = "7YWHMfk9JZe0LMg1ZauHuiSxhI7bzJvtVWkuDKohNqqn";
export default function Fixture() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("wallet"),
    [state, setState] = useState("idle");
  const lock = useRef(false);
  useEffect(() => {
    setReady(true);
    const sync = () => {
      setView(location.hash.slice(1) || "wallet");
      setState("idle");
    };
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  const go = (v: string) => {
    location.hash = v;
  };
  const approve = () => {
    if (lock.current) return;
    lock.current = true;
    setState("pending");
    setTimeout(() => {
      setState("error");
      lock.current = false;
    }, 1000);
  };
  return (
    <main
      data-fixture-ready={ready}
      className="min-h-screen bg-canvas text-text-strong p-5 sm:p-8"
    >
      <header className="max-w-5xl mx-auto flex items-center justify-between gap-3 pb-7">
        <span className="flex items-center gap-2 font-semibold">
          <BrandMark size={27} />
          ClearSig
        </span>
        <span className="text-xs text-text-soft">Devnet · Test funds</span>
      </header>
      <div className="max-w-5xl mx-auto">
        <p className="mb-6 rounded-xl border border-border-soft p-3 text-xs text-text-soft">
          DESIGN FIXTURE · Synthetic data · No wallet or signature requests
        </p>
        <nav aria-label="Fixture screens" className="flex gap-4 mb-7 text-sm">
          {["wallet", "proposal", "approval"].map((v) => (
            <a
              key={v}
              className="min-h-11 inline-flex items-center border-b-2 border-transparent aria-[current=page]:border-accent"
              aria-current={view === v ? "page" : undefined}
              href={"#" + v}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </a>
          ))}
        </nav>
        {view === "wallet" ? (
          <div
            onClickCapture={(e) => {
              const a = (e.target as HTMLElement).closest("a");
              if (a?.getAttribute("href")?.includes("/send")) {
                e.preventDefault();
                go("proposal");
              }
            }}
          >
            <WalletHero
              name="Operations"
              portfolio={{
                totalUsd: 0,
                breakdown: [
                  {
                    kind: 0,
                    ticker: "SOL",
                    name: "Solana",
                    raw: 25000000000n,
                    usd: null,
                  },
                ],
                isLoading: false,
                unknownPriceChains: ["SOL"],
              }}
              productSurface="pro"
              memberCount={3}
              memberAddresses={[
                address,
                "11111111111111111111111111111111",
                "So11111111111111111111111111111111111111112",
              ]}
              loadingMembers={false}
              balanceLamports={25000000000}
              loadingBalance={false}
              pendingApprovalCount={1}
              reduce={true}
            />
            <section
              id="action-needed"
              className="mt-7 rounded-3xl border border-border-soft bg-surface-raised p-6"
            >
              <p className="text-xs text-text-soft uppercase tracking-widest">
                Needs your review
              </p>
              <a
                href="#proposal"
                className="min-h-16 flex justify-between items-center gap-4 mt-3"
              >
                <span>
                  <strong className="block text-xl">Send 5 SOL</strong>
                  <span className="block mt-2 text-sm text-text-soft">
                    1 of 2 required approvals · 3 members
                  </span>
                </span>
                <span className="text-accent">Review →</span>
              </a>
            </section>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
            <RequestOverview
              title="Send 5 SOL"
              walletName="Operations"
              walletHref="#wallet"
              status="Awaiting approval"
              created="Requested by Sam · synthetic example"
              collected={1}
              threshold={2}
              members={3}
              proposalAddress={address}
            >
              <p className="mt-5 text-sm text-text-soft">
                An approval adds your consent. It does not mean the transfer has
                executed.
              </p>
            </RequestOverview>
            <div>
              <SignPayloadPreview
                action={
                  view === "approval"
                    ? "Approve this transfer"
                    : "Review the transfer"
                }
                collapsibleDetails
                details={[
                  { label: "Amount", value: "5 SOL", emphasis: "amount" },
                  { label: "Network", value: "Solana devnet · test funds" },
                  {
                    label: "Recipient address",
                    value: address,
                    emphasis: "mono",
                  },
                  {
                    label: "From address",
                    value: "So11111111111111111111111111111111111111112",
                    emphasis: "mono",
                  },
                  {
                    label: "Approval threshold",
                    value: "2 of 3 members · 1 more approval needed",
                  },
                  {
                    label: "Network fee",
                    value: "Unavailable — confirm the estimate before signing",
                  },
                  {
                    label: "Permission",
                    value: "This exact transfer only; no ongoing allowance",
                  },
                  {
                    label: "Timelock",
                    value: "No additional delay in this synthetic example",
                  },
                ]}
                warning="Verify the full destination and network. A completed transfer cannot be reversed."
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {view === "proposal" ? (
                  <>
                    <Button size="lg" onClick={() => go("approval")}>
                      Review approval →
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => go("wallet")}
                    >
                      Back to wallet
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="lg"
                      disabled={state === "pending"}
                      onClick={approve}
                    >
                      {state === "pending"
                        ? "Awaiting simulated response…"
                        : state === "error"
                          ? "Retry demo approval"
                          : "Approve request · demo"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      disabled={state === "pending"}
                      onClick={() => {
                        setState("cancelled");
                      }}
                    >
                      Cancel review
                    </Button>
                  </>
                )}
              </div>
              {state === "error" && (
                <p
                  role="alert"
                  className="mt-4 p-4 border border-border-soft rounded-xl text-sm"
                >
                  Simulated wallet rejection. Nothing was signed or submitted.
                  Review the request before retrying.
                </p>
              )}
              {state === "cancelled" && (
                <p role="status" className="mt-4 text-sm">
                  Review cancelled. No approval was recorded.
                </p>
              )}
              <p className="mt-4 text-xs text-text-soft">
                Fixture controls only. Real authentication and financial actions
                are not connected.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

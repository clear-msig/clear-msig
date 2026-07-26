"use client";

import { Loader2, Send } from "lucide-react";
import { FormField, TextInput } from "@/components/retail/FormField";
import { InfoTip } from "@/components/retail/InfoTip";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  formatSats,
  type BitcoinNetwork,
  type EsploraUtxo,
} from "@/lib/chain/btc";
import {
  SEND_NOTE_LABEL,
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";
import { btcBalanceStatusLabel } from "@/features/send/ui/bitcoin/bitcoinBalanceStatus";
import { Button } from "@/components/retail/Button";

export function ComposeForm(props: {
  destination: string;
  setDestination: (v: string) => void;
  destinationError: string | null;
  amountBtc: string;
  setAmountBtc: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  amountError: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  maxSpendableSats: bigint;
  selectedUtxo: EsploraUtxo | null;
  effectiveFeeSats: bigint | null;
  changeSats: bigint | null;
  address: string | null;
  network: BitcoinNetwork;
  sending: boolean;
  canSubmit: boolean;
  walletDisplay: string;
  onSend: () => void;
}) {
  const balanceBtc =
    props.balanceSats !== null ? formatSats(props.balanceSats) : null;
  return (
    <>
      {/* Compose grid. Amount + Recipient sit side-by-side on lg+
          and merge into one bordered card on mobile. Same shell as
          SOL /send and ETH /send/eth. */}
      <div
        className={
          "flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 " +
          "lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }
      >
        {/* Amount card. Balance + Use max live with the input so the
            spendable BTC state stays visually scoped. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <SendAmountField
            id="btc-amount"
            ticker="BTC"
            value={props.amountBtc}
            onChange={(e) => props.setAmountBtc(e.target.value)}
            maxLength={20}
            action={
              props.maxSpendableSats > 0n ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    props.setAmountBtc(formatSats(props.maxSpendableSats));
                  }}
                  className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
                >
                  Use max
                </button>
              ) : null
            }
            footer={
              <>
                <span>Wallet has </span>
                <span className="font-numerals font-medium text-text-strong tabular-nums">
                  {props.balanceLoading
                    ? "checking..."
                    : balanceBtc !== null
                      ? balanceBtc
                      : btcBalanceStatusLabel(props.balanceError, props.network)}
                </span>
                {balanceBtc !== null ? <span> BTC</span> : null}
                {props.balanceSats !== null && (
                  <UsdHint
                    amount={props.balanceSats}
                    smallestPerWhole={100_000_000n}
                    ticker="BTC"
                  />
                )}
                {props.amountError && (
                  <span className="ml-1.5 text-warning">{props.amountError}</span>
                )}
                {props.selectedUtxo && props.effectiveFeeSats !== null && (
                  <span className="block pt-1 text-[11px]">
                    Fee {formatSats(props.effectiveFeeSats)} BTC
                    {props.changeSats !== null && props.changeSats > 0n ? (
                      <> · change {formatSats(props.changeSats)} BTC</>
                    ) : null}
                    <InfoTip
                      label="How the fee is picked"
                      width="md"
                      size="xs"
                      side="end"
                    >
                      <span className="block">
                        Bitcoin sends the amount, pays the network fee, and
                        returns the remainder to this wallet.
                      </span>
                    </InfoTip>
                  </span>
                )}
              </>
            }
          />
        </section>

        {/* Recipient card. Same merged-mobile / split-lg+
            treatment as Amount above. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <FormField label="To" error={props.destinationError}>
            <TextInput
              id="btc-destination"
              type="text"
              value={props.destination}
              onChange={(e) => props.setDestination(e.target.value)}
              placeholder={props.network === "mainnet" ? "bc1q…" : "tb1q…"}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              className="font-mono"
            />
          </FormField>

          <FormField label={SEND_NOTE_LABEL}>
            <TextInput
              id="btc-note"
              type="text"
              value={props.note}
              onChange={(e) =>
                props.setNote(e.target.value.slice(0, SEND_NOTE_MAX_LENGTH))
              }
              placeholder={SEND_NOTE_PLACEHOLDER}
              maxLength={SEND_NOTE_MAX_LENGTH}
            />
          </FormField>
        </section>
      </div>

      {/* Action footer. Sticky CTA mirrors the other send pages. */}
      <div className="flex flex-col gap-2 pt-1">
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button
            onClick={props.onSend}
            disabled={props.sending || !props.canSubmit}
            variant="primary"
            fullWidth
            size="lg"
          >
            {props.sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" aria-hidden="true" />
                Send request
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

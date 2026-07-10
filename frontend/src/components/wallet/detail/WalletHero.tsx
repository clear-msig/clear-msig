"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  Bot,
  Download,
  Eye,
  EyeOff,
  Send,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { InfoTip } from "@/components/retail/InfoTip";
import { MemberAvatarStack } from "@/components/retail/MemberAvatar";
import { UsdHint } from "@/components/retail/UsdHint";
import { WalletAvatar } from "@/components/retail/WalletAvatar";
import { useBalancePrivacy } from "@/lib/hooks/useBalancePrivacy";
import { useDisplayCurrency } from "@/lib/hooks/useDisplayCurrency";
import type { WalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { productSurfaceIcon } from "@/lib/productIcons";
import type { WalletProductSurface } from "@/lib/productWorkspace";
import { formatBalance } from "@/lib/retail/format";
import {
  getWalletAppearance,
  SHAPE_LABEL,
} from "@/lib/retail/walletAppearance";
import { toHeadingName } from "@/lib/retail/walletNames";

export interface WalletHeroProps {
  name: string;
  portfolio: WalletPortfolio;
  productSurface: WalletProductSurface | null;
  memberCount: number | null;
  memberAddresses: string[];
  loadingMembers: boolean;
  balanceLamports: number | null;
  loadingBalance: boolean;
  pendingApprovalCount: number;
  reduce: boolean;
}

export function WalletHero({
  name,
  portfolio,
  productSurface,
  memberCount,
  memberAddresses,
  loadingMembers,
  balanceLamports,
  loadingBalance,
  pendingApprovalCount,
  reduce,
}: WalletHeroProps) {
  const balance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;
  const shapeLabel = useMemo(() => {
    const appearance = getWalletAppearance(name);
    return appearance?.shape ? SHAPE_LABEL[appearance.shape] : null;
  }, [name]);
  const encoded = encodeURIComponent(name);
  const profile = productHeroProfile(productSurface, shapeLabel);
  const actions = productHeroActions(productSurface, encoded);
  const { hidden: balancesHidden, toggle: toggleBalancesHidden } =
    useBalancePrivacy();

  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3 sm:gap-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:gap-x-5 sm:gap-y-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <WalletAvatar
            name={name}
            size="lg"
            shapeClass={profile.avatarClass}
            icon={profile.avatarIcon}
          />
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              {profile.eyebrow}
            </p>
            <h1 className="mt-0.5 truncate font-display text-xl leading-tight text-text-strong sm:mt-1 sm:text-display-xs">
              {toHeadingName(name)}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/wallet/${encoded}/members`}
            aria-label="View members"
            className="group inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {loadingMembers ? (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="inline-block h-3 w-16 animate-pulse rounded bg-border-soft" />
              </>
            ) : memberAddresses.length > 0 ? (
              <>
                <MemberAvatarStack addresses={memberAddresses} size="sm" max={4} />
                <span className="font-numerals tabular-nums">{memberCount}</span>
                <span>{memberCount === 1 ? "member" : "members"}</span>
              </>
            ) : (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>1 member</span>
              </>
            )}
            <ArrowRight
              className="h-3 w-3 text-text-soft/60 transition-transform duration-base group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
          {pendingApprovalCount > 0 ? (
            <a
              href="#action-needed"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent transition-[background-color,transform,border-color] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <Bell className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              <span className="font-numerals tabular-nums">
                {pendingApprovalCount}
              </span>
              <span>waiting on you</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className={profile.cardClass}>
        <div className="relative z-10 flex flex-col gap-2.5 p-3 sm:gap-4 sm:p-4 lg:gap-5">
          <div className={profile.portfolioWrapClass}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <PortfolioValue
                portfolio={portfolio}
                fallbackBalance={balance}
                fallbackBalanceLamports={balanceLamports}
                loadingFallback={loadingBalance}
                label={profile.balanceLabel}
                hidden={balancesHidden}
              />
              <button
                type="button"
                onClick={toggleBalancesHidden}
                aria-label={balancesHidden ? "Show balances" : "Hide balances"}
                title={balancesHidden ? "Show balances" : "Hide balances"}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-soft bg-canvas/60 text-text-soft transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              >
                {balancesHidden ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {profile.stats.length > 0 ? (
              <ul className="hidden grid-cols-3 gap-1.5 sm:grid sm:gap-2">
                {profile.stats.map((stat) => (
                  <li
                    key={stat.label}
                    className="min-w-0 rounded-soft border border-border-soft bg-canvas/70 px-2 py-1.5 sm:px-3 sm:py-2"
                  >
                    <p className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-text-soft">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-text-strong">
                      {stat.value({
                        members: memberCount ?? 1,
                        pending: pendingApprovalCount,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div
            className={profile.actionsGridClass}
            role="group"
            aria-label={`${profile.productName} actions`}
          >
            {actions.map((action) => (
              <HeroAction
                key={action.href}
                href={action.href}
                icon={<action.Icon className="h-5 w-5" strokeWidth={1.75} />}
                label={action.label}
                hint={action.hint}
                tone={profile.actionTone}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

type HeroStat = {
  label: string;
  value: (input: { members: number; pending: number }) => string;
};

type HeroProfile = {
  productName: string;
  eyebrow: string;
  avatarClass: string;
  avatarIcon: LucideIcon;
  cardClass: string;
  portfolioWrapClass: string;
  actionsGridClass: string;
  actionTone: "personal" | "pro" | "agent" | "default";
  balanceLabel: string;
  stats: HeroStat[];
};

const CARD_CLASS =
  "relative overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest";

function productHeroProfile(
  surface: WalletProductSurface | null,
  shapeLabel: string | null,
): HeroProfile {
  const shared = {
    avatarClass: "rounded-full",
    avatarIcon: productSurfaceIcon(surface),
    cardClass: CARD_CLASS,
    actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
  };
  if (surface === "personal") {
    return {
      ...shared,
      productName: "Personal",
      eyebrow: shapeLabel ? `Personal wallet · ${shapeLabel}` : "Personal wallet",
      portfolioWrapClass:
        "grid gap-3 sm:gap-4 lg:grid-cols-[1fr_0.85fr] lg:items-end",
      actionTone: "personal",
      balanceLabel: "Shared balance",
      stats: [
        { label: "People", value: ({ members }) => String(members) },
        { label: "Waiting", value: ({ pending }) => String(pending) },
        { label: "Protection", value: () => "On" },
      ],
    };
  }
  if (surface === "pro") {
    return {
      ...shared,
      productName: "Pro",
      eyebrow: "Pro treasury",
      portfolioWrapClass:
        "grid gap-3 sm:gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-end",
      actionTone: "pro",
      balanceLabel: "Treasury value",
      stats: [
        { label: "Approvers", value: ({ members }) => String(members) },
        { label: "Queue", value: ({ pending }) => String(pending) },
        { label: "Protection", value: () => "On" },
      ],
    };
  }
  if (surface === "agent") {
    return {
      ...shared,
      productName: "Agent",
      eyebrow: "Agent vault · trading desk",
      portfolioWrapClass:
        "grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1.1fr] lg:items-end",
      actionTone: "agent",
      balanceLabel: "Trading funds",
      stats: [
        { label: "Trader", value: () => "Ready" },
        { label: "Queue", value: ({ pending }) => String(pending) },
        { label: "Risk", value: () => "Guarded" },
      ],
    };
  }
  return {
    ...shared,
    productName: "Wallet",
    eyebrow: shapeLabel
      ? `Shared wallet · ${shapeLabel}`
      : "Shared wallet · Solana devnet",
    portfolioWrapClass: "flex flex-col",
    actionTone: "default",
    balanceLabel: "Balance",
    stats: [],
  };
}

function productHeroActions(
  surface: WalletProductSurface | null,
  encoded: string,
): Array<{ href: string; Icon: LucideIcon; label: string; hint: string }> {
  if (surface === "agent") {
    return [
      { href: `/app/wallet/${encoded}/agents`, Icon: Bot, label: "Desk", hint: "Trade" },
      { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: "Deposit" },
      { href: `/app/wallet/${encoded}/agents/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
    ];
  }
  return [
    { href: `/app/wallet/${encoded}/send`, Icon: Send, label: "Send", hint: surface ? "Pay" : "Pay anyone" },
    { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: surface ? "Deposit" : "Get paid" },
    { href: `/app/wallet/${encoded}/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
  ];
}

function HeroAction({
  href,
  icon,
  label,
  hint,
  tone,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  hint: string;
  tone: HeroProfile["actionTone"];
}) {
  const toneClass =
    tone === "pro"
      ? "border-border-strong bg-surface-raised hover:border-accent/50"
      : tone === "agent"
        ? "border-accent/20 bg-white/[0.03] text-white hover:border-accent/60 hover:bg-accent/[0.06]"
        : tone === "personal"
          ? "border-border-soft bg-canvas hover:border-emerald-400/40"
          : "border-border-soft bg-canvas hover:border-accent/40";
  const iconClass =
    tone === "agent"
      ? "bg-accent/15 text-accent"
      : tone === "personal"
        ? "bg-emerald-500/10 text-emerald-400"
        : "bg-accent/10 text-accent";
  return (
    <Link
      href={href}
      className={`group flex min-h-[68px] flex-col items-center justify-center gap-0.5 rounded-card border px-2 py-2 text-xs font-medium text-text-strong shadow-card-rest transition-[transform,border-color,box-shadow,background-color] duration-base ease-out-soft hover:-translate-y-0.5 hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised sm:min-h-[88px] sm:gap-1.5 sm:px-3 sm:py-3.5 ${toneClass}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-base ease-out-soft group-hover:bg-accent/15 sm:h-9 sm:w-9 ${iconClass}`}
      >
        {icon}
      </span>
      <span className="text-center text-xs font-semibold leading-tight text-text-strong sm:text-[13px]">
        {label}
      </span>
      <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-text-soft sm:inline">
        {hint}
      </span>
    </Link>
  );
}

function PortfolioValue({
  portfolio,
  fallbackBalance,
  fallbackBalanceLamports,
  loadingFallback,
  label,
  hidden,
}: {
  portfolio: WalletPortfolio;
  fallbackBalance: { amount: string; ticker: string } | null;
  fallbackBalanceLamports: number | null;
  loadingFallback: boolean;
  label: string;
  hidden: boolean;
}) {
  const fiat = useDisplayCurrency();
  const hiddenClass = hidden ? "blur-sm select-none" : "";
  const hasMultipleChains =
    portfolio.breakdown.filter((chain) => chain.raw !== null && chain.raw > 0n)
      .length > 1 || portfolio.breakdown.length > 1;
  const help = (
    <InfoTip label="About balance prices" title="Balance prices" width="sm" size="xs">
      Prices are demo values for now. Treat them as a guide, not a quote.
      {portfolio.unknownPriceChains.length > 0
        ? ` No quote is available for ${portfolio.unknownPriceChains.join(", ")} yet.`
        : ""}
    </InfoTip>
  );

  return (
    <div className="flex flex-col items-start gap-1.5 sm:gap-2">
      <div className="flex items-center gap-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          {label}
        </p>
        {help}
      </div>
      {hasMultipleChains ? (
        portfolio.isLoading && portfolio.totalUsd === 0 ? (
          <div className="h-9 w-44 animate-pulse rounded bg-border-soft sm:h-11 sm:w-56" />
        ) : (
          <p className={`font-numerals text-2xl font-semibold leading-none text-text-strong tabular-nums transition-[filter] duration-base sm:text-display-sm ${hiddenClass}`}>
            {fiat.format(portfolio.totalUsd)}
          </p>
        )
      ) : loadingFallback ? (
        <div className="h-9 w-44 animate-pulse rounded bg-border-soft sm:h-11 sm:w-56" />
      ) : (
        <>
          <p className={`flex items-baseline gap-2 transition-[filter] duration-base ${hiddenClass}`}>
            <span className="font-numerals text-2xl font-semibold leading-none text-text-strong tabular-nums sm:text-display-sm">
              {fallbackBalance?.amount ?? "0"}
            </span>
            <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-text-soft">
              {fallbackBalance?.ticker ?? "SOL"}
            </span>
          </p>
          {fallbackBalanceLamports !== null && fallbackBalanceLamports > 0 ? (
            <span className={`transition-[filter] duration-base ${hiddenClass}`}>
              <UsdHint
                amount={BigInt(Math.round(fallbackBalanceLamports))}
                smallestPerWhole={1_000_000_000n}
                ticker={fallbackBalance?.ticker ?? "SOL"}
                variant="plain"
                className="font-numerals text-xs tabular-nums text-text-soft"
              />
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

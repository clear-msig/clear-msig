"use client";

// Chain brand logos - thin wrappers around brand assets in
// /public/chain-logos/. Served as static assets so there's no runtime
// dependency on a CDN.
//
// Each component renders an <img> with a fixed square size + an
// `alt` so it stays accessible. The assets are already tiny, so there is
// no need for Next/Image here.
//
// CHAINS exports the metadata used by the landing chain marquee,
// bento cards, and product mockups so a future chain addition is one change.

interface LogoProps {
  size?: number;
  className?: string;
}

function ChainLogo({
  src,
  alt,
  size = 32,
  className,
}: LogoProps & { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

export function SolanaLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/solana.svg" alt="Solana" {...props} />;
}

export function EthereumLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/ethereum.svg" alt="Ethereum" {...props} />;
}

export function BitcoinLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/bitcoin.svg" alt="Bitcoin" {...props} />;
}

export function ZcashLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/zcash.svg" alt="Zcash" {...props} />;
}

export function UsdcLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/usdc.svg" alt="USDC" {...props} />;
}

export function HyperliquidLogo(props: LogoProps) {
  return <ChainLogo src="/chain-logos/hyperliquid.png" alt="Hyperliquid" {...props} />;
}

export type ChainKey = "sol" | "eth" | "btc" | "zec" | "usdc" | "hyperliquid";

export interface ChainMeta {
  key: ChainKey;
  label: string;
  // Each chain's signature brand colour, used for soft product accents.
  accent: string;
  Logo: (props: LogoProps) => React.ReactElement;
}

export const CHAINS: ChainMeta[] = [
  { key: "sol", label: "Solana", accent: "#9945FF", Logo: SolanaLogo },
  { key: "eth", label: "Ethereum", accent: "#627EEA", Logo: EthereumLogo },
  { key: "btc", label: "Bitcoin", accent: "#F7931A", Logo: BitcoinLogo },
  { key: "zec", label: "Zcash", accent: "#F4B728", Logo: ZcashLogo },
  { key: "hyperliquid", label: "Hyperliquid", accent: "#7DEBD6", Logo: HyperliquidLogo },
  { key: "usdc", label: "USDC", accent: "#2775CA", Logo: UsdcLogo },
];

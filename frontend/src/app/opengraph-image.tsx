// Dynamic OpenGraph image . rendered server-side at 1200x630 via
// `next/og`. Next.js serves this at /opengraph-image on the landing
// route; social crawlers pick it up automatically through the
// metadata config in layout.tsx.
//
// No external asset required . everything is inline CSS + SVG.

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Clear-MSIG · Sign intents, not hex";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px 88px",
          background:
            "radial-gradient(120% 100% at 0% 0%, #0a0a0a 0%, #111111 60%, #050505 100%)",
          color: "white",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Brand halo. */}
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -140,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: "radial-gradient(circle, rgba(22,163,74,0.5) 0%, rgba(22,163,74,0) 70%)",
            filter: "blur(40px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -260,
            left: -140,
            width: 560,
            height: 560,
            borderRadius: 560,
            background:
              "radial-gradient(circle, rgba(20,241,149,0.35) 0%, rgba(20,241,149,0) 70%)",
            filter: "blur(40px)",
          }}
        />

        {/* Top row: wordmark + tag. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                width: 56,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: "#16a34a",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 48,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  background: "#000",
                  color: "#16a34a",
                  fontSize: 26,
                  fontWeight: 900,
                  fontFamily: "monospace",
                }}
              >
                C
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1,
              }}
            >
              <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
                Clear-MSIG
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: "rgba(255,255,255,0.55)",
                  marginTop: 6,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                Cross-chain multisig
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              border: "1px solid rgba(22,163,74,0.4)",
              borderRadius: 999,
              background: "rgba(22,163,74,0.12)",
              color: "#22c55e",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                display: "flex",
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "#22c55e",
              }}
            />
            Live on devnet
          </div>
        </div>

        {/* Headline. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            maxWidth: 900,
          }}
        >
          <span
            style={{
              fontSize: 22,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: 4,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            The blind-signing crisis, ended.
          </span>
          <span
            style={{
              fontSize: 108,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -3,
              color: "#fff",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Sign intents.</span>
            <span
              style={{
                display: "flex",
                background:
                  "linear-gradient(90deg, #10b981 0%, #16a34a 60%, #22c55e 100%)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Not hex.
            </span>
          </span>
          <span
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,0.7)",
              maxWidth: 860,
              lineHeight: 1.4,
            }}
          >
            A Solana multisig where every signature is a sentence your Ledger
            can read. One policy controls Solana, Ethereum, Bitcoin, and Zcash.
          </span>
        </div>

        {/* Bottom row: feature chips. */}
        <div
          style={{
            display: "flex",
            gap: 10,
            color: "rgba(255,255,255,0.75)",
          }}
        >
          {[
            "Ed25519 on-chain verify",
            "Ika MPC dWallets",
            "Solana · EVM · Bitcoin · Zcash",
          ].map((chip) => (
            <span
              key={chip}
              style={{
                display: "flex",
                padding: "10px 18px",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 999,
                background: "rgba(255,255,255,0.04)",
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}

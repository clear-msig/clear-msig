// Branded QR download - turns a QR SVG into a properly-styled PNG
// that carries the product brand (Clear) instead of a bare black-and-
// white square that would feel disconnected if shared.
//
// Output layout (800 × 1000 @ 2× DPR, 1600 × 2000 raster):
//
//   ┌──────────────────────────────────────┐
//   │  ● CLEAR                              │  ← brand, accent dot
//   │                                       │
//   │  FYB Studio                           │  ← wallet display name
//   │  Solana · shared wallet               │  ← chain + label
//   │                                       │
//   │  ┌────────────────────────────────┐   │
//   │  │                                │   │
//   │  │        [ QR CODE ]             │   │  ← white card (W3C
//   │  │                                │   │     contrast for scans)
//   │  └────────────────────────────────┘   │
//   │                                       │
//   │  ADDRESS                              │
//   │  fyzGEtwbHpVmwa…                      │  ← mono, wrapped
//   │                                       │
//   │  ──── Scan to send funds              │  ← accent rule + caption
//   │                                       │
//   └──────────────────────────────────────┘
//
// The QR is rasterised from the live <QRCodeSVG> element so the
// payload can't drift between the on-screen code and the downloaded
// PNG. Rendering happens entirely in the browser - no server roundtrip,
// no third-party rasterisers - so the address never leaves the page.

const CANVAS_W = 800;
const CANVAS_H = 1000;
const DPR = 2;
const PADDING = 56;

const COLORS = {
  bg: "#0c0c0c", // canvas
  surface: "#131316", // surface-raised
  border: "rgba(255,255,255,0.08)",
  textStrong: "#ebebeb",
  textSoft: "rgba(235,235,235,0.6)",
  textSofter: "rgba(235,235,235,0.4)",
  accent: "#ccff00", // brand lime
  white: "#ffffff",
};

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO_STACK = `ui-monospace, "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;

interface DownloadArgs {
  qrSvg: SVGSVGElement;
  walletName: string;
  chainName: string;
  address: string;
  /// Filename without extension. Slashes / colons stripped automatically.
  filename: string;
}

export async function downloadBrandedQr(args: DownloadArgs): Promise<void> {
  const { qrSvg, walletName, chainName, address, filename } = args;

  // ── Rasterise the live QR SVG ───────────────────────────────────
  // Serialise the on-screen <QRCodeSVG> element into an Image so we
  // can drawImage it onto the canvas. xmlns is required on the root
  // <svg> for the Image element to accept it.
  const cloned = qrSvg.cloneNode(true) as SVGSVGElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svgString = new XMLSerializer().serializeToString(cloned);
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  let qrImage: HTMLImageElement;
  try {
    qrImage = await loadImage(svgUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  // ── Build the canvas ────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W * DPR;
  canvas.height = CANVAS_H * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(DPR, DPR);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle accent glow - radial gradient in the bottom-right, pure
  // decoration that lifts the flat black off "blank canvas" feel.
  const glow = ctx.createRadialGradient(
    CANVAS_W,
    CANVAS_H,
    0,
    CANVAS_W,
    CANVAS_H,
    600,
  );
  glow.addColorStop(0, "rgba(204, 255, 0, 0.10)");
  glow.addColorStop(1, "rgba(204, 255, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── Brand row: lime dot + "CLEAR" wordmark ──────────────────────
  let y = PADDING + 8;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(PADDING + 6, y - 2, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.textStrong;
  ctx.font = `600 16px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("CLEAR", PADDING + 22, y);
  // Letter-spacing approximation for a tight uppercase mark.
  ctx.fillStyle = COLORS.textSoft;
  ctx.font = `500 11px ${FONT_STACK}`;
  ctx.fillText("Receive", PADDING + 80, y);

  // ── Wallet identity ─────────────────────────────────────────────
  y = PADDING + 80;
  ctx.fillStyle = COLORS.textSofter;
  ctx.font = `600 11px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // Letter-spacing fake: render with .35 em padding via measured chars
  drawTrackedText(
    ctx,
    `${chainName.toUpperCase()} · SHARED WALLET`,
    PADDING,
    y,
    2.4,
  );

  y += 36;
  ctx.fillStyle = COLORS.textStrong;
  ctx.font = `600 36px ${FONT_STACK}`;
  ctx.fillText(truncate(walletName, 28), PADDING, y);

  // ── QR card (white rounded square) ──────────────────────────────
  const qrCardSize = 480;
  const qrInner = 416;
  const qrCardX = (CANVAS_W - qrCardSize) / 2;
  const qrCardY = 290;
  drawRoundedRect(ctx, qrCardX, qrCardY, qrCardSize, qrCardSize, 24);
  ctx.fillStyle = COLORS.white;
  ctx.fill();

  // Subtle inner ring (gives the card depth)
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, qrCardX, qrCardY, qrCardSize, qrCardSize, 24);
  ctx.stroke();

  // Draw the QR centered inside the card
  const qrX = qrCardX + (qrCardSize - qrInner) / 2;
  const qrY = qrCardY + (qrCardSize - qrInner) / 2;
  ctx.drawImage(qrImage, qrX, qrY, qrInner, qrInner);

  // ── Address block ───────────────────────────────────────────────
  y = qrCardY + qrCardSize + 56;
  ctx.fillStyle = COLORS.textSofter;
  ctx.font = `600 11px ${FONT_STACK}`;
  drawTrackedText(ctx, "ADDRESS", PADDING, y, 2.4);

  y += 24;
  ctx.fillStyle = COLORS.textStrong;
  ctx.font = `500 16px ${MONO_STACK}`;
  // Wrap address into lines that fit the canvas width.
  const wrapped = wrapMono(address, CANVAS_W - PADDING * 2, ctx, 16);
  for (const line of wrapped) {
    ctx.fillText(line, PADDING, y);
    y += 22;
  }

  // ── Footer rule + caption ───────────────────────────────────────
  const footerY = CANVAS_H - PADDING - 12;
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(PADDING, footerY - 14, 32, 1);

  ctx.fillStyle = COLORS.textSoft;
  ctx.font = `500 12px ${FONT_STACK}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Scan to send funds to this wallet", PADDING + 44, footerY - 10);

  // ── Export ──────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas export failed"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${sanitiseFilename(filename)}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoke after a tick so Firefox's download dialog doesn't
        // grab a dead URL on slow disks.
        setTimeout(() => URL.revokeObjectURL(url), 200);
        resolve();
      },
      "image/png",
      0.95,
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load QR image"));
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Manual letter-spacing - Canvas2D has no `letterSpacing` in older
// browsers, so we render character by character with an extra px gap
// to approximate the 0.24em tracking the eyebrows use everywhere else.
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  extra: number,
) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + extra;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Wrap a monospace string into lines that fit width. Splits on
// character boundaries since addresses have no natural breakpoints.
function wrapMono(
  s: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D,
  fontSize: number,
): string[] {
  const out: string[] = [];
  let line = "";
  // Approximate width per char from font size (mono is uniform).
  ctx.save();
  ctx.font = `500 ${fontSize}px ${MONO_STACK}`;
  for (const ch of s) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line.length > 0) {
      out.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  ctx.restore();
  return out;
}

function sanitiseFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

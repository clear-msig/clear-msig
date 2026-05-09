// Branded vault-QR PNG export.
//
// Composites: obsidian background, soft lime accent glow, Clearsig
// brand mark + wordmark, the QR (drawn from a hidden QRCodeCanvas
// in the caller component), the full vault address wrapped onto
// multiple lines, and a footer caption. The output is a single PNG
// blob that's pushed to the user via the `<a download>` trick.

interface DownloadOpts {
  /** Source canvas - the hidden QRCodeCanvas the caller renders. */
  qrCanvas: HTMLCanvasElement;
  /** Full base58 vault address. Drawn beneath the QR; also the
   *  filename slug. */
  address: string;
}

const W = 880;
const H = 1180;
const BG = "#0c0c0c";
const ACCENT = "#ccff00";
const FG = "#ffffff";
const MUTED = "rgba(255, 255, 255, 0.45)";

export async function downloadBrandedVaultQr({
  qrCanvas,
  address,
}: DownloadOpts): Promise<void> {
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) return;

  // ── Background + soft accent bloom ───────────────────────────
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const bloom = ctx.createRadialGradient(W * 0.25, 0, 0, W * 0.25, 0, W);
  bloom.addColorStop(0, "rgba(204, 255, 0, 0.10)");
  bloom.addColorStop(1, "rgba(204, 255, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  // ── Brand row ────────────────────────────────────────────────
  // Lime tile + mark + wordmark.
  const tileX = 64;
  const tileY = 64;
  const tileSize = 64;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, tileX, tileY, tileSize, tileSize, 14);
  ctx.fill();
  drawBrandMark(ctx, tileX + tileSize / 2, tileY + tileSize / 2, 44, "#0c0c0c");

  ctx.fillStyle = FG;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Clearsig", tileX + tileSize + 18, tileY + 38);

  ctx.fillStyle = MUTED;
  ctx.font = "500 13px ui-monospace, monospace";
  ctx.fillText(
    "VAULT · SOLANA DEVNET",
    tileX + tileSize + 18,
    tileY + 60,
  );

  // ── QR card ──────────────────────────────────────────────────
  const qrSize = 580;
  const qrPad = 36;
  const qrCardX = (W - (qrSize + qrPad * 2)) / 2;
  const qrCardY = 200;
  const qrX = qrCardX + qrPad;
  const qrY = qrCardY + qrPad;

  // White rounded card behind the QR
  ctx.fillStyle = FG;
  roundRect(
    ctx,
    qrCardX,
    qrCardY,
    qrSize + qrPad * 2,
    qrSize + qrPad * 2,
    32,
  );
  ctx.fill();

  // Draw the source QR at target size. drawImage scales smoothly
  // even when source/target sizes differ.
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  // ── Address block ────────────────────────────────────────────
  const addrTopY = qrCardY + qrSize + qrPad * 2 + 60;

  ctx.fillStyle = MUTED;
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("VAULT ADDRESS", W / 2, addrTopY);

  ctx.fillStyle = FG;
  ctx.font = "500 18px ui-monospace, monospace";
  // Address is 32–44 base58 chars. Wrap at ~22 chars per line so
  // the type stays readable in the centred column. Splits cleanly
  // because base58 has no special characters.
  const lines = wrapTextByChars(address, 22);
  let y = addrTopY + 32;
  for (const line of lines) {
    ctx.fillText(line, W / 2, y);
    y += 26;
  }

  // ── Footer ───────────────────────────────────────────────────
  ctx.fillStyle = MUTED;
  ctx.font = "400 13px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Send SOL here to fund this vault.", W / 2, H - 70);
  ctx.fillText("Devnet only.", W / 2, H - 48);

  // ── Export ───────────────────────────────────────────────────
  const blob = await new Promise<Blob | null>((res) =>
    out.toBlob(res, "image/png"),
  );
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clearsig-vault-${address.slice(0, 8)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Helpers ────────────────────────────────────────────────────

function roundRect(
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

// Brand mark = two interlocking circles + a lens fill at the
// intersection. Mirrors the proportions in BrandMark.tsx (24×24
// viewBox, circles at cx=9 and cx=15 with r=5.25 and stroke 2.4).
function drawBrandMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  // Translate the BrandMark's (12, 12) centre to (cx, cy) and
  // scale 24→size.
  const k = size / 24;
  const r = 5.25 * k;
  const lx = cx - 3 * k; // 12 - 9 → -3
  const rx = cx + 3 * k; // 15 - 12 → +3
  const sw = 2.4 * k;

  ctx.lineWidth = sw;
  ctx.strokeStyle = color;

  ctx.beginPath();
  ctx.arc(lx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(rx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Lens fill at the intersection (40% opacity to match BrandMark).
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lx, cy, r, -Math.PI / 3, Math.PI / 3, false);
  ctx.arc(rx, cy, r, Math.PI - Math.PI / 3, Math.PI + Math.PI / 3, false);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function wrapTextByChars(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

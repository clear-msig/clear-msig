export const runtime = "edge";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#050505"/>
  <path d="M39.2 18.4a16 16 0 1 0 0 27.2" fill="none" stroke="#ccff00" stroke-width="9" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="5.5" fill="#f7ffe6"/>
</svg>`;

export function GET() {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

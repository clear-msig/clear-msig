"use client";

import dynamic from "next/dynamic";

const ConnectClient = dynamic(() => import("./ConnectClient"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen items-center justify-center bg-[#0c0c0c] px-6 text-white">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-11 w-11 animate-pulse rounded-full bg-[#ccff00] shadow-[0_0_32px_rgba(204,255,0,0.28)]" />
        <p className="text-sm text-white/60">Opening ClearSig…</p>
      </div>
    </main>
  ),
});

export default function ConnectPage() {
  return <ConnectClient />;
}

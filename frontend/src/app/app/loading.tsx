import { BrandMark } from "@/components/retail/BrandMark";

export default function AppLoading() {
  return (
    <div
      className="mx-auto flex min-h-[min(72vh,720px)] w-full max-w-3xl items-center justify-center px-4"
      aria-label="Opening ClearSig"
    >
      <section className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-border-soft bg-[#080807] p-3 shadow-[0_40px_90px_-36px_rgba(0,0,0,0.9)]">
        <div className="absolute inset-x-8 top-2 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="rounded-[1.35rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(204,255,0,0.10),transparent_36%),linear-gradient(180deg,#14140f,#090909)] p-5">
          <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/50 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-18px_38px_rgba(0,0,0,0.55)]">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-accent/30 bg-accent/[0.08] shadow-[0_0_45px_rgba(204,255,0,0.12)]">
              <BrandMark size={40} />
            </div>
            <div className="mt-6 flex justify-center gap-1.5">
              {[0, 1, 2].map((item) => (
                <span
                  key={item}
                  className="h-1.5 w-8 rounded-full bg-accent/70 animate-pulse"
                  style={{ animationDelay: `${item * 130}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

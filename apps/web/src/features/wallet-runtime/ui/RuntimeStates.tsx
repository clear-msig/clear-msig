type ConfigGap = {
  envVar: string;
  why: string;
};

export function WalletRuntimeLoading() {
  return (
    <main aria-label="Loading wallet" className="min-h-screen bg-canvas md:flex">
      <aside className="hidden w-64 shrink-0 border-r border-border-soft bg-surface-raised md:block">
        <div className="space-y-4 p-5">
          <div className="h-8 w-28 animate-pulse rounded-soft bg-border-soft" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
          <div className="h-10 animate-pulse rounded-soft bg-border-soft/70" />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="h-16 border-b border-border-soft bg-surface-raised md:h-14" />
        <div className="mx-auto w-full max-w-[76rem] space-y-4 px-4 py-6 sm:px-5 md:px-8 lg:px-10">
          <div className="h-7 w-48 animate-pulse rounded-soft bg-border-soft" />
          <div className="h-40 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-28 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
            <div className="h-28 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
          </div>
        </div>
      </div>
    </main>
  );
}

export function ConfigGapBanner({ gaps }: { gaps: ConfigGap[] }) {
  return (
    <main className="min-h-screen bg-canvas px-gutter py-12">
      <div className="mx-auto max-w-xl rounded-card border border-danger/40 bg-danger/[0.05] p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-danger">
          This deployment is misconfigured
        </p>
        <h1 className="mt-2 font-display text-display-xs text-text-strong">
          {gaps.length === 1 ? "1 environment variable" : `${gaps.length} environment variables`} missing
        </h1>
        <p className="mt-2 text-sm text-text-soft">
          The production build started without the required configuration. Set the variables below
          in the Vercel project settings and redeploy.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {gaps.map((gap) => (
            <li key={gap.envVar} className="rounded-soft border border-border-soft bg-surface-raised p-3">
              <code className="font-mono text-sm font-medium text-text-strong">{gap.envVar}</code>
              <p className="mt-1 text-xs text-text-soft">{gap.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

// Displays latest backend response for transparency and live workflow verification.
type Props = {
  title: string;
  payload: unknown;
};

export function ResponseViewer({ title, payload }: Props) {
  if (!payload) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/35 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-green">{title}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs text-text-primary">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

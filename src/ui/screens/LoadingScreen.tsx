import './screens.css';

export function LoadingScreen({ label, progress }: { readonly label: string; readonly progress?: number }) {
  const pct = progress === undefined ? undefined : Math.round(Math.min(Math.max(progress, 0), 1) * 100);
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__seal" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="72" height="72">
          <circle cx="32" cy="32" r="26" fill="#8e1a14" stroke="#4a0e0a" strokeWidth="2" />
          <path d="M20 42V28h4v4h4v-4h8v4h4v-4h4v14z" fill="#e6c35a" stroke="#4a0e0a" strokeWidth="1" />
        </svg>
      </div>
      <p className="loading-screen__label">{label}…</p>
      {pct !== undefined && (
        <div className="loading-screen__bar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} role="progressbar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

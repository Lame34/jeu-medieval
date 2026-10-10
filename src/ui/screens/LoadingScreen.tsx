import { useEffect, useState } from 'react';
import { DEFAULT_RULES } from '../../data/index.ts';
import { HeroEmblem } from '../campaign/HeroEmblem.tsx';
import { LOADING_TIPS } from './loading-tips.ts';

/** A hero's word changes this often while the battle loads (ms). */
const TIP_MS = 7000;
/**
 * The tip shown, kept across the loading screens of one load (the map, then the painter): a
 * different one for each visit, never one already read in the same wait.
 */
let tipIndex = Math.floor(Math.random() * LOADING_TIPS.length);

function LoadingTip() {
  const [index, setIndex] = useState(tipIndex);
  useEffect(() => {
    const timer = window.setInterval(() => {
      tipIndex = (tipIndex + 1) % LOADING_TIPS.length;
      setIndex(tipIndex);
    }, TIP_MS);
    return () => window.clearInterval(timer);
  }, []);
  const tip = LOADING_TIPS[index];
  if (!tip) return null;
  return (
    <p className="loading-screen__tip" key={index}>
      <HeroEmblem hero={tip.hero} size={40} />
      <span>
        « {tip.text} »<cite>— {DEFAULT_RULES.heroes[tip.hero]?.name}</cite>
      </span>
    </p>
  );
}

export function LoadingScreen({ label, progress, tips = false }: { readonly label: string; readonly progress?: number; readonly tips?: boolean }) {
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
      {tips && <LoadingTip />}
    </div>
  );
}

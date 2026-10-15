/**
 * The camera's buttons under the mini-map (ADR-042): turn the view, bring it nearer or farther,
 * bring it back on our men, without a mouse wheel or a middle button (a laptop's touchpad). A
 * click is one step; held down, the button repeats.
 */
import { useEffect, useRef, type ReactNode } from 'react';

/** Held down: the first repeat after this delay, then one step every REPEAT_MS (ms). */
const REPEAT_DELAY_MS = 350;
const REPEAT_MS = 110;

function HoldButton({ label, onStep, children }: { readonly label: string; readonly onStep: () => void; readonly children: ReactNode }) {
  const timer = useRef<number | null>(null);
  const repeated = useRef(false);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const repeat = () => {
    repeated.current = true;
    onStep();
    timer.current = window.setTimeout(repeat, REPEAT_MS);
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={() => {
        repeated.current = false;
        stop();
        timer.current = window.setTimeout(repeat, REPEAT_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // A click is one step (the keyboard's too); after a hold, the release adds none.
      onClick={() => {
        if (!repeated.current) onStep();
        repeated.current = false;
      }}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function CameraButtons({ onTurn, onZoom, onHome }: { readonly onTurn: (direction: 1 | -1) => void; readonly onZoom: (direction: 1 | -1) => void; readonly onHome: () => void }) {
  return (
    <div className="hud-camera" role="group" aria-label="Caméra">
      <HoldButton label="Pivoter vers la gauche" onStep={() => onTurn(1)}>
        <path d="M4.5 11a5.5 5.5 0 1 0 2-6.2" />
        <path d="M5.5 1.5v4h4" />
      </HoldButton>
      <HoldButton label="Pivoter vers la droite" onStep={() => onTurn(-1)}>
        <path d="M15.5 11a5.5 5.5 0 1 1-2-6.2" />
        <path d="M14.5 1.5v4h-4" />
      </HoldButton>
      <HoldButton label="Rapprocher la vue" onStep={() => onZoom(1)}>
        <path d="M10 4v12M4 10h12" />
      </HoldButton>
      <HoldButton label="Éloigner la vue" onStep={() => onZoom(-1)}>
        <path d="M4 10h12" />
      </HoldButton>
      <HoldButton label="Revenir sur vos hommes" onStep={onHome}>
        <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3" />
        <circle cx="10" cy="10" r="4.5" />
      </HoldButton>
    </div>
  );
}

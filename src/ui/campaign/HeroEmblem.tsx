/**
 * The heroes' medallions (council of war, chronicle): Aude's bow, Bertrand's compasses, Guillaume's
 * sword and shield, struck in gold on the army's blue.
 */
const GOLD = '#e6c35a';
const GOLD_DARK = '#8a6a1c';

function mark(hero: string) {
  switch (hero) {
    case 'heroArcher':
      return (
        <g fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round">
          <path d="M24,12 Q48,32 24,52" />
          <line x1={24} y1={12} x2={24} y2={52} strokeWidth={1.2} />
          <line x1={12} y1={32} x2={50} y2={32} strokeWidth={2} />
          <path d="M50,32 l-7,-4 v8z" fill={GOLD} strokeWidth={1} />
          <path d="M12,32 l-3,-4 M12,32 l-3,4 M16,32 l-3,-4 M16,32 l-3,4" strokeWidth={1.5} />
        </g>
      );
    case 'heroEngineer':
      return (
        <g fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round">
          <circle cx={32} cy={13} r={3.5} fill={GOLD} />
          <line x1={32} y1={16} x2={19} y2={52} />
          <line x1={32} y1={16} x2={45} y2={52} />
          <path d="M22,42 A18,18 0 0 0 42,42" strokeWidth={2} />
          <path d="M12,52 h40" strokeWidth={2} />
        </g>
      );
    default:
      return (
        <g strokeLinecap="round">
          <line x1={32} y1={6} x2={32} y2={58} stroke={GOLD} strokeWidth={3} />
          <line x1={21} y1={16} x2={43} y2={16} stroke={GOLD} strokeWidth={3} />
          <path d="M17,24 H47 V36 Q47 50 32 56 Q17 50 17 36Z" fill="#1f4fc4" stroke={GOLD} strokeWidth={2.5} />
          <path d="M19,40 L32,30 L45,40" fill="none" stroke={GOLD} strokeWidth={3} />
        </g>
      );
  }
}

export function HeroEmblem({ hero, size = 64, muted = false }: { readonly hero: string; readonly size?: number; readonly muted?: boolean }) {
  const id = `emblem-${hero}`;
  return (
    <svg className="hero-emblem" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={muted ? { filter: 'grayscale(1) opacity(0.55)' } : undefined}>
      <defs>
        <radialGradient id={id} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#2f5fd0" />
          <stop offset="1" stopColor="#14306e" />
        </radialGradient>
      </defs>
      <circle cx={32} cy={32} r={30} fill={`url(#${id})`} stroke={GOLD_DARK} strokeWidth={3} />
      <circle cx={32} cy={32} r={26.5} fill="none" stroke={GOLD} strokeWidth={1} opacity={0.7} />
      {mark(hero)}
    </svg>
  );
}

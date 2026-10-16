/**
 * The chronicle's miniatures and initials (ADR-050), drawn by the game: each chapter's castle in
 * the map's ink, set on a patterned azure ground in a gilded frame as in an illuminated book, with
 * what the battle's deeds show — the mangonel for its breaches, the beffroi against the wall, the
 * mouton or the flames at the gate, the fagots in the moat, the mine under the wall, the host's
 * pennons; and a gilded initial, the chapter's first letter.
 */
import { useId, type ReactNode } from 'react';
import type { BattleDeeds } from '../../core/campaign/deeds.ts';
import type { CampaignLevel } from '../../core/campaign/types.ts';
import { CastleVignette, OUR_FLAG, VIGNETTE_W } from './CastleVignette.tsx';

const INK = '#3a2a1a';
const GOLD = '#c99a3b';
const GOLD_LIGHT = '#e8c56a';
const AZURE = '#24427f';
const RED = '#8e1b12';
const GRASS = '#7f9a4e';
const GRASS_DARK = '#647c3a';
const WOOD = '#8a6a44';
const FLAME = '#d4561c';
const FLAME_CORE = '#efb03c';

/** The miniature's drawing box, the ground line, and where the castle stands on it. */
const W = 300;
const H = 190;
const GROUND_Y = 150;
const CASTLE_SCALE = 1.25;
const CASTLE_X = 158 - (VIGNETTE_W * CASTLE_SCALE) / 2;
/** The vignettes' base line, in their own drawing (CastleVignette). */
const VIGNETTE_BASE = 92;
const CASTLE_Y = GROUND_Y - VIGNETTE_BASE * CASTLE_SCALE;
/** The gate, under the castle's middle; the wall's foot, left of it. */
const GATE_X = 158;
const WALL_FOOT_X = 118;
/** How far apart the flames and the mouton stand when the gate shows both. */
const SIDE_BY_SIDE = 16;

/** A mangonel: its frame, the beam, the sling. */
function Mangonel({ x }: { readonly x: number }) {
  const y = GROUND_Y + 4;
  return (
    <g stroke={INK} strokeWidth={1.4} fill={WOOD} strokeLinejoin="round">
      <path d={`M${x - 14},${y} L${x},${y - 22} L${x + 14},${y}Z`} />
      <line x1={x - 18} y1={y} x2={x + 18} y2={y} strokeWidth={2.2} />
      <line x1={x - 16} y1={y - 34} x2={x + 10} y2={y - 16} strokeWidth={2.4} />
      <circle cx={x + 11} cy={y - 14} r={4} fill={INK} />
      <path d={`M${x - 16},${y - 34} q -6,6 -4,12`} fill="none" />
    </g>
  );
}

/** A beffroi against the wall, its bridge lowered onto the walls. */
function Beffroi({ x }: { readonly x: number }) {
  const top = GROUND_Y - 78;
  return (
    <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
      <rect x={x - 12} y={top} width={24} height={GROUND_Y - top} fill={WOOD} />
      {[1, 2, 3].map((i) => (
        <line key={i} x1={x - 12} y1={top + i * 19} x2={x + 12} y2={top + i * 19} />
      ))}
      <path d={`M${x - 15},${top} L${x},${top - 10} L${x + 15},${top}Z`} fill={RED} />
      <line x1={x + 12} y1={top + 6} x2={x + 26} y2={top + 10} strokeWidth={2.4} />
    </g>
  );
}

/** The mouton under its roof, at the gate. */
function Mouton({ x }: { readonly x: number }) {
  const y = GROUND_Y + 2;
  return (
    <g stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
      <path d={`M${x - 22},${y - 12} L${x - 6},${y - 24} L${x + 10},${y - 12}Z`} fill={WOOD} />
      <line x1={x - 20} y1={y - 12} x2={x - 20} y2={y} />
      <line x1={x + 8} y1={y - 12} x2={x + 8} y2={y} />
      <line x1={x - 26} y1={y - 8} x2={x + 16} y2={y - 8} strokeWidth={3} />
    </g>
  );
}

/** Flames at the gate. */
function Flames({ x }: { readonly x: number }) {
  const y = GROUND_Y - 2;
  return (
    <g stroke={INK} strokeWidth={0.9}>
      {[-9, 0, 9].map((dx, i) => (
        <g key={dx}>
          <path d={`M${x + dx - 6},${y} q 2,-${16 + i * 4} 6,-${22 + i * 3} q 4,${8} 6,${22 + i * 3}Z`} fill={FLAME} />
          <path d={`M${x + dx - 3},${y} q 1,-10 3,-${13 + i * 2} q 2,6 3,${13 + i * 2}Z`} fill={FLAME_CORE} stroke="none" />
        </g>
      ))}
    </g>
  );
}

/** Fagots laid in the moat before the walls. */
function Fagots({ n }: { readonly n: number }) {
  return (
    <g stroke={INK} strokeWidth={1} fill={WOOD}>
      {Array.from({ length: Math.min(n * 2, 6) }, (_, i) => (
        <g key={i} transform={`translate(${96 + i * 14},${GROUND_Y + 10})`}>
          <ellipse cx={0} cy={0} rx={7} ry={3.2} />
          <line x1={0} y1={-3} x2={0} y2={3} />
        </g>
      ))}
    </g>
  );
}

/** The mouth of a mine at the wall's foot. */
function Mine() {
  return <path d={`M${WALL_FOOT_X - 9},${GROUND_Y + 1} q 9,-16 18,0Z`} fill={INK} />;
}

/** The host's pennons, azure, on the left of the field. */
function Host() {
  return (
    <g stroke={INK} strokeWidth={1.1}>
      {[22, 34, 46, 58].map((x, i) => (
        <g key={x}>
          <line x1={x} y1={GROUND_Y + 22} x2={x} y2={GROUND_Y - 18 - (i % 2) * 6} />
          <path d={`M${x},${GROUND_Y - 18 - (i % 2) * 6} l 11,3 l -11,4Z`} fill={OUR_FLAG} />
        </g>
      ))}
    </g>
  );
}

export function Miniature({ level, deeds }: { readonly level: CampaignLevel; readonly deeds: BattleDeeds | null }) {
  const id = useId();
  const diaper = `${id}-diaper`;
  const struck = deeds ? deeds.breaches - deeds.mined : 0;
  const pieces: ReactNode[] = [];
  if (deeds) {
    if (struck > 0) pieces.push(<Mangonel key="mangonel" x={76} />);
    if (deeds.climbed > 0) pieces.push(<Beffroi key="beffroi" x={104} />);
    if (deeds.mined > 0) pieces.push(<Mine key="mine" />);
    if (deeds.filled > 0) pieces.push(<Fagots key="fagots" n={deeds.filled} />);
    // The fire at the gate or on its bridge; the mouton at a gate it broke (beside the flames when both).
    const rammed = deeds.gate && !deeds.burned.includes('gate');
    if (deeds.burned.length > 0) pieces.push(<Flames key="flames" x={rammed ? GATE_X - SIDE_BY_SIDE : GATE_X} />);
    if (rammed) pieces.push(<Mouton key="mouton" x={deeds.burned.length > 0 ? GATE_X + SIDE_BY_SIDE : GATE_X} />);
  }
  return (
    <svg className="chronicle__miniature" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Miniature : le siège de ${level.name}`}>
      <defs>
        {/* The azure ground, diapered with gold lozenges. */}
        <pattern id={diaper} width={14} height={14} patternUnits="userSpaceOnUse">
          <rect width={14} height={14} fill={AZURE} />
          <path d="M7,1 L13,7 L7,13 L1,7Z" fill="none" stroke={GOLD} strokeWidth={0.7} />
          <circle cx={7} cy={7} r={1} fill={GOLD_LIGHT} />
        </pattern>
      </defs>
      <rect x={6} y={6} width={W - 12} height={H - 12} fill={`url(#${diaper})`} />
      <path d={`M6,${GROUND_Y - 6} Q 80,${GROUND_Y - 18} 150,${GROUND_Y - 8} T ${W - 6},${GROUND_Y - 10} V ${H - 6} H 6Z`} fill={GRASS} stroke={INK} strokeWidth={1} />
      <path d={`M6,${GROUND_Y + 14} Q 120,${GROUND_Y + 6} ${W - 6},${GROUND_Y + 16} V ${H - 6} H 6Z`} fill={GRASS_DARK} />
      <g transform={`translate(${CASTLE_X},${CASTLE_Y}) scale(${CASTLE_SCALE})`}>
        <CastleVignette kind={level.vignette} flag={OUR_FLAG} />
      </g>
      <Host />
      {pieces}
      {/* The gilded frame, a red rule within it. */}
      <rect x={3} y={3} width={W - 6} height={H - 6} fill="none" stroke={GOLD} strokeWidth={6} />
      <rect x={9} y={9} width={W - 18} height={H - 18} fill="none" stroke={RED} strokeWidth={1.2} />
      {[
        [3, 3],
        [W - 3, 3],
        [3, H - 3],
        [W - 3, H - 3],
      ].map(([cx, cy]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={6} fill={GOLD_LIGHT} stroke={INK} strokeWidth={1} />
      ))}
    </svg>
  );
}

/** A chapter's initial: the letter in gold on azure, white filigree round it, in a gilded square. */
export function Lettrine({ letter }: { readonly letter: string }) {
  return (
    <svg className="chronicle__lettrine" viewBox="0 0 64 64" aria-hidden="true">
      <rect x={1} y={1} width={62} height={62} fill={GOLD} stroke={INK} strokeWidth={1.2} />
      <rect x={6} y={6} width={52} height={52} fill={AZURE} />
      <g fill="none" stroke="#f3ead6" strokeWidth={0.9} opacity={0.85}>
        <path d="M10,54 q 0,-10 8,-12 q -6,-4 -2,-10 M54,10 q 0,10 -8,12 q 6,4 2,10" />
        <path d="M10,10 q 10,0 12,8 M54,54 q -10,0 -12,-8" />
        <circle cx={12} cy={12} r={1.6} fill="#f3ead6" />
        <circle cx={52} cy={52} r={1.6} fill="#f3ead6" />
      </g>
      <text x={32} y={46} textAnchor="middle" className="chronicle__lettrine-letter" fill={GOLD_LIGHT} stroke={INK} strokeWidth={0.8}>
        {letter}
      </text>
    </svg>
  );
}

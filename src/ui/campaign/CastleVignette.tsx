/**
 * The castles of the campaign map, drawn in ink and wash like the map itself (STYLE_BIBLE §5):
 * each has its silhouette — the brigands' palisade, the keep on its rock, the castle of the mills,
 * the castle in the marsh mist, the towers with wooden hoardings, the Félon's citadel. The banner
 * on top tells whose it is.
 */
import type { ReactNode } from 'react';
import type { Vignette } from '../../core/campaign/types.ts';

const INK = '#3a2a1a';
const STONE = '#c3b9a4';
const STONE_SHADE = '#9d927c';
const ROOF = '#9a4a32';
const WOOD = '#8a6a44';
const ROCK = '#a39a88';
const HILL = '#a3ad78';
const WATER = '#7d9aa0';
/** The countess Isabeau's banner, azure: on a castle taken, on the host's tents. */
export const OUR_FLAG = '#1f4fc4';

/** Width × height of a vignette's drawing (its base line at y = 92). */
export const VIGNETTE_W = 120;
export const VIGNETTE_H = 100;

function crenels(x: number, y: number, w: number, fill = STONE): ReactNode {
  const n = Math.max(2, Math.floor(w / 6));
  const step = w / n;
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? <rect key={i} x={x + i * step} y={y - 4} width={step} height={4} fill={fill} /> : null));
}

/** A square tower with crenels (or a cone roof), a slit, its shaded side. */
function tower(key: string, x: number, top: number, w: number, base: number, roof: 'crenel' | 'cone' = 'crenel'): ReactNode {
  return (
    <g key={key}>
      <rect x={x} y={top} width={w} height={base - top} fill={STONE} />
      <rect x={x + w * 0.62} y={top} width={w * 0.38} height={base - top} fill={STONE_SHADE} />
      {roof === 'crenel' ? crenels(x - 1, top, w + 2) : <path d={`M${x - 3},${top} L${x + w / 2},${top - w * 1.1} L${x + w + 3},${top}Z`} fill={ROOF} />}
      <rect x={x + w / 2 - 1} y={top + (base - top) * 0.3} width={2} height={5} fill={INK} stroke="none" />
    </g>
  );
}

function curtain(x1: number, x2: number, top: number, base: number): ReactNode {
  return (
    <g>
      <rect x={x1} y={top} width={x2 - x1} height={base - top} fill={STONE} />
      {crenels(x1, top, x2 - x1)}
    </g>
  );
}

function banner(x: number, y: number, colour: string): ReactNode {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 16} />
      <path className="vignette-flag" d={`M${x},${y - 16} Q${x + 7},${y - 18} ${x + 13},${y - 14} Q${x + 7},${y - 11} ${x},${y - 9}Z`} fill={colour} />
    </g>
  );
}

function gateArch(x: number, base: number, w = 9): ReactNode {
  return <path d={`M${x - w / 2},${base} v-7 a${w / 2},${w / 2} 0 0 1 ${w},0 v7z`} fill="#4c4038" />;
}

function drawing(kind: Vignette, flag: string): ReactNode {
  switch (kind) {
    case 'fort':
      // A timber palisade round a wooden tower, on a low mound by the ford.
      return (
        <>
          <path d="M8,92 Q60,70 112,92Z" fill={HILL} />
          <rect x={52} y={42} width={18} height={38} fill={WOOD} />
          <path d="M48,42 L61,28 L74,42Z" fill={ROOF} />
          {banner(61, 28, flag)}
          {Array.from({ length: 15 }, (_, i) => {
            const x = 22 + i * 5.4;
            return <path key={i} d={`M${x},90 v-16 l2.4,-4 l2.4,4 v16z`} fill={i % 3 === 0 ? '#7a5a3a' : WOOD} />;
          })}
          {gateArch(61, 90, 8)}
        </>
      );
    case 'keep':
      // A tall keep on a granite spur.
      return (
        <>
          <path d="M14,92 L30,66 L44,70 L58,58 L80,62 L96,74 L108,92Z" fill={ROCK} />
          <path d="M58,58 L80,62 L96,74 L108,92 L84,92Z" fill="#8a8272" />
          {tower('keep', 48, 22, 26, 62)}
          {tower('turret', 74, 40, 12, 64, 'cone')}
          {banner(61, 18, flag)}
          <rect x={58} y={44} width={4} height={6} fill="#4c4038" />
        </>
      );
    case 'mill':
      // A castle by the river, its water mill turning beside it.
      return (
        <>
          <path d="M4,92 Q50,80 116,92Z" fill={HILL} />
          {curtain(26, 76, 52, 88)}
          {tower('l', 18, 38, 14, 88)}
          {tower('r', 70, 38, 14, 88)}
          {tower('k', 40, 26, 18, 54)}
          {banner(49, 22, flag)}
          {gateArch(51, 88)}
          <rect x={88} y={64} width={18} height={24} fill={WOOD} />
          <path d="M85,64 L97,54 L109,64Z" fill={ROOF} />
          <circle cx={92} cy={82} r={10} fill="none" strokeWidth={1.8} />
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1={92 + 10 * Math.cos((i * Math.PI) / 4)} y1={82 + 10 * Math.sin((i * Math.PI) / 4)} x2={92 - 10 * Math.cos((i * Math.PI) / 4)} y2={82 - 10 * Math.sin((i * Math.PI) / 4)} strokeWidth={1} />
          ))}
          <path d="M70,94 q8,-3 16,0 t16,0 t16,0" fill="none" stroke={WATER} strokeWidth={2} />
        </>
      );
    case 'marsh':
      // Round towers rising from reeds and mist.
      return (
        <>
          <path d="M6,92 Q60,82 114,92Z" fill="#8fa080" />
          {curtain(30, 90, 50, 86)}
          {[22, 82].map((x) => (
            <g key={x}>
              <rect x={x} y={36} width={16} height={50} fill={STONE} />
              <rect x={x + 10} y={36} width={6} height={50} fill={STONE_SHADE} />
              <path d={`M${x - 3},36 L${x + 8},20 L${x + 19},36Z`} fill={ROOF} />
            </g>
          ))}
          {tower('k', 50, 28, 20, 52)}
          {banner(60, 24, flag)}
          {gateArch(60, 86)}
          {Array.from({ length: 16 }, (_, i) => {
            const x = 10 + i * 6.6;
            return <path key={i} d={`M${x},94 q${(i % 3) - 1},-8 ${(i % 2) * 2 - 1},-13`} fill="none" stroke="#5c6a3c" strokeWidth={1.4} />;
          })}
          <path d="M2,70 q14,-4 28,0 t28,0 t28,0 t28,0 M14,78 q14,-3 26,0 t26,0 t26,0" fill="none" stroke="#e8e2d2" strokeWidth={3} opacity={0.75} />
        </>
      );
    case 'hoardings':
      // Two high towers crowned with oak hoardings, torches already lit.
      return (
        <>
          <path d="M6,92 Q60,76 114,92Z" fill={HILL} />
          {curtain(36, 84, 50, 88)}
          {[22, 76].map((x) => (
            <g key={x}>
              <rect x={x} y={24} width={18} height={64} fill={STONE} />
              <rect x={x + 11} y={24} width={7} height={64} fill={STONE_SHADE} />
              <rect x={x - 3} y={18} width={24} height={9} fill={WOOD} />
              <path d={`M${x - 4},18 L${x + 9},8 L${x + 22},18Z`} fill={ROOF} />
              <path className="vignette-torch" d={`M${x + 9},34 q-3,-4 0,-8 q3,4 0,8z`} fill="#f0a030" stroke="none" />
            </g>
          ))}
          {banner(85, 8, flag)}
          {gateArch(60, 88)}
        </>
      );
    case 'citadel':
      // The Félon's citadel on its limestone butte: two rings of walls, four towers, a great keep.
      return (
        <>
          <path d="M2,94 Q20,70 40,66 L84,64 Q104,70 118,94Z" fill="#c9c0a6" />
          {curtain(14, 106, 66, 86)}
          {tower('ol', 8, 54, 12, 86)}
          {tower('or', 100, 54, 12, 86)}
          {curtain(30, 90, 46, 68)}
          {tower('il', 24, 34, 13, 68, 'cone')}
          {tower('ir', 83, 34, 13, 68, 'cone')}
          {tower('k', 48, 12, 24, 48)}
          {banner(60, 8, flag)}
          {gateArch(60, 86, 10)}
        </>
      );
  }
}

export function CastleVignette({ kind, flag }: { readonly kind: Vignette; readonly flag: string }) {
  return (
    <g className="vignette" stroke={INK} strokeWidth={1.3} strokeLinejoin="round">
      {drawing(kind, flag)}
    </g>
  );
}

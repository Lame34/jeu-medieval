/**
 * The campaign map (brief §10: "parchemin illustré"): the Val d'Orle drawn in ink and wash — the
 * Orle and its marsh, the Morneval mountains, the forests, the host's road from its camp through
 * the five castles. Forests and mountains are scattered from the core RNG, so the drawing is the
 * same on every visit. A castle is a button: open (to take), taken (sealed, its banners), or
 * locked (faint, until the one before it falls).
 */
import { memo, useMemo, type ReactNode } from 'react';
import type { Banners } from '../../core/campaign/scenario.ts';
import type { CampaignBattle } from '../../core/campaign/types.ts';
import { Rng } from '../../core/rng.ts';
import { CastleVignette, VIGNETTE_H, VIGNETTE_W } from './CastleVignette.tsx';

export const MAP_W = 1600;
export const MAP_H = 1000;
const INK = '#3a2a1a';
const RED_INK = '#8e1b12';
const ENEMY_FLAG = '#b3141e';
const OUR_FLAG = '#1f4fc4';
const MAP_SEED = 'val-orle-map';
/** A castle's name ribbon: at least this wide, else its name's length (px a letter) plus the folds. */
const RIBBON_MIN_PX = 150;
const RIBBON_PX_PER_CHAR = 13;
const RIBBON_PAD_PX = 40;
/** A castle's click area, round its anchor (px): half its width, above, below. */
const HIT_HALF_W = 110;
const HIT_TOP = 150;
const HIT_BOTTOM = 80;
/** Trees stay this far inside the map's edge. */
const EDGE_PX = 24;
/** Where the host camps before the first battle. */
const CAMP = { x: 70, y: 935 } as const;

type Point = { readonly x: number; readonly y: number };

/** The Orle, west to east, and the Brume stream coming down from the marsh. */
const ORLE: readonly Point[] = [
  { x: -20, y: 770 },
  { x: 120, y: 820 },
  { x: 260, y: 880 },
  { x: 420, y: 905 },
  { x: 570, y: 865 },
  { x: 700, y: 830 },
  { x: 860, y: 860 },
  { x: 1010, y: 905 },
  { x: 1180, y: 885 },
  { x: 1340, y: 830 },
  { x: 1500, y: 860 },
  { x: 1640, y: 840 },
];
const BRUME: readonly Point[] = [
  { x: 960, y: 520 },
  { x: 930, y: 610 },
  { x: 880, y: 720 },
  { x: 868, y: 858 },
];
const MARSH = { x: 915, y: 500, rx: 120, ry: 62 } as const;
/** The forest of Malbois's name, and the clearing the trees leave round it. */
const MALBOIS = { x: 1120, y: 470, halfW: 92, halfH: 30 } as const;

export type NodeState = 'locked' | 'open' | 'taken';

export interface MapNode {
  readonly battle: CampaignBattle;
  readonly state: NodeState;
  readonly banners?: Banners;
  /** The tutorial's node (a lesson, not a castle of the Félon). */
  readonly lesson?: boolean;
}

/** A smooth path through `pts` (Catmull-Rom as cubic Béziers). */
function smooth(pts: readonly Point[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]?.x},${pts[0]?.y}`;
  for (let i = 0; i < pts.length - 1; i++) d += leg(pts, i, false);
  return d;
}

/** The Bézier of the spline's segment i (from pts[i] to pts[i + 1]). */
function leg(pts: readonly Point[], i: number, move: boolean): string {
  const p0 = pts[Math.max(0, i - 1)] as Point;
  const p1 = pts[i] as Point;
  const p2 = pts[i + 1] as Point;
  const p3 = pts[Math.min(pts.length - 1, i + 2)] as Point;
  const b1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const b2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  const f = (n: number) => n.toFixed(1);
  return `${move ? `M${f(p1.x)},${f(p1.y)}` : ''} C${f(b1.x)},${f(b1.y)} ${f(b2.x)},${f(b2.y)} ${f(p2.x)},${f(p2.y)}`;
}

function distToPolyline(p: Point, line: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Point;
    const b = line[i + 1] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

interface Scenery {
  readonly mountains: { x: number; y: number; h: number; w: number }[];
  readonly trees: { x: number; y: number; r: number; tone: number }[];
  readonly reeds: { x: number; y: number; lean: number }[];
}

/** Mountains along the north, forests in the gaps, reeds in the marsh: the same every visit. */
function scenery(stops: readonly Point[]): Scenery {
  const rng = Rng.create(MAP_SEED);
  const mountains: Scenery['mountains'] = [];
  for (let x = 470; x < MAP_W - 20; x += rng.float(52, 78)) mountains.push({ x, y: rng.float(150, 205), h: rng.float(55, 105), w: rng.float(70, 110) });
  for (let x = 30; x < 470; x += rng.float(60, 85)) mountains.push({ x, y: rng.float(220, 250), h: rng.float(35, 60), w: rng.float(60, 90) });
  mountains.sort((a, b) => a.y - b.y);
  const clear = (p: Point, castleM: number) =>
    stops.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > castleM) &&
    distToPolyline(p, ORLE) > 34 &&
    distToPolyline(p, BRUME) > 24 &&
    distToPolyline(p, stops) > 26 &&
    Math.hypot((p.x - MARSH.x) / MARSH.rx, (p.y - MARSH.y) / MARSH.ry) > 1.1 &&
    // A clearing under the forest's name.
    !(Math.abs(p.x - MALBOIS.x) < MALBOIS.halfW && Math.abs(p.y - MALBOIS.y) < MALBOIS.halfH);
  const trees: Scenery['trees'] = [];
  const woods = [
    { x: 330, y: 380, n: 70, s: 85 },
    { x: 640, y: 560, n: 45, s: 60 },
    { x: 700, y: 330, n: 55, s: 75 },
    { x: 1120, y: 470, n: 70, s: 85 },
    { x: 1480, y: 560, n: 55, s: 70 },
    { x: 1240, y: 952, n: 22, s: 50 },
    { x: 520, y: 958, n: 20, s: 50 },
    { x: 120, y: 560, n: 45, s: 70 },
  ];
  for (const w of woods) {
    const wr = rng.fork(`wood-${w.x}`);
    for (let i = 0; i < w.n; i++) {
      const a = wr.float(0, Math.PI * 2);
      const r = Math.sqrt(wr.next()) * w.s;
      const p = { x: w.x + Math.cos(a) * r * 1.3, y: w.y + Math.sin(a) * r * 0.75 };
      if (p.x < EDGE_PX || p.y < EDGE_PX || p.x > MAP_W - EDGE_PX || p.y > MAP_H - EDGE_PX) continue;
      if (!clear(p, 95) || trees.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 11)) continue;
      trees.push({ ...p, r: wr.float(6.5, 9.5), tone: wr.next() });
    }
  }
  trees.sort((a, b) => a.y - b.y);
  const reeds: Scenery['reeds'] = [];
  const rr = rng.fork('reeds');
  for (let i = 0; i < 70; i++) {
    const a = rr.float(0, Math.PI * 2);
    const r = Math.sqrt(rr.next());
    const p = { x: MARSH.x + Math.cos(a) * r * MARSH.rx, y: MARSH.y + Math.sin(a) * r * MARSH.ry };
    if (Math.hypot(p.x - (stops[4]?.x ?? 0), p.y - (stops[4]?.y ?? 0)) < 70) continue;
    reeds.push({ ...p, lean: rr.float(-2, 2) });
  }
  return { mountains, trees, reeds };
}

function Mountain({ m }: { readonly m: Scenery['mountains'][number] }) {
  const peak = { x: m.x + m.w * 0.45, y: m.y - m.h };
  return (
    <g>
      <path d={`M${m.x},${m.y} L${peak.x},${peak.y} L${m.x + m.w},${m.y}Z`} fill="#cfc2a0" />
      <path d={`M${peak.x},${peak.y} L${m.x + m.w},${m.y} L${peak.x + m.w * 0.08},${m.y}Z`} fill="#b3a582" />
      <path d={`M${m.x},${m.y} L${peak.x},${peak.y} L${m.x + m.w},${m.y}`} fill="none" stroke={INK} strokeWidth={1.4} />
      {[0.25, 0.45, 0.65].map((t) => (
        <line key={t} x1={peak.x + m.w * 0.1 * t} y1={peak.y + m.h * t} x2={peak.x + m.w * 0.1 * t + m.w * 0.18} y2={peak.y + m.h * t + 10} stroke={INK} strokeWidth={0.8} opacity={0.6} />
      ))}
    </g>
  );
}

/** The banners under a castle on the map: their width and spacing (map units). */
const PENNANT_WIDTH = 8;
const PENNANT_STEP = 12;

function Pennants({ banners }: { readonly banners: Banners }) {
  const won = [banners.taken, banners.swift, banners.spared, banners.feat];
  // Centred under the castle: each pennant PENNANT_STEP apart.
  const first = -(won.length * PENNANT_STEP - PENNANT_WIDTH) / 2;
  return (
    <g className="map-pennants">
      {won.map((w, i) => (
        <path key={i} d={`M${first + i * PENNANT_STEP},0 h${PENNANT_WIDTH} v10 l-4,-3 l-4,3z`} fill={w ? '#c9a13b' : 'none'} stroke={w ? '#7a5c14' : 'rgb(58 42 26 / 45%)'} strokeWidth={1} />
      ))}
    </g>
  );
}

/** The seal's wax: a disc pressed out of round (lobes of two frequencies), as a path. */
const SEAL_RADIUS = 15;
const SEAL_POINTS = 48;
const WAX_OUTLINE = (() => {
  const pts: string[] = [];
  for (let i = 0; i < SEAL_POINTS; i++) {
    const a = (i / SEAL_POINTS) * Math.PI * 2;
    const r = SEAL_RADIUS + 1.3 * Math.sin(7 * a) + 0.7 * Math.sin(11 * a + 1.3);
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();
/** The countess's fleur-de-lis pressed into the wax (centred, about 18 units tall). */
const FLEUR =
  'M0,-9C2.6,-6 3,-2.8 1.1,0.2L-1.1,0.2C-3,-2.8 -2.6,-6 0,-9Z' +
  'M1.4,-0.6C3.6,-4.4 8.2,-3.6 7.4,0.4C6.9,2.6 4.4,2.6 3.6,0.9C4.9,1.2 5.6,0.4 5.2,-0.6C4.6,-2 2.8,-1.6 1.4,1Z' +
  'M-1.4,-0.6C-3.6,-4.4 -8.2,-3.6 -7.4,0.4C-6.9,2.6 -4.4,2.6 -3.6,0.9C-4.9,1.2 -5.6,0.4 -5.2,-0.6C-4.6,-2 -2.8,-1.6 -1.4,1Z' +
  'M-4.2,1.2H4.2V3H-4.2Z' +
  'M-1.1,3H1.1L1.8,7.4C0.6,6.6 -0.6,6.6 -1.8,7.4Z';

/**
 * The wax seal of a castle taken, hanging from its two silk tails (a « sceau pendant »): the
 * countess's blue wax, its rim pressed up, her fleur-de-lis sunk in it. Stamped once, the first
 * time the map shows it.
 */
function Seal({ fresh }: { readonly fresh: boolean }) {
  return (
    <g className={fresh ? 'map-seal map-seal--fresh' : 'map-seal'}>
      <path d="M-4,10 L-9,27 L-5.5,25.5 L-3.5,29 L0,11Z" fill="#c9a13b" stroke="#7a5a1e" strokeWidth={0.8} />
      <path d="M3,10 L7,28 L9.5,25 L12.5,26.5 L6,9Z" fill="#a8322a" stroke="#5e1712" strokeWidth={0.8} />
      <path d={WAX_OUTLINE} fill="#2a4fa8" stroke="#142c66" strokeWidth={1.4} />
      <circle r={10.5} fill="#24479a" stroke="#4f74cc" strokeWidth={1.2} />
      <path d={FLEUR} fill="#163574" stroke="#5c80d6" strokeWidth={0.5} />
      <path d="M-11,-6 A12,12 0 0 1 -4,-12" fill="none" stroke="#9db4ee" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

function CastleNode({ node, selected, fresh, onSelect }: { readonly node: MapNode; readonly selected: boolean; readonly fresh: boolean; readonly onSelect: (id: string) => void }) {
  const { battle, state } = node;
  const x = battle.map.x * MAP_W;
  const y = battle.map.y * MAP_H;
  const scale = battle.vignette === 'citadel' ? 1.25 : battle.vignette === 'fort' ? 0.85 : 1;
  // The ribbon fits the name (capitals of the title font).
  const ribbon = Math.max(RIBBON_MIN_PX, battle.name.length * RIBBON_PX_PER_CHAR + RIBBON_PAD_PX);
  const label = `${battle.name}, ${battle.epithet}${state === 'locked' ? ' (verrouillé)' : state === 'taken' ? ' (pris)' : ''}`;
  return (
    <g
      className={`map-castle map-castle--${state}`}
      data-selected={selected || undefined}
      transform={`translate(${x},${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-castle={battle.id}
      onClick={() => onSelect(battle.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(battle.id);
        }
      }}
    >
      {/* A fixed click area round the whole drawing: the waving flag never changes the node's box. */}
      <rect x={-HIT_HALF_W} y={-HIT_TOP} width={HIT_HALF_W * 2} height={HIT_TOP + HIT_BOTTOM} fill="transparent" />
      <ellipse className="map-castle__halo" cx={0} cy={-12} rx={78} ry={62} />
      <g transform={`scale(${scale}) translate(${-VIGNETTE_W / 2},${-VIGNETTE_H + 8})`}>
        <CastleVignette kind={battle.vignette} flag={state === 'taken' ? OUR_FLAG : node.lesson ? '#7a5a3a' : ENEMY_FLAG} />
      </g>
      <g transform="translate(0,26)">
        <path className="map-castle__ribbon" d={`M${-ribbon / 2},-13 h${ribbon} l-8,13 l8,13 h${-ribbon} l8,-13z`} />
        <text className="map-castle__name" y={5}>
          {battle.name}
        </text>
        <text className="map-castle__epithet" y={30}>
          {node.lesson ? 'leçon de Guillaume' : battle.epithet}
        </text>
      </g>
      {node.banners && state === 'taken' && !node.lesson && (
        <g transform="translate(0,66)">
          <Pennants banners={node.banners} />
        </g>
      )}
      {state === 'taken' && (
        <g transform={`translate(${44 * scale},${-58 * scale})`}>
          <Seal fresh={fresh} />
        </g>
      )}
    </g>
  );
}

/**
 * The land, drawn once: paper, water, mountains, forests, names, cartouche. It never changes, so it
 * sits on a layer of its own and the castles' flags and the marching road above it repaint alone.
 */
const Land = memo(function Land({ stops }: { readonly stops: readonly Point[] }) {
  const land = useMemo(() => scenery(stops), [stops]);
  return (
    <svg className="campaign-map__land" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id="map-paper" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0" stopColor="#efe2bf" />
          <stop offset="0.7" stopColor="#e2cf9f" />
          <stop offset="1" stopColor="#bf9f68" />
        </radialGradient>
        <filter id="map-wash" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="9" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" result="d" />
          <feGaussianBlur in="d" stdDeviation="1.4" />
        </filter>
        <path id="orle-label" d="M300,866 C360,884 420,892 520,872" />
        <clipPath id="map-sheet">
          <rect width={MAP_W} height={MAP_H} />
        </clipPath>
      </defs>

      <g clipPath="url(#map-sheet)">
      <rect width={MAP_W} height={MAP_H} fill="url(#map-paper)" />
      <rect width={MAP_W} height={MAP_H} filter="url(#paper-grain)" opacity={0.5} />
      {/* Stains and wear. */}
      <circle cx={1260} cy={170} r={70} fill="#a8875a" opacity={0.08} />
      <circle cx={260} cy={620} r={45} fill="#a8875a" opacity={0.07} />

      {/* Water: the marsh, the Orle and the Brume. */}
      <ellipse cx={MARSH.x} cy={MARSH.y} rx={MARSH.rx} ry={MARSH.ry} fill="#a9b79a" opacity={0.55} filter="url(#map-wash)" />
      <path d={smooth(ORLE)} fill="none" stroke="#8fa8ac" strokeWidth={20} strokeLinecap="round" opacity={0.75} filter="url(#map-wash)" />
      <path d={smooth(ORLE)} fill="none" stroke="#5a7880" strokeWidth={1.6} opacity={0.9} transform="translate(0,-9)" />
      <path d={smooth(ORLE)} fill="none" stroke="#5a7880" strokeWidth={1.6} opacity={0.9} transform="translate(0,9)" />
      <path d={smooth(BRUME)} fill="none" stroke="#8fa8ac" strokeWidth={9} strokeLinecap="round" opacity={0.75} filter="url(#map-wash)" />
      <path d={smooth(BRUME)} fill="none" stroke="#5a7880" strokeWidth={1.2} opacity={0.9} />
      <g stroke="#5c6a3c" strokeWidth={1.2} fill="none" opacity={0.85}>
        {land.reeds.map((r, i) => (
          <path key={i} d={`M${r.x.toFixed(1)},${r.y.toFixed(1)} q${r.lean.toFixed(1)},-5 ${(r.lean * 1.5).toFixed(1)},-10`} />
        ))}
      </g>

      {/* Mountains of Morneval. */}
      {land.mountains.map((m, i) => (
        <Mountain key={i} m={m} />
      ))}

      {/* Forests. */}
      <g stroke={INK} strokeWidth={1}>
        {land.trees.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={t.y + t.r * 0.6} x2={t.x} y2={t.y + t.r * 1.5} />
            <circle cx={t.x} cy={t.y} r={t.r} fill={t.tone < 0.33 ? '#7f9658' : t.tone < 0.66 ? '#6f8a4e' : '#8aa262'} />
            <path d={`M${t.x - t.r * 0.2},${t.y + t.r * 0.95} a${t.r},${t.r} 0 0 0 ${t.r * 1.15},-${t.r * 0.9}`} fill="none" stroke="#4f6638" strokeWidth={1.6} opacity={0.6} />
          </g>
        ))}
      </g>

      {/* Names of the land. */}
      <g className="map-lettering">
        <text x={1010} y={70} className="map-lettering__range">
          Monts de Morneval
        </text>
        <text x={MARSH.x} y={MARSH.y + MARSH.ry + 26} className="map-lettering__small">
          Marais de la Brume
        </text>
        <text x={MALBOIS.x} y={MALBOIS.y - 2} className="map-lettering__small">
          Forêt de Malbois
        </text>
        <text x={MALBOIS.x} y={MALBOIS.y + 16} className="map-lettering__tiny">
          ici rôdent des loups
        </text>
        <text className="map-lettering__river">
          <textPath href="#orle-label" startOffset="50%">
            l’Orle
          </textPath>
        </text>
      </g>

      {/* Cartouche, compass rose and scale. */}
      <g transform="translate(40,32)" className="map-cartouche">
        <path d="M0,10 Q0,0 10,0 H370 Q380,0 380,10 V118 Q380,128 370,128 H10 Q0,128 0,118Z" fill="#efe3c3" stroke={INK} strokeWidth={2} />
        <path d="M8,16 Q8,8 16,8 H364 Q372,8 372,16 V112 Q372,120 364,120 H16 Q8,120 8,112Z" fill="none" stroke={RED_INK} strokeWidth={1} />
        <text x={190} y={62} className="map-cartouche__title">
          Le Val d’Orle
        </text>
        <text x={190} y={92} className="map-cartouche__sub">
          dressé pour la comtesse Isabeau,
        </text>
        <text x={190} y={110} className="map-cartouche__sub">
          au printemps de la guerre du Félon
        </text>
      </g>
      <g transform="translate(1500,890)" className="map-compass">
        <circle r={46} fill="none" stroke={INK} strokeWidth={1} opacity={0.6} />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`rotate(${i * 90})`}>
            <path d="M0,-50 L9,-9 L0,0Z" fill={RED_INK} stroke={INK} strokeWidth={0.8} />
            <path d="M0,-50 L-9,-9 L0,0Z" fill="#efe3c3" stroke={INK} strokeWidth={0.8} />
          </g>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <path key={`d${i}`} transform={`rotate(${45 + i * 90})`} d="M0,-30 L5,-5 L0,0 L-5,-5Z" fill="#c8b48a" stroke={INK} strokeWidth={0.6} />
        ))}
        <text y={-58} className="map-compass__n">
          N
        </text>
      </g>
      <g transform="translate(1300,962)" className="map-scale">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 30} y={0} width={30} height={6} fill={i % 2 === 0 ? INK : '#efe3c3'} stroke={INK} strokeWidth={1} />
        ))}
        <text x={60} y={22} className="map-lettering__tiny">
          quatre lieues
        </text>
      </g>
      <rect width={MAP_W} height={MAP_H} fill="none" stroke="#5b4630" strokeWidth={10} opacity={0.5} />
      </g>
    </svg>
  );
});

export function CampaignMap({ nodes, selected, fresh, onSelect }: { readonly nodes: readonly MapNode[]; readonly selected: string | null; readonly fresh: string | null; readonly onSelect: (id: string) => void }) {
  const key = nodes.map((n) => `${n.battle.map.x},${n.battle.map.y}`).join(';');
  // The stops move only if the campaign's places do (never in a session).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stops = useMemo(() => [CAMP, ...nodes.map((n) => ({ x: n.battle.map.x * MAP_W, y: n.battle.map.y * MAP_H }))], [key]);
  // The route's legs: walked (up to the first castle not taken), the next one to walk, the rest faint.
  const frontier = nodes.findIndex((n) => n.state !== 'taken');
  const legs: ReactNode[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const kind = frontier < 0 || i < frontier ? 'walked' : i === frontier ? 'next' : 'ahead';
    legs.push(<path key={i} className={`map-route map-route--${kind}`} d={leg(stops, i, true)} />);
  }
  return (
    <div className="campaign-map">
      <Land stops={stops} />
      <svg className="campaign-map__marks" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Carte du Val d’Orle">
        {/* The host's road, then the camp. */}
        {legs}
        <g transform={`translate(${CAMP.x},${CAMP.y})`} className="map-camp">
          <path d="M-22,8 L0,-22 L22,8Z" fill="#d8c8a0" stroke={INK} strokeWidth={1.4} />
          <path d="M0,-22 L-6,8 M0,-22 L6,8" stroke={INK} strokeWidth={1} />
          <line x1={0} y1={-22} x2={0} y2={-38} stroke={INK} strokeWidth={1.4} />
          <path d="M0,-38 L14,-34 L0,-29Z" fill={OUR_FLAG} stroke={INK} strokeWidth={0.8} />
          <text y={30} className="map-lettering__small">
            Camp de l’ost
          </text>
        </g>

        {nodes.map((n) => (
          <CastleNode key={n.battle.id} node={n} selected={selected === n.battle.id} fresh={fresh === n.battle.id} onSelect={onSelect} />
        ))}
      </svg>
    </div>
  );
}

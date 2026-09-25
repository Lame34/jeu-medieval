/**
 * Painted landscape used behind menus until the live 3D landscape takes over (brief §10).
 * Ridge lines come from the deterministic core noise so the composition is stable; colours
 * follow the late-afternoon palette of STYLE_BIBLE §2–3 with aerial perspective by layer.
 */
import { memo, useMemo } from 'react';
import { createSimplex, fbm, type FbmOptions } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';

const VIEW_W = 1920;
const VIEW_H = 1080;
const RIDGE_STEP_PX = 12;
const BACKDROP_SEED = 'title-backdrop';

interface RidgeSpec {
  readonly label: string;
  readonly baseY: number;
  readonly amplitude: number;
  readonly octaves: FbmOptions;
  readonly fill: string;
  readonly opacity?: number;
}

const MOUNTAIN_NOISE: FbmOptions = { octaves: 5, lacunarity: 2.1, gain: 0.52, frequency: 1 / 520 };
const HILL_NOISE: FbmOptions = { octaves: 3, lacunarity: 2, gain: 0.45, frequency: 1 / 700 };

const RIDGES: readonly RidgeSpec[] = [
  { label: 'far-mountains', baseY: 520, amplitude: 150, octaves: MOUNTAIN_NOISE, fill: '#aebbd0', opacity: 0.85 },
  { label: 'mountains', baseY: 590, amplitude: 110, octaves: MOUNTAIN_NOISE, fill: '#96a7ba', opacity: 0.9 },
  { label: 'far-hills', baseY: 700, amplitude: 55, octaves: HILL_NOISE, fill: '#8f9f86' },
];

function ridgePath(noise: (x: number, z: number) => number, spec: RidgeSpec): string {
  const points: string[] = [`M0,${VIEW_H}`];
  for (let x = 0; x <= VIEW_W; x += RIDGE_STEP_PX) {
    const y = spec.baseY - fbm(noise, x, 0, spec.octaves) * spec.amplitude;
    points.push(`L${x},${y.toFixed(1)}`);
  }
  points.push(`L${VIEW_W},${VIEW_H}Z`);
  return points.join('');
}

/** Tree canopies scattered along a ridge: denser in the middle of a forest band. */
function forestBlobs(rng: Rng, fromX: number, toX: number, baseY: number, count: number): { cx: number; cy: number; r: number; dark: boolean }[] {
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const t = rng.next();
    const x = fromX + (toX - fromX) * t;
    const edgeFade = Math.sin(Math.PI * t);
    blobs.push({ cx: x, cy: baseY - edgeFade * rng.float(10, 34), r: rng.float(12, 26) * (0.6 + 0.4 * edgeFade), dark: rng.chance(0.45) });
  }
  return blobs.sort((a, b) => a.cy - b.cy);
}

function Castle() {
  // Silhouette on the butte, hazy stone: walls, towers with crenellations, keep and a banner.
  const merlons = (x: number, y: number, w: number) =>
    Array.from({ length: Math.floor(w / 9) }, (_, i) => <rect key={i} x={x + i * 9} y={y - 6} width={5} height={6} />);
  return (
    <g fill="#858a95" filter="url(#watercolor)">
      <path d="M1160,690 Q1250,600 1360,630 T1520,700 L1520,760 L1160,760Z" fill="#7d8f5c" />
      <rect x={1200} y={610} width={260} height={50} />
      {merlons(1200, 610, 260)}
      <rect x={1185} y={575} width={34} height={90} />
      {merlons(1185, 575, 34)}
      <rect x={1440} y={580} width={34} height={85} />
      {merlons(1440, 580, 34)}
      <rect x={1300} y={540} width={62} height={80} fill="#7b808b" />
      {merlons(1300, 540, 62)}
      <rect x={1318} y={505} width={24} height={40} fill="#7b808b" />
      <line x1={1330} y1={505} x2={1330} y2={472} stroke="#4a3423" strokeWidth={2} />
      <path d="M1330,474 L1352,480 L1330,487Z" fill="#1f4fc4" />
      <path d="M1316,650 a14,14 0 0 1 28,0 v10 h-28z" fill="#4c4f58" />
    </g>
  );
}

export const PaintedBackdrop = memo(function PaintedBackdrop() {
  const { ridges, forest, meadow, foreground } = useMemo(() => {
    const root = Rng.create(BACKDROP_SEED);
    const ridgeShapes = RIDGES.map((spec) => ({ spec, d: ridgePath(createSimplex(root.fork(spec.label)), spec) }));
    const meadowNoise = createSimplex(root.fork('meadow'));
    const meadowSpec: RidgeSpec = { label: 'meadow', baseY: 800, amplitude: 40, octaves: HILL_NOISE, fill: '#86a34e' };
    const fgNoise = createSimplex(root.fork('foreground'));
    const fgSpec: RidgeSpec = { label: 'fg', baseY: 960, amplitude: 90, octaves: { ...HILL_NOISE, frequency: 1 / 400 }, fill: '#34461f' };
    return {
      ridges: ridgeShapes,
      forest: forestBlobs(root.fork('forest'), 120, 980, 745, 110),
      meadow: ridgePath(meadowNoise, meadowSpec),
      foreground: ridgePath(fgNoise, fgSpec),
    };
  }, []);

  return (
    <svg className="painted-backdrop" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6f96c4" />
          <stop offset="0.45" stopColor="#a9bdd3" />
          <stop offset="0.72" stopColor="#ecd3a6" />
          <stop offset="1" stopColor="#f3d09c" />
        </linearGradient>
        <radialGradient id="bd-sun" cx="0.78" cy="0.56" r="0.42">
          <stop offset="0" stopColor="#fff1cf" stopOpacity="0.95" />
          <stop offset="0.25" stopColor="#ffd39a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd39a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bd-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#ebc896" stopOpacity="0" />
          <stop offset="0.72" stopColor="#ebc896" stopOpacity="0.45" />
          <stop offset="0.8" stopColor="#ebc896" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="bd-field" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9a45c" />
          <stop offset="0.5" stopColor="#dcb65c" />
          <stop offset="1" stopColor="#b7a862" />
        </linearGradient>
        <radialGradient id="bd-vignette" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" stopColor="#1a120b" stopOpacity="0" />
          <stop offset="1" stopColor="#1a120b" stopOpacity="0.65" />
        </radialGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill="url(#bd-sky)" />
      <rect width={VIEW_W} height={VIEW_H} fill="url(#bd-sun)" />
      <g filter="url(#watercolor)">
        {ridges.map(({ spec, d }) => (
          <path key={spec.label} d={d} fill={spec.fill} opacity={spec.opacity ?? 1} />
        ))}
      </g>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#bd-haze)" />
      <Castle />
      <g filter="url(#watercolor)">
        <path d={meadow} fill="#86a34e" />
        <path d="M0,860 Q480,820 960,850 T1920,835 L1920,905 Q1400,930 900,910 T0,925Z" fill="url(#bd-field)" opacity={0.92} />
        {forest.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={b.dark ? '#3e5a2a' : '#5d7a3c'} />
        ))}
        <path d={foreground} fill="#34461f" />
      </g>
      <rect width={VIEW_W} height={VIEW_H} filter="url(#pigment)" opacity={0.6} />
      <rect width={VIEW_W} height={VIEW_H} fill="url(#bd-vignette)" />
    </svg>
  );
});

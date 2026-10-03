/**
 * Mirror of docs/STYLE_BIBLE.md §2 (sRGB hex). Keep both in sync.
 * Rule: nothing but the allegiance colours exceeds HSV saturation 0.55 (review v9, C3).
 */
export const PALETTE = {
  grassLush: { lit: '#8c9c5c', base: '#566a3c' },
  grassDry: { lit: '#b7a862', base: '#7e7440' },
  moss: { lit: '#6b8a3a', base: '#3f5626' },
  foliage: { lit: '#8fae52', base: '#3e5a2a' },
  conifer: { lit: '#5e7a48', base: '#2f4630' },
  dirt: { lit: '#9c7a52', base: '#6b5238' },
  path: { lit: '#bc9e70', base: '#8a7050' },
  mud: { lit: '#6e5842', base: '#4a3b2c' },
  stone: { lit: '#a89a84', base: '#706454' },
  wheat: { lit: '#d2ae62', base: '#977d4c' },
  /** Soil between the tufts: reads as the crop's own shade (review v13, #4). */
  fieldBed: '#9a8050',
  rye: { lit: '#c6aa6a', base: '#8f7a48' },
  fallow: { lit: '#8f8a56', base: '#5f5c38' },
  woodWarm: { lit: '#7a5234', base: '#4e3322' },
  woodLight: { lit: '#a67b4f', base: '#6e5034' },
  thatch: { lit: '#b89c68', base: '#7f6a48' },
  tile: { lit: '#9a6450', base: '#6a4436' },
  towerRoof: '#7e5646',
  plaster: { lit: '#e2d4b6', base: '#a89a7e' },
  mortar: '#847b6c',
  water: { shallow: '#6e9c8e', deep: '#2f5963', moatTop: '#4a5c48', moatDeep: '#2e3d33', duckweed: '#6e7a4a', foam: '#ede6d2' },
  attacker: { primary: '#1f4fc4', secondary: '#e6b325' },
  defender: { primary: '#b3141e', secondary: '#4a4f57' },
} as const;

/**
 * Where a defender of a generated battle map stands (worldgen/battle.ts names them): the village
 * outpost, the wall-walk, the gate towers, the courtyard. A campaign leaves some of them out.
 */
export type GarrisonGroup = 'outpost' | 'wall' | 'tower' | 'courtyard';
export const GARRISON_GROUPS: readonly GarrisonGroup[] = ['outpost', 'wall', 'tower', 'courtyard'];

/** Defenders' id prefixes by group (the courtyard's ids are `def-<n>`). */
export const GARRISON_ID_PREFIX: Readonly<Record<GarrisonGroup, string>> = { outpost: 'def-out-', wall: 'def-wall-', tower: 'def-tower-', courtyard: 'def-' };

const COURTYARD_ID = /^def-\d+$/;

/** The group of a generated map's defender, from its id (null for any other unit). */
export function garrisonGroupOf(id: string): GarrisonGroup | null {
  for (const g of ['outpost', 'wall', 'tower'] as const) if (id.startsWith(GARRISON_ID_PREFIX[g])) return g;
  return COURTYARD_ID.test(id) ? 'courtyard' : null;
}

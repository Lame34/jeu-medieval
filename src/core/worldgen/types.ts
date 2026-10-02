import type { Vec2 } from '../math/vec2.ts';
import type { Faction } from '../rules/types.ts';
import type { TerrainData } from '../terrain-data/terrain-data.ts';

/** Everything the renderer needs to dress a generated map; all positions in world metres. */
export interface WorldLayout {
  readonly name: string;
  readonly terrain: TerrainData;
  /** Playable area (the rest is decorative margin). */
  readonly playable: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
  readonly trees: readonly TreeInstance[];
  readonly fields: readonly FieldPatch[];
  readonly houses: readonly HouseSite[];
  readonly water: readonly WaterBody[];
  readonly roads: readonly RoadLine[];
  readonly hedges: readonly HedgeLine[];
  readonly walls: readonly WallRun[];
  readonly towers: readonly TowerSite[];
  readonly gates: readonly GateSite[];
  readonly keeps: readonly KeepSite[];
  readonly bridges: readonly BridgeSite[];
  readonly units: readonly UnitMarker[];
  /** Decorative props (mossy rocks, haystacks, fallen logs); none when absent. */
  readonly props?: readonly PropSite[];
  /** Attacker deployment zone (battle maps). */
  readonly deployment?: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
  /** Suggested camera focus for the opening shot. */
  readonly focus: Vec2;
  /** Deck elevation per cell (wall-walks, tower tops, stairs), for NavGrid.deck; none when absent. */
  readonly deck?: Float32Array;
  readonly stairs?: readonly StairSite[];
}

/** Stairs up to a wall-walk: a straight run from `bottom` (courtyard) to `top` (wall-walk height). */
export interface StairSite {
  readonly id: string;
  readonly bottom: Vec2;
  readonly top: Vec2;
  readonly widthM: number;
  readonly bottomHeightM: number;
  readonly topHeightM: number;
}

export interface GateSite {
  readonly id: string;
  readonly center: Vec2;
  /** Direction the gate faces (outwards), in turns. */
  readonly rotationTurns: number;
  readonly openingM: number;
  readonly heightM: number;
  readonly baseHeightM: number;
  /** A drawbridge spans the moat in front of the gate. */
  readonly drawbridge: boolean;
  /** The defender working the drawbridge winch: killing them lowers it (J4). */
  readonly winchOperatorId?: string;
}

export interface KeepSite {
  readonly id: string;
  readonly center: Vec2;
  readonly widthM: number;
  readonly depthM: number;
  readonly heightM: number;
  readonly rotationTurns: number;
  readonly baseHeightM: number;
}

export interface BridgeSite {
  readonly id: string;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly widthM: number;
  readonly deckHeightM: number;
}

export const TREE_SPECIES = ['oak', 'beech', 'birch', 'pine', 'bush', 'fern'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

export interface TreeInstance {
  readonly species: TreeSpecies;
  readonly position: Vec2;
  readonly scale: number;
  /** Yaw in turns [0, 1). */
  readonly rotationTurns: number;
  /** Colour variation in [-1, 1]. */
  readonly tint: number;
}

export type CropKind = 'wheat' | 'rye' | 'fallow';

export interface FieldPatch {
  readonly id: string;
  readonly crop: CropKind;
  readonly polygon: readonly Vec2[];
  /** Furrow direction in turns. */
  readonly furrowTurns: number;
}

export type RoofKind = 'thatch' | 'tile';

export interface HouseSite {
  readonly id: string;
  readonly center: Vec2;
  readonly rotationTurns: number;
  /** Footprint in metres, multiples of the kit's 2 m module. */
  readonly widthM: number;
  readonly depthM: number;
  readonly floors: 1 | 2;
  readonly roof: RoofKind;
  readonly seed: number;
  /** Ground height the house is levelled to. */
  readonly baseHeightM: number;
}

export interface WaterBody {
  readonly id: string;
  readonly kind: 'river' | 'moat';
  readonly centerline: readonly Vec2[];
  readonly widthM: number;
  readonly levelM: number;
}

export interface RoadLine {
  readonly id: string;
  readonly kind: 'road' | 'path';
  readonly centerline: readonly Vec2[];
  readonly widthM: number;
}

export interface HedgeLine {
  readonly id: string;
  readonly kind: 'hedge' | 'dryStoneWall';
  readonly points: readonly Vec2[];
}

export interface WallRun {
  readonly id: string;
  readonly points: readonly Vec2[];
  readonly heightM: number;
  readonly thicknessM: number;
  readonly baseHeightM: number;
}

export interface TowerSite {
  readonly id: string;
  readonly center: Vec2;
  readonly radiusM: number;
  readonly heightM: number;
  readonly baseHeightM: number;
  /** Round towers get a conical roof; square gate towers stay crenellated. */
  readonly shape?: 'round' | 'square';
}

export type PropKind = 'rock' | 'haystack' | 'log' | 'postern';

export interface PropSite {
  readonly kind: PropKind;
  readonly position: Vec2;
  readonly rotationTurns: number;
  /** Size factor (rock: radius in m; haystack, log and postern: 1 = nominal size). */
  readonly scale: number;
}

export interface UnitMarker {
  readonly id: string;
  readonly faction: Faction;
  readonly typeKey: string;
  readonly position: Vec2;
  readonly facingTurns: number;
  /** Absolute height of the surface the unit stands on (wall-walk…); terrain when absent. */
  readonly elevationM?: number;
}

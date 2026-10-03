/**
 * Which of the five assault approaches (brief §9.8) a battle map really allows, judged with the
 * siege rules themselves (J4) from where the attackers start: the deployment zone for the troops,
 * the siege park for the engines and their sapper.
 *
 *   drawbridge  an archer can reach a spot to shoot the winch operator, or set the bridge alight
 *   ram         once the bridge is down, the ram reaches a cell from which it strikes the gate
 *   breach      the catapult reaches a spot with a curtain segment in range
 *   sap         a sapper reaches the moat slot facing a segment, then (filled) that wall's foot
 *   siegeTower  over the same causeway, the tower reaches docking distance of the segment
 */
import { distance, type Vec2 } from '../math/vec2.ts';
import { lineOfSight } from '../nav-grid/line-of-sight.ts';
import { IMPASSABLE } from '../nav-grid/nav-grid.ts';
import { computeReachable, type ReachableField } from '../nav-grid/reachable.ts';
import type { GameRules, MovementProfile } from '../rules/types.ts';
import { projectOnPolyline } from '../worldgen/geometry.ts';
import type { WorldLayout } from '../worldgen/types.ts';
import { createBattleContext, deckAt, type BattleContext } from './context.ts';
import { cellIndexOf } from './create.ts';
import { fillCells, fillSiteAt, moatsOf } from './moat.ts';
import { distanceToCells } from './siege.ts';
import { initialStructures, planStructures, syncNav, type StructureDef } from './structures.ts';
import type { StructureState, WorkState } from './types.ts';

export const ASSAULT_APPROACHES = ['drawbridge', 'ram', 'breach', 'sap', 'siegeTower'] as const;
export type AssaultApproach = (typeof ASSAULT_APPROACHES)[number];

const UNBOUNDED_AP = 1e9;
/** Shooting spots are tried on a lattice of this many cells (the operator check casts rays). */
const SHOT_LATTICE = 3;
/** A moat slot faces a segment when it lies within this distance of the segment's centre (m). */
const SLOT_FACING_M = 16;

function reach(ctx: BattleContext, profile: MovementProfile, from: Vec2): ReachableField {
  return computeReachable(ctx.paths, { profile, origin: cellIndexOf(ctx, from), budget: UNBOUNDED_AP });
}

/** Reached cells (centres), every `step` cells. */
function* reached(field: ReachableField, step = 1): Generator<Vec2> {
  for (let lz = 0; lz < field.depth; lz += step) {
    for (let lx = 0; lx < field.width; lx += step) {
      if ((field.cost[lz * field.width + lx] as number) === IMPASSABLE) continue;
      yield { x: field.minCx + lx + 0.5, z: field.minCz + lz + 0.5 };
    }
  }
}

function anyReached(field: ReachableField, pred: (p: Vec2) => boolean, step = 1): boolean {
  for (const p of reached(field, step)) if (pred(p)) return true;
  return false;
}

/** The approaches the map allows, each with what made it viable or not. */
export function viableApproaches(layout: WorldLayout, rules: GameRules): { viable: AssaultApproach[]; notes: Record<AssaultApproach, string> } {
  const ctx = createBattleContext(layout.terrain, rules, layout.deck, planStructures(layout, rules.structures), moatsOf(layout));
  const intact: readonly StructureState[] = initialStructures(ctx.structures);
  const noWorks: readonly WorkState[] = [];
  const deploy = layout.deployment;
  const deployCentre = deploy ? { x: (deploy.minX + deploy.maxX) / 2, z: (deploy.minZ + deploy.maxZ) / 2 } : layout.focus;
  const startOf = (typeKey: string): Vec2 => layout.units.find((u) => u.faction === 'attacker' && u.typeKey === typeKey && u.id.startsWith('att-siege'))?.position ?? deployCentre;
  const notes = {} as Record<AssaultApproach, string>;
  const viable: AssaultApproach[] = [];
  const walls = ctx.structures.filter((d) => d.kind === 'wall');
  const gate = ctx.structures.find((d) => d.kind === 'gate');
  const bridge = ctx.structures.find((d) => d.kind === 'drawbridge');
  const archer = rules.units['archer']?.attack;
  const catapult = rules.units['catapult']?.attack;
  const d = rules.damage;

  // --- Drawbridge: the winch operator within an archer's shot, or the bridge within a fire arrow's.
  syncNav(ctx, intact, noWorks);
  const troops = reach(ctx, 'lightFoot', deployCentre);
  const operator = bridge?.operatorId ? layout.units.find((u) => u.id === bridge.operatorId) : undefined;
  const shotAt = (target: Vec2, targetDeck: number, targetHeight: number) =>
    archer !== undefined &&
    archer !== null &&
    anyReached(
      troops,
      (p) => {
        // Height advantage as the combat rules count it: whole steps between standing heights.
        const shooter = (ctx.nav.centerHeight[cellIndexOf(ctx, p)] as number) + deckAt(ctx, p);
        const aimed = (ctx.nav.centerHeight[cellIndexOf(ctx, target)] as number) + targetDeck;
        const steps = Math.trunc((shooter - aimed) / d.heightStepM);
        if (distance(p, target) > archer.rangeM * Math.max(0, 1 + steps * d.rangePerHeightStep)) return false;
        return lineOfSight(ctx.nav, { from: p, to: target, eyeHeightM: rules.movement.eyeHeightM, targetHeightM: targetHeight, fromElevationM: deckAt(ctx, p), toElevationM: targetDeck }).visible;
      },
      SHOT_LATTICE,
    );
  if (bridge && operator && shotAt(operator.position, deckAt(ctx, operator.position), rules.movement.targetHeightM)) notes.drawbridge = 'treuilliste à portée de tir';
  else if (bridge && bridge.cells.length > 0) {
    const mid = bridge.cells[Math.floor(bridge.cells.length / 2)] as number;
    const at = { x: (mid % ctx.nav.width) + 0.5, z: Math.floor(mid / ctx.nav.width) + 0.5 };
    if (shotAt(at, 0, rules.fire.targetHeightM + 2)) notes.drawbridge = 'pont à portée de flèche enflammée';
  }
  if (notes.drawbridge) viable.push('drawbridge');
  else notes.drawbridge = bridge ? 'ni treuilliste ni pont à portée' : 'pas de pont-levis';

  // --- Breach: the catapult within range of a segment.
  if (catapult) {
    const engines = reach(ctx, 'engine', startOf('catapult'));
    const inRange = anyReached(engines, (p) => walls.some((w) => distanceToCells(ctx, w.cells, p) <= catapult.rangeM), 2);
    notes.breach = inRange ? 'courtine à portée de catapulte' : 'aucune courtine à portée';
    if (inRange) viable.push('breach');
  } else notes.breach = 'pas de catapulte';

  // --- Ram: a cell from which it strikes the gate (once the bridge is down, when there is one).
  if (gate) {
    syncNav(
      ctx,
      bridge ? intact.map((s) => (s.id === bridge.id ? { ...s, broken: true } : s)) : intact,
      noWorks,
    );
    const rams = reach(ctx, 'engine', startOf('ram'));
    const atGate = anyReached(rams, (p) => distanceToCells(ctx, gate.cells, p) <= d.meleeReachM);
    notes.ram = atGate ? 'le bélier atteint la porte' : 'la porte reste hors d’atteinte';
    if (atGate) viable.push('ram');
  } else notes.ram = 'pas de porte';

  // --- Sap and siege tower: the moat slot facing each segment, filled.
  let sapOk = false;
  let towerOk = false;
  const moat = ctx.moats[0];
  for (const wall of moat ? walls : []) {
    if (sapOk && towerOk) break;
    const slot = facingSlot(ctx, wall, moat?.centerline ?? []);
    if (!slot) continue;
    syncNav(ctx, intact, noWorks);
    const sappers = reach(ctx, 'lightFoot', startOf('sapper'));
    const cells = fillCells(ctx, slot);
    if (!anyReached(sappers, (p) => distanceToCells(ctx, cells, p) <= d.meleeReachM)) continue;
    syncNav(ctx, intact, [{ id: slot, progress: rules.structures.fillTurns, done: true }]);
    if (!sapOk) sapOk = anyReached(reach(ctx, 'lightFoot', startOf('sapper')), (p) => distanceToCells(ctx, wall.cells, p) <= d.meleeReachM);
    if (!towerOk) towerOk = anyReached(reach(ctx, 'engine', startOf('siegeTower')), (p) => distanceToCells(ctx, wall.cells, p) <= rules.structures.towerDockReachM);
  }
  notes.sap = sapOk ? 'un sapeur atteint le pied d’un mur par les fascines' : 'aucun pied de mur atteignable';
  notes.siegeTower = towerOk ? 'la tour atteint un mur par les fascines' : 'aucun mur atteignable par la tour';
  if (sapOk) viable.push('sap');
  if (towerOk) viable.push('siegeTower');
  syncNav(ctx, intact, noWorks);
  return { viable: ASSAULT_APPROACHES.filter((a) => viable.includes(a)), notes };
}

/** The moat slot right in front of a segment (on the outside), if any. */
function facingSlot(ctx: BattleContext, wall: StructureDef, centerline: readonly Vec2[]): string | null {
  if (centerline.length < 2) return null;
  const proj = projectOnPolyline(wall.center, centerline);
  if (proj.distance > SLOT_FACING_M) return null;
  return fillSiteAt(ctx, proj.point);
}

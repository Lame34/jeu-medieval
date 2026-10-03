/**
 * A hero's abilities from the HUD or the keyboard (1, 2): one with no target is used at once;
 * one that needs a target is armed, and the pointer aims it (BattleDirector). Pressing it again
 * disarms it.
 */
import { cooldownOf } from '../../core/battle/heroes.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi } from '../../state/battle-ui.ts';
import type { BattleSession } from './session.ts';

export function triggerAbility(session: BattleSession, index: number): void {
  const ui = useBattleUi.getState();
  const unit = ui.selectedId ? session.state.units.find((u) => u.id === ui.selectedId) : undefined;
  if (!unit?.alive || ui.busy) return;
  const ability = DEFAULT_RULES.heroes[unit.typeKey]?.abilities[index];
  if (!ability) return;
  if (cooldownOf(unit, ability.id) > 0) {
    ui.pushLog([`${ability.name} : encore ${cooldownOf(unit, ability.id)} tour${cooldownOf(unit, ability.id) > 1 ? 's' : ''} de recharge.`]);
    return;
  }
  if (ability.target === 'self') {
    ui.armAbility(null);
    session.issue({ type: 'ability', unitId: unit.id, abilityId: ability.id });
    return;
  }
  ui.armAbility(ui.armedAbility === ability.id ? null : ability.id);
}

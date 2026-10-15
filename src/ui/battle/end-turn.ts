/**
 * Ending the player's turn (brief §10: a warning while units can still act). The first request
 * with units still able to move or act only arms the warning; the second ends the turn. Shared by
 * the HUD's button and the Enter key; the option turns the warning off.
 */
import { canStillAct } from '../../core/battle/turn.ts';
import { useBattleUi } from '../../state/battle-ui.ts';
import { useSettings } from '../../state/settings.ts';
import { PLAYER_FACTION, type BattleSession } from './session.ts';

/** Men of ours who could still move or act this turn. */
export function unitsStillActing(session: BattleSession): number {
  return session.state.units.filter((u) => u.faction === PLAYER_FACTION && canStillAct(session.ctx, session.state, u)).length;
}

export function requestEndTurn(session: BattleSession): void {
  const ui = useBattleUi.getState();
  if (useSettings.getState().confirmEndTurn && !ui.endTurnArmed && unitsStillActing(session) > 0) {
    ui.armEndTurn(true);
    return;
  }
  ui.armEndTurn(false);
  ui.select(null);
  session.issue({ type: 'endTurn' });
}

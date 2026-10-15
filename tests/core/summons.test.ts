/**
 * The herald's summons (src/core/battle/summons.ts): the chance grows with the garrison's losses
 * and the breaches, its captain holds it back, a sworn captain refuses outright; the herald waits
 * between two summons; an accepted summons ends the battle; a replay is exact.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, hashBattleState, replay, type BattleState, type Command } from '@core/index.ts';
import { previewSummons, summonsWait } from '@core/battle/summons.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildFixture, defaultUnits, IDS, spawn, withBroken, withUnit } from './siege-fixture.ts';

const S = DEFAULT_RULES.battle.summons;
const CAPTAIN = 'def-captain';
const f = buildFixture(DEFAULT_RULES, [...defaultUnits(), spawn(CAPTAIN, 'officer', 40, 9)]);
const fresh = (sworn = false) => createBattle(f.ctx, 'summons-test', { ...f.scenario, ...(sworn ? { sworn: true } : {}) });
const chance = (s: BattleState) => {
  const r = previewSummons(f.ctx, s);
  if (!r.ok) throw new Error(r.reason);
  return r.preview.chance;
};
const without = (s: BattleState, ...ids: string[]) => ids.reduce((acc, id) => withUnit(acc, id, { alive: false }), s);
const SUMMON: Command = { type: 'summon' };
const ROUND: Command[] = [{ type: 'endTurn' }, { type: 'endTurn' }];

describe('previewSummons', () => {
  it('starts low, the captain halving it, and grows with the losses and the breaches', () => {
    const s = fresh();
    expect(chance(s)).toBeCloseTo(S.base * S.captainFactor, 9);
    const hurt = without(s, IDS.guardA, IDS.guardB);
    expect(chance(hurt)).toBeGreaterThan(chance(s));
    const breached = withBroken(hurt, IDS.wallA);
    expect(chance(breached)).toBeCloseTo(chance(hurt) + S.perBreach * S.captainFactor, 9);
    const leaderless = without(breached, CAPTAIN);
    expect(chance(leaderless)).toBeGreaterThan(chance(breached));
  });

  it('counts breaches up to maxBreaches, and never goes past max', () => {
    const s = without(fresh(), CAPTAIN);
    const two = withBroken(s, IDS.wallA, IDS.wallB);
    const three = withBroken(two, IDS.gate);
    expect(chance(three)).toBeCloseTo(chance(two), 9);
    const ruined = without(three, IDS.guardA, IDS.guardB, IDS.near, IDS.far, IDS.winch);
    expect(chance(ruined)).toBeLessThanOrEqual(S.max);
  });

  it('a sworn captain refuses outright while he stands', () => {
    const s = fresh(true);
    expect(previewSummons(f.ctx, s)).toMatchObject({ ok: true, preview: { chance: 0, sworn: true } });
    expect(chance(without(s, CAPTAIN))).toBeGreaterThan(0);
  });

  it('only the attackers summon', () => {
    const theirs = applyCommand(f.ctx, fresh(), { type: 'endTurn' }).state;
    expect(previewSummons(f.ctx, theirs)).toEqual({ ok: false, reason: 'notYourTurn' });
  });
});

describe('the summons in a battle', () => {
  it('refused, the herald waits cooldownRounds before he may go again', () => {
    const r = applyCommand(f.ctx, fresh(true), SUMMON);
    expect(r.rejection).toBeNull();
    expect(r.events).toEqual([{ type: 'garrisonSummoned', chance: 0, accepted: false }]);
    expect(r.state.status).toBe('ongoing');
    expect(summonsWait(DEFAULT_RULES, r.state)).toBe(S.cooldownRounds);
    expect(applyCommand(f.ctx, r.state, SUMMON).rejection).toBe('summonsTooSoon');
    let s = r.state;
    for (let i = 0; i < S.cooldownRounds; i++) s = ROUND.reduce((acc, c) => applyCommand(f.ctx, acc, c).state, s);
    expect(summonsWait(DEFAULT_RULES, s)).toBe(0);
    expect(applyCommand(f.ctx, s, SUMMON).rejection).toBeNull();
  });

  it('accepted, the castle is taken: the battle ends, the garrison yields', () => {
    // A garrison all but beaten: its chance is high; some seed lets it yield.
    let yielded: ReturnType<typeof applyCommand> | null = null;
    for (let k = 0; k < 40 && !yielded; k++) {
      const s = without(withBroken(createBattle(f.ctx, `summons-${k}`, f.scenario), IDS.wallA, IDS.wallB), CAPTAIN, IDS.guardA, IDS.guardB);
      const r = applyCommand(f.ctx, s, SUMMON);
      if (r.state.status === 'attackerWon') yielded = r;
    }
    expect(yielded).not.toBeNull();
    expect(yielded!.events.map((e) => e.type)).toEqual(['garrisonSummoned', 'battleEnded']);
    expect(yielded!.events[1]).toEqual({ type: 'battleEnded', status: 'attackerWon', reason: 'surrendered' });
    expect(yielded!.state.summons).toEqual({ lastTurn: 1, accepted: true });
  });

  it('replays exactly', () => {
    const commands: Command[] = [SUMMON, ...ROUND, ...ROUND, ...ROUND, SUMMON];
    let s = fresh();
    for (const c of commands) s = applyCommand(f.ctx, s, c).state;
    expect(hashBattleState(replay(f.ctx, 'summons-test', f.scenario, commands).state)).toBe(hashBattleState(s));
  });
});

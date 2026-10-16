/**
 * Saves (J7): the campaign's progress read back strictly (a damaged or tampered record is dropped,
 * never trusted), two tabs' progress merged, and a battle in progress taken up exactly — or set
 * aside when its orders no longer lead where they led.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, hashBattleState, type BattleState, type Command, type Scenario } from '@core/index.ts';
import { BATTLE_SAVE_VERSION, parseBattleSave, replaySave } from '@core/save/battle-save.ts';
import type { BattleDeeds } from '@core/campaign/deeds.ts';
import { chronicledDeeds, EMPTY_PROGRESS, mergeProgress, parseDeeds, parseProgress, PROGRESS_VERSION, serializeProgress, type SavedProgress } from '@core/save/progress.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, flatTerrain, rulesWithDamageOverrides } from './helpers.ts';

const BANNERS = { taken: true, swift: false, spared: true, feat: false };
const RECORD = { banners: BANNERS, stratagem: 'lettres', turns: 12 };
/** The deeds of a battle won, as the chronicle keeps them (ADR-050). */
const DEEDS: BattleDeeds = {
  banners: BANNERS,
  stratagem: 'lettres',
  rank: 'knight',
  provisions: ['paie'],
  wounded: ['heroArcher'],
  assault: 2,
  ending: 'surrendered',
  turns: 12,
  turnLimit: 22,
  lost: 3,
  slain: 6,
  garrison: 10,
  breaches: 2,
  mined: 1,
  gate: true,
  portcullis: false,
  drawbridge: true,
  burned: ['drawbridge'],
  filled: 1,
  climbed: 2,
  captain: true,
};

describe('parseProgress: a strict reading of the saved campaign', () => {
  it('reads back what was written, with its version', () => {
    const progress: SavedProgress = { conquered: { 'roche-grise': { ...RECORD, deeds: DEEDS }, moulins: RECORD }, resting: ['heroArcher'], tutorialDone: true, prologueSeen: true, spent: 30, pending: ['fagots'], failed: { brumefond: 2 } };
    const text = serializeProgress(progress);
    expect(JSON.parse(text)).toMatchObject({ version: PROGRESS_VERSION });
    expect(parseProgress(JSON.parse(text))).toEqual(progress);
  });

  it('upgrades a format-1 save: every castle kept, its feat of arms not yet won (ADR-048)', () => {
    const v1 = { version: 1, conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: false }, stratagem: 'aube', turns: 14 } }, resting: [], tutorialDone: true, prologueSeen: true };
    expect(parseProgress(v1).conquered['roche-grise']).toEqual({ banners: { taken: true, swift: true, spared: false, feat: false }, stratagem: 'aube', turns: 14 });
    // The same without any version: the first format too.
    const { version: _v, ...unversioned } = v1;
    expect(parseProgress(unversioned)).toEqual(parseProgress(v1));
  });

  it('drops a format-2 castle record without its feat banner (damaged)', () => {
    const v2 = { version: 2, conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: false }, stratagem: 'aube', turns: 14 } } };
    expect(parseProgress(v2).conquered).toEqual({});
  });

  it('upgrades a format-2 save: nothing spent, no provision waiting, no failed assault, no deeds (ADR-049, ADR-050)', () => {
    const v2 = { version: 2, conquered: { 'roche-grise': RECORD }, resting: [], tutorialDone: true, prologueSeen: true };
    expect(parseProgress(v2)).toEqual({ ...EMPTY_PROGRESS, conquered: { 'roche-grise': RECORD }, tutorialDone: true, prologueSeen: true });
  });

  it('drops damaged deeds, but keeps the castle', () => {
    for (const bad of [{ ...DEEDS, ending: 'treason' }, { ...DEEDS, rank: 'king' }, { ...DEEDS, lost: -1 }, { ...DEEDS, burned: ['tower'] }, { ...DEEDS, assault: 0 }, { ...DEEDS, provisions: [3] }, { ...DEEDS, captain: 'yes' }, 'deeds']) {
      expect(parseProgress({ version: PROGRESS_VERSION, conquered: { 'roche-grise': { ...RECORD, deeds: bad } } }).conquered).toEqual({ 'roche-grise': RECORD });
    }
    expect(parseDeeds(JSON.parse(JSON.stringify(DEEDS)))).toEqual(DEEDS);
  });

  it('keeps only known provisions waiting, sound marcs spent and counted assaults', () => {
    const known = { castles: new Set(['roche-grise', 'moulins']), provisions: new Set(['paie', 'fagots']) };
    const read = parseProgress({ version: PROGRESS_VERSION, pending: ['paie', 'paie', 'trésor', 7], spent: -5, failed: { moulins: 2, inconnu: 1, 'roche-grise': 1.5 } }, known);
    expect(read).toMatchObject({ pending: ['paie'], spent: 0, failed: { moulins: 2 } });
  });

  it('reads anything that is not an object as a new campaign', () => {
    for (const raw of [undefined, null, 42, 'texte', [RECORD], true]) expect(parseProgress(raw)).toEqual(EMPTY_PROGRESS);
  });

  it('drops damaged castle records and keeps the sound ones', () => {
    const raw = {
      conquered: {
        'roche-grise': RECORD,
        moulins: { banners: { taken: 'oui', swift: false, spared: false }, stratagem: null, turns: 10 },
        brumefond: { banners: BANNERS, stratagem: null, turns: -3 },
        'pierre-ardente': { banners: BANNERS, stratagem: '<script>', turns: 9 },
        'haute-garde': { banners: BANNERS, stratagem: null, turns: 1.5 },
        'clé avec espace': RECORD,
      },
    };
    expect(parseProgress(raw).conquered).toEqual({ 'roche-grise': RECORD });
  });

  it('keeps only the campaign’s own castles when told which they are', () => {
    expect(parseProgress({ conquered: { 'roche-grise': RECORD, inconnu: RECORD } }, { castles: new Set(['roche-grise']) }).conquered).toEqual({ 'roche-grise': RECORD });
  });

  it('keeps each resting hero once, as a plain id', () => {
    expect(parseProgress({ resting: ['heroArcher', 'heroArcher', 7, '', 'héros !'] }).resting).toEqual(['heroArcher']);
  });

  it('takes only a true boolean for the lessons and the prologue', () => {
    expect(parseProgress({ tutorialDone: 'true', prologueSeen: 1 })).toMatchObject({ tutorialDone: false, prologueSeen: false });
  });
});

describe('mergeProgress: two tabs never undo each other’s castles', () => {
  it('keeps the castles of both, the best banners and the fewest rounds', () => {
    const ours: SavedProgress = { ...EMPTY_PROGRESS, conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: false, feat: true }, stratagem: 'aube', turns: 15 } } };
    const theirs: SavedProgress = { ...EMPTY_PROGRESS, resting: ['heroKnight'], conquered: { 'roche-grise': { banners: { taken: true, swift: false, spared: true, feat: false }, stratagem: 'lettres', turns: 11 }, moulins: RECORD } };
    const merged = mergeProgress(theirs, ours);
    expect(merged.conquered['roche-grise']).toEqual({ banners: { taken: true, swift: true, spared: true, feat: true }, stratagem: 'aube', turns: 11 });
    expect(merged.conquered['moulins']).toEqual(RECORD);
    expect(merged.resting).toEqual(['heroKnight']);
  });

  it('keeps the most marcs spent and failed assaults either counted, and the provisions waiting of the one written last', () => {
    const latest: SavedProgress = { ...EMPTY_PROGRESS, spent: 10, pending: ['fagots'], failed: { moulins: 1 } };
    const other: SavedProgress = { ...EMPTY_PROGRESS, spent: 40, pending: ['paie'], failed: { moulins: 3, brumefond: 1 } };
    expect(mergeProgress(latest, other)).toMatchObject({ spent: 40, pending: ['fagots'], failed: { moulins: 3, brumefond: 1 } });
  });

  it('keeps the deeds of the battle with more banners, the later on a tie', () => {
    const best: BattleDeeds = { ...DEEDS, banners: { taken: true, swift: true, spared: true, feat: true }, turns: 9 };
    expect(chronicledDeeds(best, DEEDS)).toBe(best);
    expect(chronicledDeeds(DEEDS, best)).toBe(best);
    const tie: BattleDeeds = { ...DEEDS, turns: 15 };
    expect(chronicledDeeds(DEEDS, tie)).toBe(tie);
    expect(chronicledDeeds(undefined, DEEDS)).toBe(DEEDS);
    const merged = mergeProgress({ ...EMPTY_PROGRESS, conquered: { moulins: { ...RECORD, deeds: DEEDS } } }, { ...EMPTY_PROGRESS, conquered: { moulins: { ...RECORD, deeds: best } } });
    expect(merged.conquered['moulins']?.deeds).toBe(best);
  });

  it('keeps the lessons and the prologue done in either', () => {
    expect(mergeProgress({ ...EMPTY_PROGRESS, tutorialDone: true }, { ...EMPTY_PROGRESS, prologueSeen: true })).toMatchObject({ tutorialDone: true, prologueSeen: true });
  });
});

/** A small battle: a sergeant facing a wall guard on open ground. */
function smallBattle(rules = DEFAULT_RULES) {
  const ctx = createBattleContext(flatTerrain(12, 12, 1), rules);
  const scenario: Scenario = {
    units: [
      { id: 'atk', typeKey: 'soldier', position: centerOf(2, 2) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
    ],
  };
  return { ctx, initial: createBattle(ctx, 'save-test', scenario) };
}

const ORDERS: readonly Command[] = [{ type: 'move', unitId: 'atk', to: centerOf(5, 5) }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'move', unitId: 'atk', to: centerOf(7, 7) }, { type: 'attack', unitId: 'atk', targetId: 'def' }];

function played(ctx: ReturnType<typeof smallBattle>['ctx'], initial: BattleState, orders: readonly Command[]): BattleState {
  return orders.reduce((s, c) => applyCommand(ctx, s, c).state, initial);
}

const save = (commands: readonly Command[], hash: string) => ({ version: BATTLE_SAVE_VERSION, key: 'skirmish:siege-1:1', url: '/battle?seed=siege-1&castle=1', title: 'Siège au hasard', turn: 2, savedAt: 1_791_700_000_000, absentHeroes: [], provisions: ['paie'], commands, hash });

describe('battle saves: a battle taken up exactly', () => {
  it('replays the saved orders to the very state that was saved', () => {
    const { ctx, initial } = smallBattle();
    const end = played(ctx, initial, ORDERS);
    const restored = replaySave(ctx, initial, { commands: ORDERS, hash: hashBattleState(end) });
    expect(restored).not.toBeNull();
    expect(hashBattleState(restored as BattleState)).toBe(hashBattleState(end));
  });

  it('sets the save aside when the rules have changed since (another version of the game)', () => {
    const { ctx, initial } = smallBattle();
    const hash = hashBattleState(played(ctx, initial, ORDERS));
    const changed = smallBattle(rulesWithDamageOverrides({ critChance: 0.5 }));
    expect(replaySave(changed.ctx, changed.initial, { commands: ORDERS, hash })).toBeNull();
  });

  it('sets aside an order that cannot be played rather than failing', () => {
    const { ctx, initial } = smallBattle();
    const broken = [{ type: 'move', unitId: 'atk' }] as unknown as Command[];
    expect(replaySave(ctx, initial, { commands: broken, hash: 'x' })).toBeNull();
  });

  it('reads back a save holding every kind of order, the summons and the end of a turn included', () => {
    const every: Command[] = [...ORDERS, { type: 'summon' }, { type: 'endTurn' }];
    const good = save(every, 'abc');
    expect(parseBattleSave(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it('upgrades a format-1 save: it began with no provision (ADR-049)', () => {
    const { provisions: _p, ...v1 } = { ...save(ORDERS, 'abc'), version: 1 };
    expect(parseBattleSave(v1)).toEqual({ ...save(ORDERS, 'abc'), provisions: [] });
  });

  it('reads back a sound save, and nothing from a damaged one', () => {
    const good = save(ORDERS, 'abc');
    expect(parseBattleSave(JSON.parse(JSON.stringify(good)))).toEqual(good);
    const damaged: Record<string, unknown>[] = [
      { ...good, version: 3 },
      { ...good, provisions: 'paie' },
      { ...good, provisions: [''] },
      { ...good, url: 'https://ailleurs.example/battle' },
      { ...good, turn: 0 },
      { ...good, commands: 'move' },
      { ...good, commands: [{ type: 'teleport' }] },
      { ...good, absentHeroes: [3] },
      { ...good, hash: '' },
    ];
    for (const raw of damaged) expect(parseBattleSave(raw)).toBeNull();
    expect(parseBattleSave(null)).toBeNull();
  });
});

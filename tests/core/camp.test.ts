/**
 * The host's tents (ADR-049): what the banners bring, the purse once provisions are bought or
 * spent, what can be bought, the mire's fee; and the data's validation.
 */
import { describe, expect, it } from 'vitest';
import { canBuy, canHeal, earned, priceOf, provisionsOf, purse, type Coffer } from '@core/campaign/camp.ts';
import type { BattleDeeds } from '@core/campaign/deeds.ts';
import { withHealing, withOutcome, withoutPurchase, withPurchase, type BattleOutcome } from '@core/campaign/outcome.ts';
import { validateCampaign } from '@core/campaign/validate.ts';
import { EMPTY_PROGRESS, type SavedProgress } from '@core/save/progress.ts';
import { RulesValidationError } from '@core/rules/json.ts';
import { CAMPAIGN, DEFAULT_RULES } from '@data/index.ts';
import rawCampaign from '@data/campaign.json' with { type: 'json' };

const ALL = { taken: true, swift: true, spared: true, feat: true };
const TAKEN = { taken: true, swift: false, spared: false, feat: false };
const PER_BANNER = CAMPAIGN.camp.perBanner;
const price = (id: string) => CAMPAIGN.camp.provisions.find((p) => p.id === id)!.price;
const raw = () => structuredClone(rawCampaign) as unknown as { camp: { perBanner: number; provisions: Record<string, unknown>[] } };

describe('the purse', () => {
  const coffer: Coffer = { conquered: { 'roche-grise': { banners: ALL }, moulins: { banners: TAKEN } }, spent: 0, pending: [] };

  it('holds what the banners won bring, each once', () => {
    expect(earned(CAMPAIGN, coffer.conquered)).toBe(5 * PER_BANNER);
    expect(purse(CAMPAIGN, coffer)).toBe(5 * PER_BANNER);
  });

  it('is what the banners bring, less what was spent and what the provisions waiting cost', () => {
    expect(purse(CAMPAIGN, { ...coffer, spent: 10, pending: ['paie', 'fagots'] })).toBe(5 * PER_BANNER - 10 - price('paie') - price('fagots'));
    expect(priceOf(CAMPAIGN, ['paie', 'inconnue'])).toBe(price('paie'));
  });

  it('never falls below nothing', () => {
    expect(purse(CAMPAIGN, { ...coffer, spent: 1_000 })).toBe(0);
  });

  it('buys a provision it can pay for, once', () => {
    expect(canBuy(CAMPAIGN, coffer, 'mangonneau')).toBe(true);
    expect(canBuy(CAMPAIGN, { ...coffer, pending: ['mangonneau'] }, 'mangonneau')).toBe(false);
    expect(canBuy(CAMPAIGN, { ...coffer, spent: 5 * PER_BANNER - price('mangonneau') + 1 }, 'mangonneau')).toBe(false);
    expect(canBuy(CAMPAIGN, coffer, 'inconnue')).toBe(false);
  });

  it('pays the mire only from a purse that holds his fee', () => {
    expect(canHeal(CAMPAIGN, coffer)).toBe(true);
    expect(canHeal(CAMPAIGN, { ...coffer, spent: 5 * PER_BANNER })).toBe(false);
  });

  it('names the provisions in the tents’ order, unknown ones left out', () => {
    expect(provisionsOf(CAMPAIGN, ['mangonneau', 'paie', 'inconnue']).map((p) => p.id)).toEqual(['paie', 'mangonneau']);
  });
});

describe('the tents’ data', () => {
  it('ships its provisions, each with a price, a summary, a line for the chronicle and effects for our side', () => {
    expect(CAMPAIGN.camp.provisions.map((p) => p.id)).toEqual(['paie', 'fagots', 'armes', 'sergents', 'mangonneau']);
    for (const p of CAMPAIGN.camp.provisions) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.summary.length).toBeGreaterThan(10);
      expect(p.told.length).toBeGreaterThan(10);
      expect(Object.keys(p.effects).length).toBeGreaterThan(0);
    }
  });

  it('rejects a provision named twice, one without a line for the chronicle, and a price out of bounds', () => {
    const twice = raw();
    twice.camp.provisions.push(structuredClone(twice.camp.provisions[0]!));
    expect(() => validateCampaign(twice, DEFAULT_RULES)).toThrow(/duplicate provision/);
    const untold = raw();
    delete untold.camp.provisions[0]!['told'];
    expect(() => validateCampaign(untold, DEFAULT_RULES)).toThrow(RulesValidationError);
    const free = raw();
    free.camp.provisions[0]!['price'] = 0;
    expect(() => validateCampaign(free, DEFAULT_RULES)).toThrow(/price/);
  });

  it('rejects a provision that would bring the garrison men', () => {
    const traitor = raw();
    traitor.camp.provisions[0]!['effects'] = { reinforce: [{ typeKey: 'wallGuard', count: 1 }] };
    expect(() => validateCampaign(traitor, DEFAULT_RULES)).toThrow(/not a attacker unit/);
  });
});

describe('the campaign after a battle, and at the tents', () => {
  const LOST = { taken: false, swift: false, spared: false, feat: false };
  const deeds = (banners: BattleOutcome['banners'], turns: number): BattleDeeds => ({
    banners, stratagem: null, rank: 'knight', provisions: ['paie'], wounded: [], assault: 2, ending: 'surrendered', turns, turnLimit: 22,
    lost: 1, slain: 5, garrison: 10, breaches: 1, mined: 0, gate: true, portcullis: false, drawbridge: true, burned: [], filled: 0, climbed: 0, captain: true,
  });
  const lost: BattleOutcome = { stratagem: null, banners: LOST, turns: 22, wounded: ['heroKnight'], deeds: null, provisions: ['paie'] };
  const won = (banners: BattleOutcome['banners'], turns: number): BattleOutcome => ({ stratagem: 'lettres', banners, turns, wounded: [], deeds: deeds(banners, turns), provisions: [] });
  const start: SavedProgress = { ...EMPTY_PROGRESS, conquered: { 'roche-grise': { banners: ALL, stratagem: 'lettres', turns: 9 } }, pending: ['paie', 'fagots'] };

  it('a lost assault counts against the castle, uses up its provisions and pays for them, and its wounded rest', () => {
    const after = withOutcome(CAMPAIGN, start, 'moulins', lost);
    expect(after).toMatchObject({ failed: { moulins: 1 }, pending: ['fagots'], spent: price('paie'), resting: ['heroKnight'] });
    expect(after.conquered['moulins']).toBeUndefined();
    expect(withOutcome(CAMPAIGN, after, 'moulins', lost).failed).toEqual({ moulins: 2 });
  });

  it('a victory takes the castle with its deeds; a later, better one keeps the best banners and its own deeds', () => {
    const first = withOutcome(CAMPAIGN, start, 'moulins', won(TAKEN, 20));
    expect(first.conquered['moulins']).toEqual({ banners: TAKEN, stratagem: 'lettres', turns: 20, deeds: deeds(TAKEN, 20) });
    const better = { taken: true, swift: true, spared: true, feat: false };
    const second = withOutcome(CAMPAIGN, first, 'moulins', won(better, 12));
    expect(second.conquered['moulins']).toEqual({ banners: better, stratagem: 'lettres', turns: 12, deeds: deeds(better, 12) });
    // A worse one changes neither the deeds nor the best banners; a defeat there is no failed assault.
    const worse = withOutcome(CAMPAIGN, second, 'moulins', won(TAKEN, 22));
    expect(worse.conquered['moulins']).toEqual(second.conquered['moulins']);
    expect(withOutcome(CAMPAIGN, second, 'moulins', lost).failed).toEqual({});
  });

  it('buys only what the purse holds, once; gives back; pays the mire for a companion who rests', () => {
    const coffer: SavedProgress = { ...EMPTY_PROGRESS, conquered: { 'roche-grise': { banners: TAKEN, stratagem: null, turns: 20 } }, resting: ['heroArcher'] };
    const bought = withPurchase(CAMPAIGN, coffer, 'paie');
    expect(bought.pending).toEqual(['paie']);
    expect(withPurchase(CAMPAIGN, bought, 'paie')).toBe(bought);
    expect(withPurchase(CAMPAIGN, bought, 'mangonneau')).toBe(bought);
    expect(withoutPurchase(bought, 'paie').pending).toEqual([]);
    const healed = withHealing(CAMPAIGN, coffer, 'heroArcher');
    expect(healed).toMatchObject({ resting: [], spent: CAMPAIGN.camp.healPrice });
    expect(withHealing(CAMPAIGN, coffer, 'heroKnight')).toBe(coffer);
    expect(withHealing(CAMPAIGN, bought, 'heroArcher')).toBe(bought);
  });
});

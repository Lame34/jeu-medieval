/**
 * What a castle's conditions and a stratagem do, in a few French lines for the campaign's letters
 * and the council's cards: boons, costs, and plain conditions.
 */
import type { BattleEffects, CampaignBattle, Stratagem } from '../../core/campaign/types.ts';
import type { GarrisonGroup } from '../../core/worldgen/garrison.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

export type EffectTone = 'boon' | 'cost' | 'plain';

export interface EffectLine {
  readonly tone: EffectTone;
  readonly text: string;
}

/** French plural of a noun: as is after s, x or z; with an x after -au and -eu (mangonneaux); with an s otherwise. */
function plural(word: string): string {
  if (/[sxz]$/.test(word)) return word;
  return /(au|eu)$/.test(word) ? `${word}x` : `${word}s`;
}

/** An assault before this hour is at dawn; from this one, at dusk (the night falls during the battle). */
const DAWN_UNTIL = 8;
const DUSK_FROM = 17;
/** From this many absentees, a castle's garrison is "clairsemée". */
const GARRISON_THIN = 3;

const GROUP_LABEL: Readonly<Record<GarrisonGroup, string>> = { outpost: 'du village', wall: 'du rempart', tower: 'des tours', courtyard: 'de la cour' };

const STRUCTURE_DOWN = { drawbridge: 'Pont-levis abaissé dès le départ', portcullis: 'Herse hors d’usage', gate: 'Porte enfoncée', wall: 'Une courtine effondrée' } as const;
const STRUCTURE_HURT = { drawbridge: 'Pont-levis', portcullis: 'Herse entamée', gate: 'Porte entamée', wall: 'Une courtine minée' } as const;

/** "2 arbalétriers", "1 sergent du rempart". */
export function unitCount(typeKey: string, n: number): string {
  const name = (DEFAULT_RULES.units[typeKey]?.name ?? typeKey).toLowerCase();
  if (n <= 1) return `${n} ${name}`;
  // A compound name takes the plural on its first word: « 2 sergents du rempart ».
  const space = name.indexOf(' ');
  const first = space < 0 ? name : name.slice(0, space);
  return `${n} ${plural(first)}${space < 0 ? '' : name.slice(space)}`;
}

/** "6 h", "22 h 30". */
export function hourLabel(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')}`;
}

function isNightHour(h: number): boolean {
  return h >= DEFAULT_RULES.weather.nightFrom || h < DEFAULT_RULES.weather.nightTo;
}

/** The lines of one set of effects (`base`: the castle's own, read as conditions, not changes). */
export function effectLines(e: BattleEffects, base = false): EffectLine[] {
  const out: EffectLine[] = [];
  // A castle's own absentees are told as the garrison's strength (castleLines).
  for (const c of base ? [] : (e.cut ?? [])) {
    const who = c.typeKey ? unitCount(c.typeKey, c.count) : `${c.count} défenseur${c.count > 1 ? 's' : ''}`;
    out.push({ tone: 'boon', text: c.group ? `${who} ${GROUP_LABEL[c.group]} en moins` : `${who} en moins` });
  }
  for (const r of e.reinforce ?? []) out.push({ tone: 'boon', text: `+${unitCount(r.typeKey, r.count)} dans vos rangs` });
  for (const s of e.structures ?? []) {
    out.push({ tone: 'boon', text: s.broken ? STRUCTURE_DOWN[s.kind] : `${STRUCTURE_HURT[s.kind]} (${Math.round((s.hpFraction ?? 1) * 100)} % de solidité)` });
  }
  if (e.fillMoat) out.push({ tone: 'boon', text: e.fillMoat > 1 ? `${e.fillMoat} tronçons de douve déjà comblés` : 'Un tronçon de douve déjà comblé, face à la tour' });
  const morale = e.morale ?? {};
  if (morale.attacker) out.push({ tone: morale.attacker > 0 ? 'boon' : 'cost', text: `Moral de l’ost ${morale.attacker > 0 ? '+' : '−'}${Math.abs(morale.attacker)}` });
  if (morale.defender) out.push({ tone: morale.defender < 0 ? 'boon' : 'cost', text: `Moral de la garnison ${morale.defender > 0 ? '+' : '−'}${Math.abs(morale.defender)}` });
  if (e.weather === 'fog') out.push({ tone: 'plain', text: `Brouillard : on ne voit qu’à ${DEFAULT_RULES.weather.fogSightM} m` });
  if (e.weather === 'rain') out.push({ tone: 'plain', text: 'Pluie : −10 % de précision, le feu prend mal' });
  if (e.weather === 'clear' && !base) out.push({ tone: 'plain', text: 'Ciel dégagé' });
  if (e.startHour !== undefined) {
    const night = isNightHour(e.startHour);
    const dawn = e.startHour < DAWN_UNTIL && !night;
    const dusk = e.startHour >= DUSK_FROM && !night;
    out.push({ tone: 'plain', text: `Assaut à ${hourLabel(e.startHour)}${night ? ' : nuit, portée −30 % hors des torches' : dawn ? ', à l’aube' : dusk ? ', au crépuscule : la nuit tombera' : ''}` });
  }
  if (e.turnLimit !== undefined) out.push({ tone: 'plain', text: `${e.turnLimit} tours avant les renforts du Félon` });
  if (e.turnDelta) out.push({ tone: e.turnDelta < 0 ? 'cost' : 'boon', text: e.turnDelta < 0 ? `${-e.turnDelta} tour${e.turnDelta < -1 ? 's' : ''} de moins pour prendre le château` : `${e.turnDelta} tour${e.turnDelta > 1 ? 's' : ''} de plus` });
  return out;
}

/** What the scouts know of a castle: its conditions, its weakened garrison, its deadline. */
export function castleLines(battle: CampaignBattle): EffectLine[] {
  const absent = (battle.battle.cut ?? []).reduce((n, c) => n + c.count, 0);
  const strength = absent >= GARRISON_THIN ? 'Garnison clairsemée' : absent > 0 ? 'Garnison réduite' : 'Garnison au complet';
  const lines: EffectLine[] = [{ tone: 'plain', text: strength }, ...effectLines(battle.battle, true)];
  if (battle.battle.turnLimit === undefined) lines.push({ tone: 'plain', text: `${DEFAULT_RULES.battle.turnLimit} tours avant les renforts du Félon` });
  return lines;
}

export function stratagemLines(s: Stratagem): EffectLine[] {
  return effectLines(s.effects);
}

/**
 * The chronicle's chapters in French (ADR-050): each castle taken, told from the deeds of the
 * battle the campaign kept, in a chronicler's past historic — the plan, the provisions, the
 * works and the engines, how the garrison gave the castle up, the dead and the wounded, the feat
 * of arms and the siege it recalls. A castle taken before the deeds were kept is told from what
 * the campaign knows of it.
 */
import { provisionsOf } from '../../core/campaign/camp.ts';
import type { BattleDeeds } from '../../core/campaign/deeds.ts';
import type { CampaignLevel, Rank } from '../../core/campaign/types.ts';
import type { CastleRecord } from '../../core/save/progress.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../../data/index.ts';

export interface Chapter {
  readonly level: CampaignLevel;
  /** « Roche-Grise, la sentinelle du nord ». */
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The deeds it is told from (none for a castle taken before they were kept). */
  readonly deeds: BattleDeeds | null;
}

export interface Chronicle {
  readonly chapters: readonly Chapter[];
  /** Every castle taken: the chronicle ends with its explicit. */
  readonly done: boolean;
}

/** French typography's no-break space: inside guillemets, before a colon (a line never breaks there). */
const NBSP = ' ';

/** Numbers as a chronicler writes them, up to twelve; figures beyond. */
const NUMBER_WORDS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'];

/** « trois », « une », « 14 ». */
function numberWord(n: number, feminine = false): string {
  return n === 1 ? (feminine ? 'une' : 'un') : n < NUMBER_WORDS.length ? (NUMBER_WORDS[n] ?? String(n)) : String(n);
}

/** « trois hommes », « une brèche », « 14 hommes ». */
function count(n: number, singular: string, plural: string, feminine = false): string {
  return `${numberWord(n, feminine)} ${n === 1 ? singular : plural}`;
}

/** The lord as named within a sentence: a title in lower case (« sire Aymon le Prudent »). */
function lordOf(level: CampaignLevel): string {
  return level.lord.replace(/^(Sire|Dame|Messire)\b/, (t) => t.toLowerCase());
}

/** « d’Aude », « de Bertrand ». */
function of(name: string): string {
  return /^[AEIOUÉÈÊaeiouéèê]/.test(name) ? `d’${name}` : `de ${name}`;
}

/** Who led the host, by the player's rank. */
const LEADER: Readonly<Record<Rank, string>> = { squire: 'un écuyer de sa maison', knight: 'un chevalier de sa maison', baron: 'un de ses barons' };

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** The coming before the castle, the assaults it took, the plan, the provisions. */
function approach(level: CampaignLevel, deeds: BattleDeeds, first: boolean, rankBefore: Rank | null): string {
  const out: string[] = [];
  const lord = lordOf(level);
  // The siege's month opens its chapter (« En avril, l’ost… », ADR-052); without one, « De là » ties it to the last.
  const month = level.battle.season === undefined ? undefined : DEFAULT_RULES.weather.seasons[level.battle.season]?.name;
  const opening = (sentence: string, linked: boolean) => (month ? `En ${month}, ${lowerFirst(sentence)}` : linked ? `De là, ${lowerFirst(sentence)}` : sentence);
  if (first) out.push(opening(`L’ost de la comtesse, que menait ${LEADER[deeds.rank]}, vint devant ${level.name}, que tenait ${lord}.`, false));
  // After sieges told without their deeds, the leader is named again.
  else if (rankBefore === null) out.push(opening(`L’ost, que menait ${LEADER[deeds.rank]}, marcha sur ${level.name}, que tenait ${lord}.`, true));
  else if (rankBefore !== deeds.rank) out.push(opening(`L’ost, que menait désormais ${LEADER[deeds.rank]}, marcha sur ${level.name}, que tenait ${lord}.`, false));
  else out.push(opening(`L’ost marcha sur ${level.name}, que tenait ${lord}.`, true));
  if (deeds.assault > 1) out.push(`Il fallut ${count(deeds.assault, 'assaut', 'assauts')} pour le prendre.`);
  const plan = level.stratagems.find((s) => s.id === deeds.stratagem);
  const hero = plan ? DEFAULT_RULES.heroes[plan.hero] : undefined;
  if (plan && hero) out.push(`On suivit le conseil ${of(hero.name)}, ${hero.title}${NBSP}: «${NBSP}${plan.name}${NBSP}».`);
  for (const p of provisionsOf(CAMPAIGN, deeds.provisions)) out.push(p.told);
  return out.join(' ');
}

/** The works and the engines, in the order of a siege: the moat, the walls, the bridge, the gate, the beffroi. */
function assault(deeds: BattleDeeds): string {
  const out: string[] = [];
  if (deeds.filled > 0) out.push(`Les mineurs comblèrent de fagots ${count(deeds.filled, 'tronçon', 'tronçons')} de la douve.`);
  const struck = deeds.breaches - deeds.mined;
  if (struck > 0) out.push(`Le mangonneau ouvrit ${count(struck, 'brèche', 'brèches', true)} dans la muraille.`);
  if (deeds.mined > 0) out.push(deeds.mined === 1 ? 'On mina le pied d’une muraille, qui croula.' : `On mina ${count(deeds.mined, 'muraille', 'murailles', true)}, qui croulèrent.`);
  if (deeds.burned.includes('drawbridge')) out.push('Les flèches enflammées brûlèrent les chaînes du pont-levis, qui s’abattit sur la douve.');
  else if (deeds.drawbridge) out.push('Le pont-levis s’abattit sur la douve.');
  if (deeds.burned.includes('gate')) out.push('La porte brûla.');
  else if (deeds.gate) out.push(`Le mouton enfonça la porte${deeds.portcullis ? ', puis la coulisse' : ''}.`);
  if (deeds.climbed > 0) out.push(`Le beffroi s’accola au mur et abaissa son pont : ${count(deeds.climbed, 'homme', 'hommes')} ${deeds.climbed === 1 ? 'passa' : 'passèrent'} sur les murs.`);
  if (out.length === 0) out.push('On en vint aux mains au pied des murs.');
  return out.join(' ');
}

/** How the castle was given up, at what cost, and the feat of arms. */
function outcome(level: CampaignLevel, deeds: BattleDeeds): string {
  const out: string[] = [deeds.banners.swift ? 'L’assaut fut bref.' : 'L’assaut fut long.'];
  if (deeds.ending === 'summoned') out.push('Le héraut somma la garnison de rendre le château : elle le rendit, et ses hommes sortirent vies sauves.');
  else if (deeds.ending === 'surrendered') out.push(deeds.slain > 0 ? `Ayant perdu ${count(deeds.slain, 'homme', 'hommes')} sur ${numberWord(deeds.garrison)}, la garnison posa les armes et rendit le château.` : 'La garnison posa les armes et rendit le château.');
  else if (deeds.ending === 'routed') out.push('Les derniers défenseurs, rompus, s’en fuirent.');
  else out.push('La garnison périt jusqu’au dernier homme.');
  if (deeds.captain && level.feat.kind === 'captive') out.push('Son capitaine fut pris vivant, et mis à rançon.');
  else if (!deeds.captain && deeds.ending !== 'eliminated') out.push('Son capitaine y périt.');
  out.push(deeds.lost === 0 ? 'L’ost n’y perdit pas un homme.' : `L’ost y perdit ${count(deeds.lost, 'homme', 'hommes')}.`);
  for (const id of deeds.wounded) {
    const hero = DEFAULT_RULES.heroes[id];
    if (hero) out.push(`${hero.name} y fut gravement ${hero.feminine ? 'blessée' : 'blessé'}.`);
  }
  if (deeds.banners.feat) out.push(level.feat.told);
  return out.join(' ');
}

/** The chapter of a castle taken before the deeds were kept: what the campaign knows of it. */
function unwritten(level: CampaignLevel, record: CastleRecord): string[] {
  const plan = level.stratagems.find((s) => s.id === record.stratagem);
  const hero = plan ? DEFAULT_RULES.heroes[plan.hero] : undefined;
  return [`L’ost prit ${level.name}, que tenait ${lordOf(level)}${hero ? `, sur le conseil ${of(hero.name)}` : ''}.${record.banners.feat ? ` ${level.feat.told}` : ''}`, CAMPAIGN.chronicle.unwritten];
}

/** The chronicle of the castles taken in `conquered`, in the campaign's order. */
export function chronicleOf(conquered: Readonly<Record<string, CastleRecord>>): Chronicle {
  const chapters: Chapter[] = [];
  let rankBefore: Rank | null = null;
  for (const level of CAMPAIGN.levels) {
    const record = conquered[level.id];
    if (!record) continue;
    const heading = `${level.name}, ${level.epithet}`;
    const deeds = record.deeds ?? null;
    if (!deeds) {
      chapters.push({ level, heading, paragraphs: unwritten(level, record), deeds: null });
      continue;
    }
    chapters.push({ level, heading, paragraphs: [approach(level, deeds, chapters.length === 0, rankBefore), assault(deeds), outcome(level, deeds)], deeds });
    rankBefore = deeds.rank;
  }
  return { chapters, done: CAMPAIGN.levels.every((l) => conquered[l.id]) };
}

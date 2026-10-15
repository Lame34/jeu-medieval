/**
 * Scouts the campaign's maps (J6): for each battle of src/data/campaign.json, generates its map,
 * validates it (approaches, readability), builds the battle with each stratagem (the scenario must
 * hold: spawns, structures, causeways) and, with --sim, lets the AI play both sides to see who
 * wins and when. `--try <id> <seed>…` tests other seeds for one battle; `--rank squire|knight|baron`
 * plays the castles at that rank (ADR-045; the castle as the scouts saw it by default).
 * Usage: node scripts/campaign-scout.ts [--sim] [--rank baron] [--try roche-grise orle-roche orle-roche-b]
 */
import { battleEffects } from '../src/core/campaign/scenario.ts';
import { RANKS, type CampaignBattle, type Rank, type Stratagem } from '../src/core/campaign/types.ts';
import { generateBattleMap } from '../src/core/worldgen/battle.ts';
import { validateBattleMap } from '../src/core/worldgen/validate-map.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../src/data/index.ts';
import { BattleSession } from '../src/ui/battle/session.ts';

const args = process.argv.slice(2);
const sim = args.includes('--sim');
const tryAt = args.indexOf('--try');
const only = tryAt >= 0 ? args[tryAt + 1] : undefined;
const seeds = tryAt >= 0 ? args.slice(tryAt + 2).filter((a) => !a.startsWith('--')) : [];
const rankAt = args.indexOf('--rank');
const rankId = rankAt >= 0 ? args[rankAt + 1] : undefined;
if (rankId !== undefined && !(RANKS as readonly string[]).includes(rankId)) throw new Error(`--rank: one of ${RANKS.join(', ')}`);
const rank = rankId ? CAMPAIGN.ranks[rankId as Rank] : undefined;
/** Rounds of a simulated battle at most (the turn limit ends it anyway). */
const SIM_MAX_ROUNDS = 40;

function simulate(session: BattleSession): string {
  let rounds = 0;
  while (session.state.status === 'ongoing' && rounds < SIM_MAX_ROUNDS * 2) {
    session.playAiTurn(session.state.activeFaction);
    rounds++;
  }
  const s = session.state;
  const lost = (f: string) => s.units.filter((u) => u.faction === f && !u.alive).length;
  const broken = s.structures.filter((x) => x.broken).map((x) => x.id.slice(0, x.id.indexOf(':'))).join(',');
  return `${s.status} at turn ${s.turn}/${s.turnLimit}, losses att ${lost('attacker')} def ${lost('defender')}, down [${broken}]`;
}

function scout(battle: CampaignBattle, stratagems: readonly Stratagem[], seed: string): void {
  const t0 = performance.now();
  const { layout, castle, forestCoverage } = generateBattleMap({ seed, castleIndex: battle.castleIndex });
  const report = validateBattleMap(layout, castle, DEFAULT_RULES, forestCoverage);
  console.log(`\n${battle.id} seed=${seed} c${battle.castleIndex}: ${(performance.now() - t0).toFixed(0)} ms, ok=${report.ok}, viable ${report.viable.join('/')}, towers ${layout.towers.length}, houses ${layout.houses.length}`);
  if (report.problems.length > 0) console.log(`  problems: ${report.problems.join(' | ')}`);
  const plans: (Stratagem | null)[] = stratagems.length > 0 ? [...stratagems] : [null];
  for (const plan of plans) {
    try {
      // The trial battle is a lesson: no rank applies to it.
      const session = new BattleSession(layout, seed, {}, { effects: battleEffects(battle, plan, battle.id === CAMPAIGN.tutorial.id ? undefined : rank) });
      const sc = session.scenario;
      const count = (f: string) => session.state.units.filter((u) => u.faction === f).length;
      const extras = [
        sc.structures?.map((x) => `${x.id}${x.broken ? ' down' : ` ${x.hpFraction}`}`).join(', '),
        sc.filled?.join(', '),
        sc.morale ? `morale ${JSON.stringify(sc.morale)}` : '',
        sc.aim ? `aim ${JSON.stringify(sc.aim)}` : '',
      ].filter(Boolean);
      const line = `  ${plan ? plan.id.padEnd(12) : 'base'.padEnd(12)} att ${count('attacker')} def ${count('defender')} · ${sc.weather} ${sc.startHour}h · ${sc.turnLimit} tours${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
      console.log(sim ? `${line}\n    → ${simulate(session)}` : line);
    } catch (error) {
      console.log(`  ${plan?.id ?? 'base'}: FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const battles: [CampaignBattle, readonly Stratagem[]][] = [[CAMPAIGN.tutorial, []], ...CAMPAIGN.levels.map((l): [CampaignBattle, readonly Stratagem[]] => [l, l.stratagems])];
for (const [battle, stratagems] of battles) {
  if (only && battle.id !== only) continue;
  for (const seed of seeds.length > 0 ? seeds : [battle.seed]) scout(battle, stratagems, seed);
}

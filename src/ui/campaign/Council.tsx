/**
 * The council of war (J6): on the camp's table, the scouts' plan of the castle; around it, the
 * three heroes, each with a plan in their own voice. The player picks one — the plan's marks
 * show on the map — seals it and marches. A hero resting from a grave wound has no plan to offer.
 */
import { useEffect, useMemo, useState } from 'react';
import { battleEffects, shapeScenario } from '../../core/campaign/scenario.ts';
import { surrenderLine } from '../../core/battle/combat.ts';
import type { CampaignLevel, Stratagem } from '../../core/campaign/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../../data/index.ts';
import { BattleSession } from '../battle/session.ts';
import { requestBattleMap } from './battle-map.ts';
import { stratagemLines, type EffectLine } from './effects-text.ts';
import { HeroEmblem } from './HeroEmblem.tsx';
import { ScoutPlan, type PlanMarks } from './ScoutPlan.tsx';
import './effects.css';

const TONE_MARK: Readonly<Record<EffectLine['tone'], string>> = { boon: '✦', cost: '✕', plain: '◦' };

export function EffectList({ lines }: { readonly lines: readonly EffectLine[] }) {
  return (
    <ul className="effect-list">
      {lines.map((l) => (
        <li key={l.text} data-tone={l.tone}>
          <span aria-hidden="true">{TONE_MARK[l.tone]}</span> {l.text}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ stratagem, resting, chosen, onChoose, index }: { readonly stratagem: Stratagem; readonly resting: boolean; readonly chosen: boolean; readonly onChoose: () => void; readonly index: number }) {
  const hero = DEFAULT_RULES.heroes[stratagem.hero];
  const lines = CAMPAIGN.heroLines[stratagem.hero];
  return (
    <button type="button" className="plan-card" data-chosen={chosen || undefined} data-resting={resting || undefined} disabled={resting} onClick={onChoose} aria-pressed={chosen}>
      <span className="plan-card__key" aria-hidden="true">
        {index + 1}
      </span>
      <HeroEmblem hero={stratagem.hero} size={58} muted={resting} />
      <span className="plan-card__body">
        <span className="plan-card__who">
          {hero?.name}, {hero?.title}
        </span>
        <span className="plan-card__name">{stratagem.name}</span>
        {resting ? (
          <span className="plan-card__pitch">{lines?.resting}</span>
        ) : (
          <>
            <span className="plan-card__pitch">« {stratagem.pitch} »</span>
            <EffectList lines={stratagemLines(stratagem)} />
          </>
        )}
      </span>
      {chosen && (
        <span className="plan-card__seal" aria-hidden="true">
          {hero?.name.charAt(0)}
        </span>
      )}
    </button>
  );
}

/** The scouts' view of the battle: the castle as it stands, and each plan's version of it. */
function usePlans(level: CampaignLevel, layout: WorldLayout | null, resting: readonly string[]) {
  return useMemo(() => {
    if (!layout) return null;
    const session = new BattleSession(layout, level.seed);
    const castle = shapeScenario(session.ctx, session.scenario, battleEffects(level, null), resting);
    const plans = new Map<string, PlanMarks>();
    for (const s of level.stratagems) {
      const scenario = shapeScenario(session.ctx, session.scenario, battleEffects(level, s), resting);
      const kept = new Set(scenario.units.map((u) => u.id));
      const before = new Set(castle.units.map((u) => u.id));
      const removed: Vec2[] = castle.units.filter((u) => !kept.has(u.id)).map((u) => u.position);
      plans.set(s.id, { scenario, removed, added: scenario.units.filter((u) => !before.has(u.id)).map((u) => u.id) });
    }
    return { ctx: session.ctx, castle, plans };
  }, [level, layout, resting]);
}

export function Council({ level, resting, onClose, onMarch }: { readonly level: CampaignLevel; readonly resting: readonly string[]; readonly onClose: () => void; readonly onMarch: (plan: string | null) => void }) {
  const [layout, setLayout] = useState<WorldLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    requestBattleMap(level.seed, level.castleIndex).then(
      (g) => live && setLayout(g.layout),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [level]);
  const plans = usePlans(level, layout, resting);
  const available = level.stratagems.filter((s) => !resting.includes(s.hero));
  const marks = chosen ? (plans?.plans.get(chosen) ?? null) : null;
  const shown = marks?.scenario ?? plans?.castle;
  const count = (f: 'attacker' | 'defender') => shown?.units.filter((u) => DEFAULT_RULES.units[u.typeKey]?.faction === f).length ?? 0;
  const plan = level.stratagems.find((s) => s.id === chosen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const n = Number(e.key);
      const s = level.stratagems[n - 1];
      if (s && !resting.includes(s.hero)) setChosen(s.id);
      if (e.key === 'Enter' && chosen) onMarch(chosen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [level, resting, chosen, onClose, onMarch]);

  return (
    <div className="council" role="dialog" aria-modal="true" aria-labelledby="council-title">
      <header className="council__head">
        <h2 id="council-title">Conseil de guerre</h2>
        <p>
          {level.name}, {level.epithet}. Trois plans, un seul sceau.
        </p>
        <button type="button" className="council__close" onClick={onClose} aria-label="Quitter le conseil">
          ✕
        </button>
      </header>
      <div className="council__table">
        <section className="council__plan parchment-sheet" aria-label="Plan des éclaireurs">
          <h3>Le plan des éclaireurs</h3>
          {plans && layout ? (
            <ScoutPlan layout={layout} ctx={plans.ctx} base={plans.castle} marks={marks} />
          ) : (
            <div className="scout-plan scout-plan--pending">{error ? `Le plan s’est perdu : ${error}` : 'Les éclaireurs dessinent le plan…'}</div>
          )}
          <p className="council__legend">
            <span className="dot dot--ours" /> votre ost : {count('attacker')} · <span className="dot dot--theirs" /> la garnison : {count('defender')}
            {surrenderLine(DEFAULT_RULES, count('defender')) > 0 && <>, se rend à {surrenderLine(DEFAULT_RULES, count('defender'))}</>}
            <br />
            <span className="mark mark--gold">◯</span> renforts · <span className="mark mark--red">✕</span> absents · <span className="mark mark--red">〰</span> ouvrage entamé
          </p>
        </section>
        <section className="council__cards" aria-label="Les plans des héros">
          {level.stratagems.map((s, i) => (
            <PlanCard key={s.id} stratagem={s} index={i} resting={resting.includes(s.hero)} chosen={chosen === s.id} onChoose={() => setChosen(s.id)} />
          ))}
        </section>
      </div>
      <footer className="council__foot">
        <p>{plan ? `${DEFAULT_RULES.heroes[plan.hero]?.name ?? ''} mènera le plan : « ${plan.name} ».` : available.length > 0 ? 'Choisissez le plan d’un de vos compagnons (1, 2, 3).' : 'Vos trois compagnons sont blessés : l’ost attaquera sans stratagème.'}</p>
        <button type="button" className="council__march" disabled={!chosen && available.length > 0} onClick={() => onMarch(chosen)}>
          Sceller le plan et marcher sur {level.name}
        </button>
      </footer>
    </div>
  );
}

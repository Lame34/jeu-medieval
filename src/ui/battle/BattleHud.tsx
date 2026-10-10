/**
 * Battle HUD (brief §10, J3): turn banner, end-turn button, the selected unit's card, the order
 * preview under the pointer (move: AP and exposure; attack: odds, damage, riposte) and the
 * journal. Reads the battle UI store only; orders go through the session.
 */
import type { CSSProperties, ReactNode } from 'react';
import { garrisonStrength } from '../../core/battle/combat.ts';
import { hourOf, isNight, type ShotModifier } from '../../core/battle/conditions.ts';
import { moraleStanding } from '../../core/battle/morale.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
import { TEXT_SCALES, useSettings } from '../../state/settings.ts';
import { END_LABEL, FACTION_LABEL, heroSkillName, REJECTION_LABEL, STRUCTURE_OBJECT } from './describe.ts';
import { PLAYER_FACTION } from './session.ts';
import type { ActionButton, ActionId } from './actions.ts';
import './battle-hud.css';

/** Test runs (?e2e) start without the opening briefing (it would cover their captures). */
const NO_BRIEFING = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e');
const pct = (p: number) => `${Math.round(p * 100)} %`;
const COVER_LABEL = { none: 'aucun', light: 'léger', partial: 'partiel', heavy: 'lourd' } as const;
const STANDING_LABEL = { steady: 'Ferme', shaken: 'Ébranlée', fleeing: 'En fuite' } as const;
const WEATHER_LABEL = { clear: 'Ciel clair', rain: 'Pluie', fog: 'Brouillard' } as const;
/** Wind strength (0.3–1) in words. */
const windLabel = (s: number) => (s < 0.5 ? 'Vent faible' : s < 0.8 ? 'Vent modéré' : 'Vent fort');
/** "22 h 40". */
const clock = (h: number) => {
  const m = Math.round(h * 60) % (24 * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

/** The weather, night and wind modifiers of a shot, in a line. */
function ConditionsLine({ modifiers }: { readonly modifiers: readonly ShotModifier[] }): ReactNode {
  if (modifiers.length === 0) return null;
  const fogRange = DEFAULT_RULES.weather.fogSightM;
  const parts = modifiers.map((m) => {
    switch (m.kind) {
      case 'rain':
        return `pluie ${pct(m.accuracy)}`;
      case 'night':
        return `nuit ${pct(m.accuracy)}, portée ×${m.rangeFactor.toLocaleString('fr-FR')}`;
      case 'fog':
        return `brouillard : ${fogRange} m au plus`;
      case 'wind':
        return `vent de travers ${pct(m.accuracy)}`;
      case 'hero':
        return `${heroSkillName(m.source ?? '')} +${pct(m.accuracy)}`;
    }
  });
  return <p className="hud-detail hud-conditions">Conditions : {parts.join(' · ')}</p>;
}

function Pips({ value, max }: { readonly value: number; readonly max: number }) {
  return (
    <span className="hud-pips" aria-label={`${value} sur ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  );
}

/** The unit's actions (buttons with their keys), and a hero's passive. */
function ActionBar({ unit, actions, onAction }: { readonly unit: UnitState; readonly actions: readonly ActionButton[]; readonly onAction: (id: ActionId) => void }) {
  const armed = useBattleUi((s) => s.armedAction);
  const hero = DEFAULT_RULES.heroes[unit.typeKey];
  if (actions.length === 0 && !hero) return null;
  return (
    <div className="hud-hero">
      {actions.length > 0 && (
        <ul className="hud-abilities">
          {actions.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onAction(a.id)} disabled={a.disabled} data-armed={armed === a.id || undefined} title={a.description}>
                <kbd>{a.key}</kbd>
                <span>{a.label}</span>
                {a.note && <em>{a.note}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hero && (
        <p className="hud-detail hud-passive" title={hero.passive.description}>
          Passif : <strong>{hero.passive.name}</strong>
        </p>
      )}
    </div>
  );
}

function UnitCard({ unit, actions, onAction }: { readonly unit: UnitState; readonly actions: readonly ActionButton[]; readonly onAction: (id: ActionId) => void }) {
  const type = DEFAULT_RULES.units[unit.typeKey];
  if (!type) return null;
  const standing = moraleStanding(DEFAULT_RULES.morale, unit.morale);
  const hero = DEFAULT_RULES.heroes[unit.typeKey];
  return (
    <section className="hud-card hud-unit" data-hero={hero ? true : undefined} aria-label="Unité sélectionnée">
      <h2>
        {type.name}
        {hero && <small>, {hero.title}</small>}
      </h2>
      <div className="hud-bar" role="meter" aria-valuemin={0} aria-valuemax={type.hp} aria-valuenow={unit.hp} aria-label="Points de vie">
        <span style={{ width: `${(100 * unit.hp) / type.hp}%` }} />
        <em>
          {unit.hp} / {type.hp} PV
        </em>
      </div>
      <p>
        PA <Pips value={unit.ap} max={type.ap} />
      </p>
      <p>
        Action <Pips value={unit.actions} max={DEFAULT_RULES.damage.actionsPerTurn} />
        {unit.overwatch && <span className="hud-tag">en garde</span>}
      </p>
      <p>
        Moral {Math.round(unit.morale)} · <span data-standing={standing}>{STANDING_LABEL[standing]}</span>
      </p>
      <ActionBar unit={unit} actions={actions} onAction={onAction} />
    </section>
  );
}

function Preview({ hover, battleUnits }: { readonly hover: HoverPreview; readonly battleUnits: readonly UnitState[] }): ReactNode {
  switch (hover.kind) {
    case 'none':
      return null;
    case 'blocked':
      return <p className="hud-blocked">{REJECTION_LABEL[hover.reason]}</p>;
    case 'move': {
      const worst = hover.threats.reduce((m, t) => Math.max(m, t.hitChance), 0);
      return (
        <>
          <p>
            <strong>Déplacement</strong> : {hover.plan.apSpent} PA, il en restera {hover.apLeft}.
          </p>
          <p className={hover.threats.length > 0 ? 'hud-warn' : ''}>
            {hover.threats.length === 0 ? 'Hors de portée des tireurs ennemis.' : `Exposé à ${hover.threats.length} tireur${hover.threats.length > 1 ? 's' : ''} (jusqu'à ${pct(worst)}).`}
          </p>
        </>
      );
    }
    case 'structure': {
      const p = hover.preview;
      const blows = p.blow.damage.min > 0 ? Math.ceil(hover.hp / p.blow.damage.min) : 0;
      return (
        <>
          <p>
            <strong>{p.melee ? 'Coup de bélier' : 'Tir de siège'}</strong> sur {STRUCTURE_OBJECT[hover.structure]} : <strong>{pct(p.blow.hitChance)}</strong> de toucher
          </p>
          <p>
            Dégâts {p.blow.damage.min}–{p.blow.damage.max} (critique {pct(p.blow.critChance)}) · {p.apCost} PA
          </p>
          <p className="hud-detail">
            {hover.hp} / {hover.maxHp} PV · encore {blows} coup{blows > 1 ? 's' : ''} au moins · {Math.round(p.distanceM)} / {Math.round(p.rangeM)} m
          </p>
          <ConditionsLine modifiers={p.conditions} />
        </>
      );
    }
    case 'order':
      return (
        <>
          <p>
            <strong>{hover.title}</strong>
          </p>
          {hover.lines
            .filter((l) => l.length > 0)
            .map((l) => (
              <p key={l}>{l}</p>
            ))}
          {hover.conditions && <ConditionsLine modifiers={hover.conditions} />}
        </>
      );
    case 'ability': {
      const p = hover.preview;
      if (p.kind === 'attack') {
        const a = p.attack;
        const target = battleUnits.find((u) => u.id === a.targetId);
        return (
          <>
            <p>
              <strong>{p.ability.name}</strong> sur {target ? (DEFAULT_RULES.units[target.typeKey]?.name ?? target.typeKey) : a.targetId} : <strong>{pct(a.blow.hitChance)}</strong> de toucher
            </p>
            <p>
              Dégâts {a.blow.damage.min}–{a.blow.damage.max} · {a.apCost} PA{a.riposte ? '' : ' · sans riposte'}
            </p>
            <ConditionsLine modifiers={a.conditions} />
          </>
        );
      }
      if (p.kind === 'work') {
        const after = Math.min(p.work.required, p.work.progress + p.ability.workFactor);
        return (
          <p>
            <strong>{p.ability.name}</strong> : {p.work.kind === 'fill' ? 'fascines' : 'sape'} {p.work.progress}/{p.work.required} → {after}/{p.work.required}
          </p>
        );
      }
      const names = p.affected.map((id) => DEFAULT_RULES.units[battleUnits.find((u) => u.id === id)?.typeKey ?? '']?.name ?? id);
      return (
        <p>
          <strong>{p.ability.name}</strong> : {names.join(', ')} · {p.ability.description}
        </p>
      );
    }
    case 'attack': {
      const p = hover.preview;
      const target = battleUnits.find((u) => u.id === p.targetId);
      return (
        <>
          <p>
            <strong>{p.melee ? 'Attaque au contact' : 'Tir'}</strong> sur {target ? (DEFAULT_RULES.units[target.typeKey]?.name ?? target.typeKey) : p.targetId} : <strong>{pct(p.blow.hitChance)}</strong> de toucher
          </p>
          <p>
            Dégâts {p.blow.damage.min}–{p.blow.damage.max} (critique {pct(p.blow.critChance)}) · {p.apCost} PA
          </p>
          {!p.melee && (
            <p className="hud-detail">
              Couvert {COVER_LABEL[p.cover]}
              {p.obscurance > 0 ? `, feuillage ${pct(p.obscurance)}` : ''}
              {p.heightSteps !== 0 ? ` · hauteur ${p.heightSteps > 0 ? '+' : ''}${p.heightSteps}` : ''} · {Math.round(p.distanceM)} / {Math.round(p.effectiveRangeM)} m
            </p>
          )}
          <ConditionsLine modifiers={p.conditions} />
          {p.riposte && (
            <p className="hud-warn">
              Riposte : {pct(p.riposte.hitChance)}, {p.riposte.damage.min}–{p.riposte.damage.max} dégâts
            </p>
          )}
        </>
      );
    }
  }
}

/** The garrison's men still standing, and the count at which it surrenders. */
function GarrisonChip({ battle }: { readonly battle: BattleState }) {
  const g = garrisonStrength(DEFAULT_RULES, battle.units);
  const title = g.surrendersAt > 0 ? `La garnison se rend quand il ne lui reste que ${g.surrendersAt} homme${g.surrendersAt > 1 ? 's' : ''} debout (ni morts ni en fuite).` : 'La garnison se bat jusqu’au dernier homme.';
  return (
    <span className="hud-garrison-chip" title={title} data-near={(g.standing - g.surrendersAt <= 2 && battle.status === 'ongoing') || undefined}>
      Garnison {g.standing}
      {g.surrendersAt > 0 && <small> · se rend à {g.surrendersAt}</small>}
    </span>
  );
}

/** What the opening briefing tells beyond the objective: a campaign castle's name, its lord, the plan. */
export interface BriefingContent {
  readonly title: string;
  readonly lead?: ReactNode;
}

/** The opening briefing (turn 1): the objective, the ways in, the controls. */
function Briefing({ battle, content, onClose }: { readonly battle: BattleState; readonly content: BriefingContent; readonly onClose: () => void }) {
  const { surrendersAt } = garrisonStrength(DEFAULT_RULES, battle.units);
  return (
    <section className="hud-card hud-briefing" aria-label="Objectif">
      <h2>{content.title}</h2>
      {content.lead}
      <p>
        Abattez ou mettez en fuite la garnison avant le <strong>tour {battle.turnLimit}</strong>
        {surrendersAt > 0 && (
          <>
            {' '}
            : réduite à <strong>{surrendersAt} homme{surrendersAt > 1 ? 's' : ''} debout</strong>, elle se rend
          </>
        )}
        . Passé ce délai, les renforts lèvent le siège.
      </p>
      <p>
        Ouvrez-vous un chemin : la <strong>catapulte</strong> fait brèche dans la courtine, le <strong>bélier</strong> enfonce la porte une fois le pont-levis abattu, le <strong>sapeur</strong> comble la douve ou sape un mur, la <strong>tour de siège</strong> porte vos hommes sur le rempart.
      </p>
      <p className="hud-detail">
        Sélectionnez une unité, cliquez pour la déplacer ou attaquer ; ses actions sont sur sa carte. <kbd>Entrée</kbd> : fin du tour.
      </p>
      <button type="button" onClick={onClose}>
        Compris
      </button>
    </section>
  );
}

/** A button of the end panel. */
export interface EndAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

/** What the end panel tells: a title and a story (a campaign's chronicle), more below the figures, the ways on. */
export interface EndContent {
  readonly title?: string;
  readonly story?: ReactNode;
  readonly extra?: ReactNode;
  readonly actions: readonly EndAction[];
}

/** Losses and structures down, for the end panel. */
function EndPanel({ battle, content }: { readonly battle: BattleState; readonly content: EndContent }) {
  const ending = useBattleUi((s) => s.ending);
  const won = battle.status === 'attackerWon';
  const side = (f: 'attacker' | 'defender') => {
    const all = battle.units.filter((u) => u.faction === f);
    return `${all.filter((u) => !u.alive).length} / ${all.length}`;
  };
  const down = battle.structures.filter((s) => s.broken).map((s) => s.id.slice(0, s.id.indexOf(':')));
  const count = (kind: string) => down.filter((k) => k === kind).length;
  const works: string[] = [];
  if (count('wall') > 0) works.push(`${count('wall')} brèche${count('wall') > 1 ? 's' : ''}`);
  if (count('drawbridge') > 0) works.push('pont-levis abattu');
  if (count('gate') > 0) works.push('porte enfoncée');
  if (count('portcullis') > 0) works.push('herse forcée');
  const filled = battle.works.filter((w) => w.done && w.id.startsWith('fill:')).length;
  if (filled > 0) works.push(`${filled} tronçon${filled > 1 ? 's' : ''} de douve comblé${filled > 1 ? 's' : ''}`);
  return (
    <div className="hud-end" role="status">
      <h2>{content.title ?? (won ? 'Victoire' : 'Défaite')}</h2>
      {content.story}
      <p>{ending ? END_LABEL[battle.status === 'attackerWon' ? 'attackerWon' : 'defenderWon'][ending.reason] : won ? 'Les assaillants tiennent le terrain.' : 'Les défenseurs ont repoussé l’assaut.'}</p>
      <dl className="hud-end-stats">
        <dt>Tours</dt>
        <dd>
          {battle.turn} / {battle.turnLimit}
        </dd>
        <dt>Pertes des assaillants</dt>
        <dd>{side('attacker')}</dd>
        <dt>Pertes de la garnison</dt>
        <dd>{side('defender')}</dd>
        <dt>Siège</dt>
        <dd>{works.length > 0 ? works.join(', ') : 'aucun ouvrage tombé'}</dd>
      </dl>
      {content.extra}
      <div className="hud-end-actions">
        {content.actions.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} data-primary={a.primary || undefined}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BattleHud({
  onEndTurn,
  stillActing,
  briefing,
  end,
  actionsFor,
  onAction,
}: {
  readonly onEndTurn: () => void;
  /** Units of ours that could still act (the end-of-turn warning). */
  readonly stillActing: () => number;
  /** The opening briefing (null: none, the tutorial guides instead). */
  readonly briefing: BriefingContent | null;
  /** The end panel, for the battle's final state. */
  readonly end: (battle: BattleState) => EndContent;
  /** The selected unit's action buttons, and pressing one. */
  readonly actionsFor: (unit: UnitState) => readonly ActionButton[];
  readonly onAction: (id: ActionId) => void;
}) {
  const battle = useBattleUi((s) => s.battle);
  const armed = useBattleUi((s) => s.endTurnArmed);
  const selectedId = useBattleUi((s) => s.selectedId);
  const hover = useBattleUi((s) => s.hover);
  const busy = useBattleUi((s) => s.busy);
  const log = useBattleUi((s) => s.log);
  const armedAction = useBattleUi((s) => s.armedAction);
  const briefed = useBattleUi((s) => s.briefed);
  const introDone = useBattleUi((s) => s.introDone);
  const hasSelected = useBattleUi((s) => s.hasSelected);
  const hints = useSettings((s) => s.hints);
  const textScale = useSettings((s) => TEXT_SCALES[s.textScale]);
  if (!battle) return null;
  const selected = selectedId ? battle.units.find((u) => u.id === selectedId && u.alive) : undefined;
  const playerTurn = battle.activeFaction === PLAYER_FACTION && battle.status === 'ongoing';
  return (
    <div className="battle-hud" style={{ '--ui-scale': textScale } as CSSProperties}>
      <header className="hud-banner" data-faction={battle.activeFaction}>
        <span>
          Tour {battle.turn} / {battle.turnLimit} · {FACTION_LABEL[battle.activeFaction]}
        </span>
        <span className="hud-conditions-chip" data-night={isNight(DEFAULT_RULES, hourOf(DEFAULT_RULES, battle)) || undefined}>
          {clock(hourOf(DEFAULT_RULES, battle))} · {WEATHER_LABEL[battle.weather]} · {windLabel(battle.wind.strength)}
        </span>
        <GarrisonChip battle={battle} />
        {!playerTurn && battle.status === 'ongoing' && <em>l'adversaire joue…</em>}
      </header>
      <button type="button" className="hud-end-turn" data-armed={armed || undefined} data-ready={(playerTurn && !busy && stillActing() === 0) || undefined} onClick={onEndTurn} disabled={!playerTurn || busy}>
        {armed ? `${stillActing()} unité${stillActing() > 1 ? 's peuvent' : ' peut'} encore agir : confirmer ?` : 'Fin du tour'} <kbd>Entrée</kbd>
      </button>
      {selected && <UnitCard unit={selected} actions={playerTurn ? actionsFor(selected) : []} onAction={onAction} />}
      {selected && playerTurn && !busy && (
        <section className="hud-card hud-preview" aria-live="polite">
          <Preview hover={hover} battleUnits={battle.units} />
          {hints && <p className="hud-hint">
            {armedAction ? (
              <>
                Visez puis cliquez · <kbd>Échap</kbd> annuler
              </>
            ) : (
              <>
                Clic : se déplacer, attaquer · <kbd>Tab</kbd> unité suivante · <kbd>Échap</kbd> désélectionner
              </>
            )}
          </p>}
        </section>
      )}
      {briefing && introDone && !briefed && !NO_BRIEFING && playerTurn && battle.turn === 1 && <Briefing battle={battle} content={briefing} onClose={() => useBattleUi.getState().setBriefed()} />}
      {hints && briefing && !selected && !hasSelected && briefed && playerTurn && !busy && <p className="hud-card hud-hint-only">Cliquez sur une unité bleue pour lui donner un ordre.</p>}
      <ol key={log.length > 0 ? log[log.length - 1] : ''} className="hud-card hud-log" aria-label="Journal">
        {log.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
      {battle.status !== 'ongoing' && !busy && <EndPanel battle={battle} content={end(battle)} />}
    </div>
  );
}

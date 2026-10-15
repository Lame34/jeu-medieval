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
import { useBattleUi, type AdviceShown, type HoverPreview, type WalkFirst } from '../../state/battle-ui.ts';
import { TEXT_SCALES, useSettings } from '../../state/settings.ts';
import { actionPoints, END_LABEL, FACTION_LABEL, heroSkillName, REJECTION_LABEL, STRUCTURE_OBJECT } from './describe.ts';
import { PLAYER_FACTION } from './session.ts';
import type { ActionButton, ActionId } from './actions.ts';
import { E2E } from '../test-flags.ts';
import { unitCount } from '../campaign/effects-text.ts';
import './battle-hud.css';

/** Test runs (?e2e) start without the opening briefing (it would cover their captures). */
const NO_BRIEFING = E2E;
const pct = (p: number) => `${Math.round(p * 100)} %`;
const COVER_LABEL = { none: 'aucun', light: 'léger', partial: 'partiel', heavy: 'lourd' } as const;
/** The standing of a man's morale (« moral », masculine). */
const STANDING_LABEL = { steady: 'Ferme', shaken: 'Ébranlé', fleeing: 'En fuite' } as const;
/** « exposé », or « exposée » for Aude. */
const exposed = (unitId: string, units: readonly UnitState[]) => {
  const unit = units.find((u) => u.id === unitId);
  return unit && DEFAULT_RULES.heroes[unit.typeKey]?.feminine ? 'exposée' : 'exposé';
};
const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
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
      case 'aim':
        return `adresse ${m.accuracy > 0 ? '+' : '−'}${pct(Math.abs(m.accuracy))}`;
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
          Talent : <strong>{hero.passive.name}</strong>
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
    <section className="hud-card hud-unit" data-hero={hero ? true : undefined} aria-label="Homme choisi">
      <h2>
        {type.name}
        {hero && <small>, {hero.title}</small>}
      </h2>
      <div className="hud-bar" role="meter" aria-valuemin={0} aria-valuemax={type.hp} aria-valuenow={unit.hp} aria-label="Points de vie">
        <span style={{ width: `${(100 * unit.hp) / type.hp}%` }} />
        <em>
          Vie {unit.hp} / {type.hp}
        </em>
      </div>
      <p>
        Points d’action <Pips value={unit.ap} max={type.ap} />
      </p>
      <p>
        Action du tour <Pips value={unit.actions} max={DEFAULT_RULES.damage.actionsPerTurn} />
        {unit.overwatch && <span className="hud-tag">en garde</span>}
      </p>
      <p>
        Moral {Math.round(unit.morale)} · <span data-standing={standing}>{STANDING_LABEL[standing]}</span>
      </p>
      <ActionBar unit={unit} actions={actions} onAction={onAction} />
    </section>
  );
}

/** « 1 frappe », « 2 frappent ». */
const agree = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Several men chosen together: how many, of which kinds. */
function GroupCard({ units }: { readonly units: readonly UnitState[] }) {
  const kinds = new Map<string, number>();
  for (const u of units) kinds.set(u.typeKey, (kinds.get(u.typeKey) ?? 0) + 1);
  return (
    <section className="hud-card hud-unit hud-group" aria-label="Hommes choisis">
      <h2>{units.length} hommes choisis</h2>
      <p>{[...kinds].map(([k, n]) => unitCount(k, n)).join(', ')}</p>
      <p className="hud-detail">Ils marchent en rang, ou frappent ensemble l’ennemi visé. Maj et un clic : en ajouter ou en retirer un ; Échap : les laisser.</p>
    </section>
  );
}

/** The walk before a deed out of reach: its cost, what follows, the guards it passes. */
function WalkLine({ walk, battleUnits }: { readonly walk: WalkFirst; readonly battleUnits: readonly UnitState[] }) {
  const n = walk.threats.length;
  return (
    <p className={n > 0 ? 'hud-warn' : ''}>
      <strong>S’approcher</strong> : {actionPoints(walk.plan.apSpent)}, puis {walk.then}
      {n > 0 ? ` (${exposed(walk.plan.unitId, battleUnits)} à ${n} tireur${n > 1 ? 's' : ''} en chemin)` : ''}.
    </p>
  );
}

/** A man looked at before any is chosen: who he is, which side, how he fares, how he fights. */
function InspectCard({ unit }: { readonly unit: UnitState }) {
  const type = DEFAULT_RULES.units[unit.typeKey];
  if (!type) return null;
  const hero = DEFAULT_RULES.heroes[unit.typeKey];
  const range = type.attack?.rangeM ?? 0;
  return (
    <>
      <p>
        <strong>{type.name}</strong>
        {hero ? `, ${hero.title}` : ''} · {unit.faction === PLAYER_FACTION ? 'des vôtres' : 'de la garnison'}
      </p>
      <p>
        Vie {unit.hp} / {type.hp} · moral {STANDING_LABEL[moraleStanding(DEFAULT_RULES.morale, unit.morale)].toLowerCase()}
      </p>
      <p className="hud-detail">{!type.attack ? 'Ne combat pas.' : range > 0 ? `Tire jusqu’à ${range} m.` : 'Frappe au contact.'}</p>
    </>
  );
}

function Preview({ hover, battleUnits }: { readonly hover: HoverPreview; readonly battleUnits: readonly UnitState[] }): ReactNode {
  const walk = 'approach' in hover ? hover.approach : undefined;
  return (
    <>
      {walk && <WalkLine walk={walk} battleUnits={battleUnits} />}
      <PreviewBody hover={hover} battleUnits={battleUnits} />
    </>
  );
}

function PreviewBody({ hover, battleUnits }: { readonly hover: HoverPreview; readonly battleUnits: readonly UnitState[] }): ReactNode {
  switch (hover.kind) {
    case 'inspect': {
      const unit = battleUnits.find((u) => u.id === hover.unitId);
      return unit ? <InspectCard unit={unit} /> : null;
    }
    case 'none':
      return null;
    case 'group': {
      const h = hover;
      if (h.verb === 'strike') {
        const parts = [agree(h.strikes, 'frappe ce tour', 'frappent ce tour'), ...(h.closeIn > 0 ? [agree(h.closeIn, 's’approche', 's’approchent')] : []), ...(h.idle > 0 ? [agree(h.idle, 'ne peut rien', 'ne peuvent rien')] : [])];
        return (
          <p>
            <strong>Ensemble</strong> : {parts.join(', ')}.
          </p>
        );
      }
      return (
        <p>
          <strong>En rang</strong> : {agree(h.men - h.idle, 'homme marche', 'hommes marchent')} vers ce point
          {h.partial > 0 ? ` ; ${agree(h.partial, 'n’y sera', 'n’y seront')} qu’au tour suivant` : ''}
          {h.idle > 0 ? ` ; ${agree(h.idle, 'ne peut plus bouger', 'ne peuvent plus bouger')}` : ''}.
        </p>
      );
    }
    case 'blocked':
      return <p className="hud-blocked">{REJECTION_LABEL[hover.reason]}</p>;
    case 'move': {
      const worst = hover.threats.reduce((m, t) => Math.max(m, t.hitChance), 0);
      return (
        <>
          {hover.partial ? (
            <p>
              <strong>Trop loin pour ce tour</strong> : il avance aussi loin qu’il le peut ({actionPoints(hover.plan.apSpent)}) ; il faudra finir la route au tour suivant.
            </p>
          ) : (
            <p>
              <strong>Déplacement</strong> : {actionPoints(hover.plan.apSpent)}, il en restera {hover.apLeft}.
            </p>
          )}
          <p className={hover.threats.length > 0 ? 'hud-warn' : ''}>
            {hover.threats.length === 0 ? 'Hors de portée des tireurs ennemis.' : `${capitalized(exposed(hover.plan.unitId, battleUnits))} à ${hover.threats.length} tireur${hover.threats.length > 1 ? 's' : ''} (jusqu’à ${pct(worst)}).`}
          </p>
        </>
      );
    }
    case 'structure': {
      const p = hover.preview;
      // Blows that hit, at the mean damage (a terrible blow shortens it).
      const blows = Math.max(1, Math.ceil(hover.hp / ((p.blow.damage.min + p.blow.damage.max) / 2)));
      return (
        <>
          <p>
            <strong>{p.melee ? 'Coup de bélier' : 'Tir de siège'}</strong> sur {STRUCTURE_OBJECT[hover.structure]} : <strong>{pct(p.blow.hitChance)}</strong> de toucher
          </p>
          <p>
            Dégâts {p.blow.damage.min}–{p.blow.damage.max} (coup terrible {pct(p.blow.critChance)}) · {actionPoints(p.apCost)}
          </p>
          <p className="hud-detail">
            solidité {hover.hp} / {hover.maxHp} · encore {blows} coup{blows > 1 ? 's' : ''} au but environ · {Math.round(p.distanceM)} / {Math.round(p.rangeM)} m
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
              Dégâts {a.blow.damage.min}–{a.blow.damage.max} · {actionPoints(a.apCost)}{a.riposte ? '' : ' · sans riposte'}
            </p>
            <ConditionsLine modifiers={a.conditions} />
          </>
        );
      }
      if (p.kind === 'work') {
        const after = Math.min(p.work.required, p.work.progress + p.ability.workFactor);
        return (
          <p>
            <strong>{p.ability.name}</strong> : {p.work.kind === 'fill' ? 'fascines' : 'mine'} {p.work.progress}/{p.work.required} → {after}/{p.work.required}
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
            Dégâts {p.blow.damage.min}–{p.blow.damage.max} (coup terrible {pct(p.blow.critChance)}) · {actionPoints(p.apCost)}
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
        Abattez ou mettez en fuite la garnison avant la fin du <strong>tour {battle.turnLimit}</strong>
        {surrendersAt > 0 && (
          <>
            {' '}
            : réduite à <strong>{surrendersAt} homme{surrendersAt > 1 ? 's' : ''} debout</strong>, elle se rend
          </>
        )}
        . Passé ce délai, les renforts lèvent le siège.
      </p>
      <p>
        Ouvrez-vous un chemin : le <strong>mangonneau</strong> fait brèche dans la courtine, le <strong>bélier</strong> enfonce la porte une fois le pont-levis abattu, le <strong>mineur</strong> comble la douve ou mine un mur, le <strong>beffroi</strong> porte vos hommes sur le rempart.
      </p>
      <p className="hud-detail">
        Choisissez un homme, puis cliquez pour le déplacer ou frapper ; ses ordres sont sur sa carte. <kbd>Entrée</kbd> : fin du tour.
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

/** Guillaume's advice for the chosen man, and the two answers. */
function AdviceCard({ advice, onFollow, onDismiss }: { readonly advice: AdviceShown; readonly onFollow: () => void; readonly onDismiss: () => void }) {
  const orders = advice.orders.length > 0;
  return (
    <section className="hud-card hud-advice" aria-live="polite" aria-label="Conseil de Guillaume">
      <h2>Conseil de Guillaume</h2>
      <p>« {advice.text} »</p>
      <div className="hud-advice-actions">
        {orders && (
          <button type="button" data-primary onClick={onFollow}>
            Suivre le conseil <kbd>C</kbd>
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          {orders ? 'Non merci' : 'Compris'} <kbd>Échap</kbd>
        </button>
      </div>
    </section>
  );
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
  const advice = useBattleUi((s) => s.advice);
  const group = useBattleUi((s) => s.group);
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
        {!playerTurn && battle.status === 'ongoing' && <em>la garnison joue…</em>}
      </header>
      <button type="button" className="hud-end-turn" data-armed={armed || undefined} data-ready={(playerTurn && !busy && stillActing() === 0) || undefined} onClick={onEndTurn} disabled={!playerTurn || busy}>
        {armed ? `${stillActing()} troupe${stillActing() > 1 ? 's peuvent' : ' peut'} encore agir : finir quand même ?` : 'Fin du tour'} <kbd>Entrée</kbd>
      </button>
      {selected && group.length > 1 ? (
        <GroupCard units={battle.units.filter((u) => u.alive && group.includes(u.id))} />
      ) : (
        selected && <UnitCard unit={selected} actions={playerTurn ? actionsFor(selected) : []} onAction={onAction} />
      )}
      {selected && playerTurn && !busy && advice?.unitId === selected.id && <AdviceCard advice={advice} onFollow={() => onAction('advice')} onDismiss={() => useBattleUi.getState().setAdvice(null)} />}
      {((selected && playerTurn && !busy && advice?.unitId !== selected.id) || hover.kind === 'inspect') && (
        <section className="hud-card hud-preview" aria-live="polite">
          <Preview hover={hover} battleUnits={battle.units} />
          {hints && <p className="hud-hint">
            {!selected ? (
              <>Cliquez sur l’un de vos hommes, en bleu, pour lui donner un ordre.</>
            ) : group.length > 1 ? (
              <>
                Clic : marcher ou frapper ensemble · Maj et clic : ajouter, retirer · <kbd>Échap</kbd> les laisser
              </>
            ) : armedAction ? (
              <>
                Visez puis cliquez · <kbd>Échap</kbd> annuler
              </>
            ) : (
              <>
                Clic : se déplacer, attaquer · <kbd>Tab</kbd> homme suivant · <kbd>Échap</kbd> désélectionner
              </>
            )}
          </p>}
        </section>
      )}
      {briefing && introDone && !briefed && !NO_BRIEFING && playerTurn && battle.turn === 1 && <Briefing battle={battle} content={briefing} onClose={() => useBattleUi.getState().setBriefed()} />}
      {hints && briefing && !selected && !hasSelected && briefed && playerTurn && !busy && hover.kind !== 'inspect' && <p className="hud-card hud-hint-only">Cliquez sur l’un de vos hommes, en bleu, pour lui donner un ordre.</p>}
      <ol key={log.length > 0 ? log[log.length - 1] : ''} className="hud-card hud-log" aria-label="Journal">
        {log.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
      {battle.status !== 'ongoing' && !busy && <EndPanel battle={battle} content={end(battle)} />}
    </div>
  );
}

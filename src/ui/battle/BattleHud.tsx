/**
 * Battle HUD (brief §10, J3): turn banner, end-turn button, the selected unit's card, the order
 * preview under the pointer (move: AP and exposure; attack: odds, damage, riposte) and the
 * journal. Reads the battle UI store only; orders go through the session.
 */
import type { ReactNode } from 'react';
import { hourOf, isNight, type ShotModifier } from '../../core/battle/conditions.ts';
import { cooldownOf } from '../../core/battle/heroes.ts';
import { moraleStanding } from '../../core/battle/morale.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
import { END_LABEL, FACTION_LABEL, heroSkillName, REJECTION_LABEL, STRUCTURE_OBJECT } from './describe.ts';
import { PLAYER_FACTION } from './session.ts';
import './battle-hud.css';

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

/** A hero's abilities (buttons, keys 1 and 2, cooldowns) and passive. */
function HeroPanel({ unit, onAbility }: { readonly unit: UnitState; readonly onAbility: (index: number) => void }) {
  const hero = DEFAULT_RULES.heroes[unit.typeKey];
  const armed = useBattleUi((s) => s.armedAbility);
  if (!hero) return null;
  return (
    <div className="hud-hero">
      <ul className="hud-abilities">
        {hero.abilities.map((a, i) => {
          const wait = cooldownOf(unit, a.id);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => onAbility(i)} disabled={wait > 0 || unit.ap < a.apCost} data-armed={armed === a.id || undefined} title={a.description}>
                <kbd>{i + 1}</kbd> {a.name}
                {wait > 0 ? <em> · recharge {wait}</em> : a.apCost > 0 ? <em> · {a.apCost} PA</em> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="hud-detail" title={hero.passive.description}>
        <strong>{hero.passive.name}</strong> : {hero.passive.description}
      </p>
    </div>
  );
}

function UnitCard({ unit, onAbility }: { readonly unit: UnitState; readonly onAbility: (index: number) => void }) {
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
      <HeroPanel unit={unit} onAbility={onAbility} />
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

/** Losses and structures down, for the end panel. */
function EndPanel({ battle, onReplay, onLeave }: { readonly battle: BattleState; readonly onReplay: () => void; readonly onLeave: () => void }) {
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
      <h2>{won ? 'Victoire' : 'Défaite'}</h2>
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
      <div className="hud-end-actions">
        <button type="button" onClick={onReplay}>
          Rejouer
        </button>
        <button type="button" onClick={onLeave}>
          Retour
        </button>
      </div>
    </div>
  );
}

export function BattleHud({
  onEndTurn,
  stillActing,
  onReplay,
  onLeave,
  onAbility,
}: {
  readonly onEndTurn: () => void;
  /** Units of ours that could still act (the end-of-turn warning). */
  readonly stillActing: () => number;
  readonly onReplay: () => void;
  readonly onLeave: () => void;
  /** A hero's ability, by index (the card's buttons). */
  readonly onAbility: (index: number) => void;
}) {
  const battle = useBattleUi((s) => s.battle);
  const armed = useBattleUi((s) => s.endTurnArmed);
  const selectedId = useBattleUi((s) => s.selectedId);
  const hover = useBattleUi((s) => s.hover);
  const busy = useBattleUi((s) => s.busy);
  const log = useBattleUi((s) => s.log);
  if (!battle) return null;
  const selected = selectedId ? battle.units.find((u) => u.id === selectedId && u.alive) : undefined;
  const playerTurn = battle.activeFaction === PLAYER_FACTION && battle.status === 'ongoing';
  return (
    <div className="battle-hud">
      <header className="hud-banner" data-faction={battle.activeFaction}>
        <span>
          Tour {battle.turn} / {battle.turnLimit} · {FACTION_LABEL[battle.activeFaction]}
        </span>
        <span className="hud-conditions-chip" data-night={isNight(DEFAULT_RULES, hourOf(DEFAULT_RULES, battle)) || undefined}>
          {clock(hourOf(DEFAULT_RULES, battle))} · {WEATHER_LABEL[battle.weather]} · {windLabel(battle.wind.strength)}
        </span>
        {!playerTurn && battle.status === 'ongoing' && <em>l'adversaire joue…</em>}
      </header>
      <button type="button" className="hud-end-turn" data-armed={armed || undefined} onClick={onEndTurn} disabled={!playerTurn || busy}>
        {armed ? `${stillActing()} unité${stillActing() > 1 ? 's peuvent' : ' peut'} encore agir : confirmer ?` : 'Fin du tour'} <kbd>Entrée</kbd>
      </button>
      {selected && <UnitCard unit={selected} onAbility={onAbility} />}
      {selected && playerTurn && !busy && (
        <section className="hud-card hud-preview" aria-live="polite">
          <Preview hover={hover} battleUnits={battle.units} />
          <p className="hud-hint">
            Clic : déplacer, attaquer ou frapper un ouvrage (engins) · <kbd>G</kbd> garde vers le pointeur · <kbd>F</kbd> ouvrage : combler, saper, amarrer la tour, y monter · <kbd>B</kbd> flèche enflammée · <kbd>E</kbd> éteindre · <kbd>1</kbd> <kbd>2</kbd> capacités du héros · <kbd>Tab</kbd> unité suivante · <kbd>Échap</kbd> désélectionner
          </p>
        </section>
      )}
      {!selected && playerTurn && !busy && <p className="hud-card hud-hint-only">Cliquez sur une unité bleue pour lui donner un ordre.</p>}
      <ol className="hud-card hud-log" aria-label="Journal">
        {log.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
      {battle.status !== 'ongoing' && <EndPanel battle={battle} onReplay={onReplay} onLeave={onLeave} />}
    </div>
  );
}

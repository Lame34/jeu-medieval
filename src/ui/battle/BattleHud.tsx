/**
 * Battle HUD (brief §10, J3): turn banner, end-turn button, the selected unit's card, the order
 * preview under the pointer (move: AP and exposure; attack: odds, damage, riposte) and the
 * journal. Reads the battle UI store only; orders go through the session.
 */
import type { ReactNode } from 'react';
import { moraleStanding } from '../../core/battle/morale.ts';
import type { UnitState } from '../../core/battle/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
import { FACTION_LABEL, REJECTION_LABEL, STRUCTURE_OBJECT } from './describe.ts';
import { PLAYER_FACTION } from './session.ts';
import './battle-hud.css';

const pct = (p: number) => `${Math.round(p * 100)} %`;
const COVER_LABEL = { none: 'aucun', light: 'léger', partial: 'partiel', heavy: 'lourd' } as const;
const STANDING_LABEL = { steady: 'Ferme', shaken: 'Ébranlée', fleeing: 'En fuite' } as const;

function Pips({ value, max }: { readonly value: number; readonly max: number }) {
  return (
    <span className="hud-pips" aria-label={`${value} sur ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'on' : ''} />
      ))}
    </span>
  );
}

function UnitCard({ unit }: { readonly unit: UnitState }) {
  const type = DEFAULT_RULES.units[unit.typeKey];
  if (!type) return null;
  const standing = moraleStanding(DEFAULT_RULES.morale, unit.morale);
  return (
    <section className="hud-card hud-unit" aria-label="Unité sélectionnée">
      <h2>{type.name}</h2>
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
        </>
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

export function BattleHud({ onEndTurn }: { readonly onEndTurn: () => void }) {
  const battle = useBattleUi((s) => s.battle);
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
          Tour {battle.turn} · {FACTION_LABEL[battle.activeFaction]}
        </span>
        {!playerTurn && battle.status === 'ongoing' && <em>l'adversaire joue…</em>}
      </header>
      <button type="button" className="hud-end-turn" onClick={onEndTurn} disabled={!playerTurn || busy}>
        Fin du tour <kbd>Entrée</kbd>
      </button>
      {selected && <UnitCard unit={selected} />}
      {selected && playerTurn && !busy && (
        <section className="hud-card hud-preview" aria-live="polite">
          <Preview hover={hover} battleUnits={battle.units} />
          <p className="hud-hint">
            Clic : déplacer, attaquer ou frapper un ouvrage (engins) · <kbd>G</kbd> garde vers le pointeur · <kbd>F</kbd> ouvrage : combler, saper, amarrer la tour, y monter · <kbd>B</kbd> flèche enflammée · <kbd>E</kbd> éteindre · <kbd>Tab</kbd> unité suivante · <kbd>Échap</kbd> désélectionner
          </p>
        </section>
      )}
      {!selected && playerTurn && !busy && <p className="hud-card hud-hint-only">Cliquez sur une unité bleue pour lui donner un ordre.</p>}
      <ol className="hud-card hud-log" aria-label="Journal">
        {log.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
      {battle.status !== 'ongoing' && (
        <div className="hud-end" role="status">
          <h2>{battle.status === 'attackerWon' ? 'Victoire' : 'Défaite'}</h2>
          <p>{battle.status === 'attackerWon' ? 'Les assaillants tiennent le terrain.' : 'Les défenseurs ont repoussé l’assaut.'}</p>
        </div>
      )}
    </div>
  );
}

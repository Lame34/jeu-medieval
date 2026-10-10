/**
 * The trial battle's guide (J6): Guillaume's lessons in a panel beside the battle. A lesson with
 * a goal ticks itself off when the player does it (the battle's events, the selection, the camera
 * moving) and the next one follows; any lesson can be skipped or read again. The camera goes to
 * what a lesson is about, and the part of the HUD it names lights up.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleState } from '../../core/battle/types.ts';
import type { GameEvent } from '../../core/events/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { garrisonGroupOf } from '../../core/worldgen/garrison.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import type { CameraView } from '../../render/camera/TacticalCamera.tsx';
import { useBattleUi } from '../../state/battle-ui.ts';
import { HeroEmblem } from '../campaign/HeroEmblem.tsx';
import { PLAYER_FACTION, type BattleSession } from '../battle/session.ts';
import { EMPTY_RECORD, tutorialSteps, type FocusTarget, type TutorialRecord } from './steps.tsx';
import './tutorial.css';

/** A lesson done moves on after this pause (ms), so the tick is seen. */
const ADVANCE_AFTER_MS = 1200;
/** How often the camera is checked for the camera lesson (ms), and how far it must have gone. */
const CAMERA_POLL_MS = 400;
const CAMERA_MOVED_M = 6;
const CAMERA_TURNED = 0.03;
const CAMERA_ZOOMED = 0.15;

const centroid = (pts: readonly Vec2[]): Vec2 | null => (pts.length === 0 ? null : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });

/** Where the camera looks for a lesson. */
function focusPoint(target: FocusTarget, state: BattleState, layout: WorldLayout): Vec2 | null {
  const tags = (typeKey: string) => DEFAULT_RULES.units[typeKey]?.tags ?? [];
  const alive = state.units.filter((u) => u.alive);
  const castle = centroid(layout.towers.map((t) => t.center));
  switch (target) {
    case 'army':
      return centroid(alive.filter((u) => u.faction === PLAYER_FACTION && !tags(u.typeKey).includes('siegeEngine')).map((u) => u.position));
    case 'park':
      return centroid(alive.filter((u) => u.faction === PLAYER_FACTION && tags(u.typeKey).includes('siegeEngine')).map((u) => u.position));
    case 'outpost':
      return centroid(alive.filter((u) => garrisonGroupOf(u.id) === 'outpost').map((u) => u.position)) ?? castle;
    case 'gate':
      return layout.gates[0]?.center ?? castle;
    case 'castle':
      return castle;
  }
}

/** The record's flags an event sets. */
function flagsOf(event: GameEvent, state: BattleState): Partial<TutorialRecord> {
  const ours = (id: string) => state.units.find((u) => u.id === id)?.faction === PLAYER_FACTION;
  const typeOf = (id: string) => state.units.find((u) => u.id === id)?.typeKey;
  switch (event.type) {
    case 'unitMoved':
      return ours(event.unitId) && !event.fleeing ? { moved: true } : {};
    case 'unitAttacked':
      return ours(event.attackerId) && !event.reaction && !event.riposte ? { attacked: true } : {};
    case 'overwatchSet':
      return ours(event.unitId) ? { guarded: true } : {};
    case 'turnEnded':
      return event.faction === PLAYER_FACTION ? { turnEnded: true } : {};
    case 'abilityUsed':
      return ours(event.unitId) ? { ability: true } : {};
    case 'structureBroken':
      return event.kind === 'drawbridge' ? { bridgeDown: true } : event.kind === 'gate' ? { gateHit: true } : event.kind === 'wall' ? { wallHit: true } : {};
    case 'structureDamaged':
      if (typeOf(event.attackerId) === 'ram' && event.structureId.startsWith('gate:')) return { gateHit: true };
      if (event.structureId.startsWith('wall:') && DEFAULT_RULES.units[typeOf(event.attackerId) ?? '']?.tags.includes('indirectFire')) return { wallHit: true };
      return {};
    case 'siegeWorkProgressed':
    case 'towerDocked':
      return { works: true };
    default:
      return {};
  }
}

export function Tutorial({ session, layout, getView, focusOn, onDone }: { readonly session: BattleSession; readonly layout: WorldLayout; readonly getView: () => CameraView | null; readonly focusOn: (p: Vec2) => void; readonly onDone: () => void }) {
  const steps = useMemo(() => tutorialSteps(session.state.turnLimit), [session]);
  const [index, setIndex] = useState(0);
  const [record, setRecord] = useState<TutorialRecord>(EMPTY_RECORD);
  const [hidden, setHidden] = useState(false);
  const [over, setOver] = useState(session.state.status !== 'ongoing');
  const step = steps[index] ?? steps[0];
  const done = step?.goal ? record[step.goal.flag] : false;
  const last = index === steps.length - 1;
  const mark = (flags: Partial<TutorialRecord>) => setRecord((r) => (Object.entries(flags).some(([k, v]) => v && !r[k as keyof TutorialRecord]) ? { ...r, ...flags } : r));

  // The battle's events and the selection tick lessons off.
  useEffect(() => {
    const off = session.subscribe((events, state) => {
      const flags: Partial<TutorialRecord> = {};
      for (const e of events) Object.assign(flags, flagsOf(e, state));
      mark(flags);
      if (state.status !== 'ongoing') setOver(true);
    });
    const offUi = useBattleUi.subscribe((s) => {
      if (s.selectedId) mark({ selected: true });
    });
    return () => {
      off();
      offUi();
    };
  }, [session]);

  // The camera lesson: has the view moved, turned or zoomed since the start?
  useEffect(() => {
    if (record.cameraMoved) return undefined;
    const start = getView();
    const timer = window.setInterval(() => {
      const v = getView();
      if (!start || !v) return;
      const moved = Math.hypot(v.focus.x - start.focus.x, v.focus.z - start.focus.z) > CAMERA_MOVED_M;
      const turned = Math.abs(v.yawTurns - start.yawTurns) > CAMERA_TURNED;
      const zoomed = Math.abs(v.distance - start.distance) / start.distance > CAMERA_ZOOMED;
      if (moved || turned || zoomed) mark({ cameraMoved: true });
    }, CAMERA_POLL_MS);
    return () => window.clearInterval(timer);
  }, [getView, record.cameraMoved]);

  // A lesson done: on to the next, after a moment.
  useEffect(() => {
    if (!done || last) return undefined;
    const t = window.setTimeout(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), ADVANCE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [done, last, steps.length]);

  // A new lesson: the camera goes to what it is about.
  const focusRef = useRef(focusOn);
  focusRef.current = focusOn;
  useEffect(() => {
    if (!step?.focus) return;
    const p = focusPoint(step.focus, session.state, layout);
    if (p) focusRef.current(p);
  }, [step, session, layout]);

  // The HUD part the lesson names lights up.
  useEffect(() => {
    const body = document.body;
    if (step?.highlight && !hidden && !over) body.dataset['tutorialHighlight'] = step.highlight;
    else delete body.dataset['tutorialHighlight'];
    return () => {
      delete body.dataset['tutorialHighlight'];
    };
  }, [step, hidden, over]);

  // The last lesson read: the trial is done (the campaign's map seals the fort).
  useEffect(() => {
    if (last) onDone();
  }, [last, onDone]);

  if (!step || over) return null;
  if (hidden) {
    return (
      <button type="button" className="tutorial-tab" onClick={() => setHidden(false)}>
        Leçon {index + 1} / {steps.length} · {step.title}
      </button>
    );
  }
  return (
    <section className="tutorial hud-card" aria-live="polite" aria-label="Leçon de Guillaume">
      <header className="tutorial__head">
        <HeroEmblem hero="heroKnight" size={40} />
        <div>
          <p className="tutorial__count">
            Leçon {index + 1} / {steps.length} · Guillaume
          </p>
          <h2>{step.title}</h2>
        </div>
      </header>
      <p className="tutorial__text">{step.text}</p>
      {step.goal && (
        <p className="tutorial__goal" data-done={done || undefined}>
          <span aria-hidden="true">{done ? '☑' : '☐'}</span> {step.goal.label}
        </p>
      )}
      <div className="tutorial__actions">
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Leçon précédente">
          ‹
        </button>
        <button type="button" onClick={() => setHidden(true)}>
          Masquer
        </button>
        {last ? (
          <button type="button" className="tutorial__next" onClick={() => setHidden(true)}>
            Terminer la leçon
          </button>
        ) : (
          <button type="button" className="tutorial__next" data-pending={(step.goal && !done) || undefined} onClick={() => setIndex((i) => Math.min(i + 1, steps.length - 1))}>
            {step.goal && !done ? 'Passer ›' : index === 0 ? 'Commencer ›' : 'Suivant ›'}
          </button>
        )}
      </div>
    </section>
  );
}

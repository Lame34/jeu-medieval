/**
 * The campaign (J6, brief §9.1 and §10): the Val d'Orle on a parchment map, and beside it the
 * letter of the castle picked — its lord, its story, what the scouts know, the banners won — from
 * which the council of war is called. The tutorial's fort waits at the start of the road.
 */
import { useEffect, useState } from 'react';
import type { CampaignBattle, CampaignLevel } from '../../core/campaign/types.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../../data/index.ts';
import { bannerTotal, isUnlocked, useCampaign, type CastleRecord } from '../../state/campaign.ts';
import { CampaignMap, type MapNode } from '../campaign/CampaignMap.tsx';
import { Council, EffectList } from '../campaign/Council.tsx';
import { castleLines } from '../campaign/effects-text.ts';
import { navigate, ROUTES } from '../router.ts';
import '../campaign/campaign.css';

/** How long the seal of a castle just taken takes to stamp (ms). */
const SEAL_STAMP_MS = 1800;

function Shields({ n }: { readonly n: number }) {
  return (
    <span className="letter__shields" aria-label={`Difficulté ${n} sur 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 16 18" width="14" height="16" aria-hidden="true">
          <path d="M1,1 H15 V8 Q15 14 8 17 Q1 14 1 8Z" fill={i < n ? '#8e1b12' : 'none'} stroke="#5b4630" strokeWidth="1.2" />
        </svg>
      ))}
    </span>
  );
}

function BannerRow({ record, level }: { readonly record: CastleRecord; readonly level: CampaignBattle }) {
  const limit = level.battle.turnLimit ?? DEFAULT_RULES.battle.turnLimit;
  const items = [
    { won: record.banners.taken, label: 'Château pris' },
    { won: record.banners.swift, label: `Pris avant le tour ${Math.ceil(limit * CAMPAIGN.banners.swiftShare)}` },
    { won: record.banners.spared, label: `Au plus ${CAMPAIGN.banners.maxLosses} pertes` },
  ];
  return (
    <ul className="letter__banners">
      {items.map((b) => (
        <li key={b.label} data-won={b.won || undefined}>
          <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true">
            <path d="M1,1 h10 v14 l-5,-4 l-5,4z" />
          </svg>
          {b.label}
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const conquered = useCampaign((s) => s.conquered);
  const resting = useCampaign((s) => s.resting);
  const done = CAMPAIGN.levels.every((l) => conquered[l.id]);
  const taken = CAMPAIGN.levels.filter((l) => conquered[l.id]).length;
  return (
    <>
      <h2 className="letter__title">{CAMPAIGN.realm}</h2>
      <p className="letter__epithet">{done ? 'la campagne est achevée' : `${taken} château${taken > 1 ? 'x' : ''} sur ${CAMPAIGN.levels.length} repris au Félon`}</p>
      <p className="letter__story">{done ? CAMPAIGN.epilogue : CAMPAIGN.prologue}</p>
      {resting.length > 0 && (
        <div className="letter__resting">
          {resting.map((h) => (
            <p key={h}>{CAMPAIGN.heroLines[h]?.resting}</p>
          ))}
        </div>
      )}
      <p className="letter__hint">{taken === 0 ? 'Commencez par le Fortin du Gué pour apprendre le siège, ou marchez droit sur Roche-Grise.' : 'Choisissez un château sur la carte.'}</p>
    </>
  );
}

function CastleLetter({ battle, index, onCouncil }: { readonly battle: CampaignBattle | CampaignLevel; readonly index: number; readonly onCouncil: () => void }) {
  const conquered = useCampaign((s) => s.conquered);
  const tutorialDone = useCampaign((s) => s.tutorialDone);
  const lesson = index < 0;
  const record = lesson ? undefined : conquered[battle.id];
  const unlocked = lesson || isUnlocked(CAMPAIGN, conquered, index);
  const previous = index > 0 ? CAMPAIGN.levels[index - 1] : undefined;
  return (
    <>
      <h2 className="letter__title">{battle.name}</h2>
      <p className="letter__epithet">
        {battle.epithet} {!lesson && <Shields n={battle.difficulty} />}
      </p>
      <blockquote className="letter__lord">
        « {battle.lordLine} »<cite>{battle.lord}</cite>
      </blockquote>
      <p className="letter__story">{battle.intro}</p>
      <h3 className="letter__heading">Ce que savent les éclaireurs</h3>
      <EffectList lines={castleLines(battle)} />
      {record && (
        <>
          <h3 className="letter__heading">Étendards</h3>
          <BannerRow record={record} level={battle} />
        </>
      )}
      <div className="letter__actions">
        {lesson ? (
          <button type="button" className="letter__go" onClick={() => navigate(ROUTES.battle, { tutorial: '' })}>
            {tutorialDone ? 'Refaire la leçon' : 'Commencer la leçon'}
          </button>
        ) : unlocked ? (
          <button type="button" className="letter__go" onClick={onCouncil}>
            {record ? 'Reprendre l’assaut' : 'Réunir le conseil de guerre'}
          </button>
        ) : (
          <p className="letter__locked">Prenez d’abord {previous?.name} : la route passe par ses murs.</p>
        )}
      </div>
    </>
  );
}

export default function CampaignScreen() {
  const conquered = useCampaign((s) => s.conquered);
  const tutorialDone = useCampaign((s) => s.tutorialDone);
  const resting = useCampaign((s) => s.resting);
  const fresh = useCampaign((s) => s.fresh);
  const [selected, setSelected] = useState<string | null>(() => {
    // Back from a victory: the next castle's letter is open.
    const i = CAMPAIGN.levels.findIndex((l) => l.id === fresh);
    return i >= 0 ? (CAMPAIGN.levels[i + 1]?.id ?? fresh) : null;
  });
  const [council, setCouncil] = useState(false);
  useEffect(() => {
    if (!fresh) return undefined;
    const t = window.setTimeout(() => useCampaign.getState().sealFresh(), SEAL_STAMP_MS);
    return () => window.clearTimeout(t);
  }, [fresh]);

  const nodes: MapNode[] = [
    { battle: CAMPAIGN.tutorial, state: tutorialDone ? 'taken' : 'open', lesson: true },
    ...CAMPAIGN.levels.map((l, i): MapNode => {
      const record = conquered[l.id];
      return { battle: l, state: record ? 'taken' : isUnlocked(CAMPAIGN, conquered, i) ? 'open' : 'locked', ...(record ? { banners: record.banners } : {}) };
    }),
  ];
  const index = selected === CAMPAIGN.tutorial.id ? -1 : CAMPAIGN.levels.findIndex((l) => l.id === selected);
  const battle = index < 0 ? (selected === CAMPAIGN.tutorial.id ? CAMPAIGN.tutorial : null) : CAMPAIGN.levels[index];
  const level = index >= 0 ? CAMPAIGN.levels[index] : undefined;
  const taken = CAMPAIGN.levels.filter((l) => conquered[l.id]).length;

  return (
    <main className="campaign-screen">
      <header className="campaign-bar">
        <button type="button" className="campaign-bar__back" onClick={() => navigate(ROUTES.title)}>
          ← Menu
        </button>
        <h1>Campagne du {CAMPAIGN.realm}</h1>
        <p className="campaign-bar__progress">
          Châteaux {taken} / {CAMPAIGN.levels.length} · Étendards {bannerTotal(conquered)} / {CAMPAIGN.levels.length * 3}
        </p>
      </header>
      <div className="campaign-body">
        <div className="campaign-map-frame">
          <CampaignMap nodes={nodes} selected={selected} fresh={fresh} onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
        </div>
        <aside className="campaign-letter parchment-sheet" aria-live="polite">
          {battle ? <CastleLetter key={battle.id} battle={battle} index={index} onCouncil={() => setCouncil(true)} /> : <Overview />}
          {battle && (
            <button type="button" className="letter__close" onClick={() => setSelected(null)}>
              ← Le Val d’Orle
            </button>
          )}
        </aside>
      </div>
      {council && level && <Council level={level} resting={resting} onClose={() => setCouncil(false)} onMarch={(plan) => navigate(ROUTES.battle, plan ? { level: level.id, plan } : { level: level.id })} />}
    </main>
  );
}

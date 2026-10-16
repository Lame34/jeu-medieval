/**
 * The campaign (J6, brief §9.1 and §10): the Val d'Orle on a parchment map, and beside it the
 * letter of the castle picked — its lord, its story, what the scouts know, the banners won — from
 * which the council of war is called. The tutorial's fort waits at the start of the road; the
 * host's tents at its foot, where the marcs of the banners buy provisions for the next siege and
 * the mire's care (ADR-049). The chronicle opens once a castle has fallen (ADR-050).
 */
import { useEffect, useState } from 'react';
import { Glossed } from '../components/Glossed.tsx';
import { DEFAULT_RANK, type CampaignBattle, type CampaignLevel, type Feat } from '../../core/campaign/types.ts';
import { BANNERS_PER_CASTLE } from '../../core/campaign/scenario.ts';
import { canBuy, canHeal, earned, provisionsOf, purse, type Coffer } from '../../core/campaign/camp.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../../data/index.ts';
import { isSaveOf, loadBattleSave, resumeParams } from '../../state/battle-save.ts';
import { bannerTotal, isUnlocked, useCampaign, type CastleRecord } from '../../state/campaign.ts';
import { CampaignMap, type MapNode } from '../campaign/CampaignMap.tsx';
import { HeroEmblem } from '../campaign/HeroEmblem.tsx';
import { Council, EffectList } from '../campaign/Council.tsx';
import { castleLines, namesInline, provisionLines } from '../campaign/effects-text.ts';
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
  // The trial battle has no feat of arms.
  const feat = 'feat' in level ? (level as CampaignLevel).feat : undefined;
  const items = [
    { won: record.banners.taken, label: 'Château pris' },
    { won: record.banners.swift, label: `Pris en ${Math.ceil(limit * CAMPAIGN.banners.swiftShare)} tours au plus` },
    { won: record.banners.spared, label: `${CAMPAIGN.banners.maxLosses} pertes au plus` },
    ...(feat ? [{ won: record.banners.feat, label: feat.name }] : []),
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

/** A castle's feat of arms, in its letter: the deed asked, and the siege it comes from. */
function FeatNote({ feat }: { readonly feat: Feat }) {
  return (
    <>
      <h3 className="letter__heading">Fait d’armes</h3>
      <p className="letter__feat">
        <strong>{feat.name}.</strong> <Glossed>{feat.task}</Glossed>
      </p>
      <p className="letter__feat-history">
        <Glossed>{feat.history}</Glossed>
      </p>
    </>
  );
}

/** « 30 marcs d’argent », « un marc d’argent », « pas un marc ». */
function marcsLabel(n: number): string {
  return n === 0 ? 'pas un marc' : n === 1 ? 'un marc d’argent' : `${n} marcs d’argent`;
}

/** The coffer, as the tents reckon it. */
function useCoffer(): Coffer {
  const conquered = useCampaign((s) => s.conquered);
  const spent = useCampaign((s) => s.spent);
  const pending = useCampaign((s) => s.pending);
  return { conquered, spent, pending };
}

/** The selection that opens the tents' letter (no castle bears this id). */
const TENTS = 'tents';

/** The provisions the tents sell for the next siege, bought or given back. */
function Provisions({ coffer }: { readonly coffer: Coffer }) {
  const { buy, giveBack } = useCampaign.getState();
  // What a battle left unfinished took with it stays with that battle.
  const [save] = useState(loadBattleSave);
  const away = save?.provisions ?? [];
  return (
    <ul className="tents__list">
      {CAMPAIGN.camp.provisions.map((p) => {
        const bought = coffer.pending.includes(p.id);
        return (
          <li key={p.id} data-bought={bought || undefined}>
            <div className="tents__item">
              <span>
                <strong>{p.name}</strong> · {marcsLabel(p.price)}
              </span>
              <span className="tents__summary">{p.summary}</span>
              <EffectList lines={provisionLines(p)} />
            </div>
            {bought && away.includes(p.id) ? (
              <em className="tents__away">Parti avec l’ost</em>
            ) : bought ? (
              <button type="button" className="tents__button" onClick={() => giveBack(p.id)}>
                Rendre
              </button>
            ) : (
              <button type="button" className="tents__button" disabled={!canBuy(CAMPAIGN, coffer, p.id)} onClick={() => buy(p.id)}>
                Acheter
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The host's tents (ADR-049): the coffer, the provisions it buys for the next siege, the mire. */
function TentsLetter() {
  const coffer = useCoffer();
  const resting = useCampaign((s) => s.resting);
  const heal = useCampaign((s) => s.heal);
  const empty = earned(CAMPAIGN, coffer.conquered) === 0 && coffer.pending.length === 0;
  const hurt = resting.filter((h) => DEFAULT_RULES.heroes[h]);
  return (
    <>
      <h2 className="letter__title">Les tentes de l’ost</h2>
      <p className="letter__epithet">au départ de la route du Val</p>
      {empty ? (
        <p className="tents__hint">Le coffre est encore vide : chaque étendard gagné y apportera {CAMPAIGN.camp.perBanner} marcs d’argent, de quoi préparer les sièges suivants.</p>
      ) : (
        <>
          <p className="tents__purse">
            Dans le coffre : <strong>{marcsLabel(purse(CAMPAIGN, coffer))}</strong>.
          </p>
          <p className="tents__hint">Chaque étendard gagné rapporte {CAMPAIGN.camp.perBanner} marcs, une fois : les rançons et les coffres des châteaux pris. Ce que vous achetez ici part avec l’ost au prochain siège, et s’y dépense.</p>
          <h3 className="letter__heading">Pour le prochain siège</h3>
          <Provisions coffer={coffer} />
        </>
      )}
      {hurt.length > 0 && (
        <>
          <h3 className="letter__heading">Le mire</h3>
          {hurt.map((h) => (
            <p key={h} className="tents__mire">
              {DEFAULT_RULES.heroes[h]?.name} se remet de ses blessures.{' '}
              <button type="button" className="tents__button" disabled={!canHeal(CAMPAIGN, coffer)} onClick={() => heal(h)}>
                Faire venir le mire ({marcsLabel(CAMPAIGN.camp.healPrice)})
              </button>
            </p>
          ))}
        </>
      )}
    </>
  );
}

/** In a letter: the coffer, what the host takes to the next siege, the way to the tents. */
function TentsNote({ onTents }: { readonly onTents: () => void }) {
  const coffer = useCoffer();
  if (earned(CAMPAIGN, coffer.conquered) === 0 && coffer.pending.length === 0) return null;
  const taken = provisionsOf(CAMPAIGN, coffer.pending);
  return (
    <p className="letter__tents">
      Aux tentes : {marcsLabel(purse(CAMPAIGN, coffer))}
      {taken.length > 0 ? ` ; l’ost emportera ${namesInline(taken.map((p) => p.name))}` : ''}.{' '}
      <button type="button" className="letter__tents-go" onClick={onTents}>
        Passer aux tentes
      </button>
    </p>
  );
}

/** The army's companions, in the council's order. */
const COMPANIONS = ['heroArcher', 'heroEngineer', 'heroKnight'] as const;

/** The three companions under the prologue: who they are, what they bring, who rests. */
function Companions({ resting }: { readonly resting: readonly string[] }) {
  return (
    <>
      <h3 className="letter__heading">Vos compagnons</h3>
      <ul className="companions">
        {COMPANIONS.map((id) => {
          const hero = DEFAULT_RULES.heroes[id];
          if (!hero) return null;
          const hurt = resting.includes(id);
          return (
            <li key={id} data-resting={hurt || undefined}>
              <HeroEmblem hero={id} size={44} muted={hurt} />
              <div>
                <strong>{hero.name}</strong>, {hero.title}
                {hurt && <em> · au repos</em>}
                <span>{hero.personality}</span>
                <span className="companions__gift">{hero.passive.name} : {hero.passive.description}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Overview({ onTents }: { readonly onTents: () => void }) {
  const conquered = useCampaign((s) => s.conquered);
  const resting = useCampaign((s) => s.resting);
  const done = CAMPAIGN.levels.every((l) => conquered[l.id]);
  const taken = CAMPAIGN.levels.filter((l) => conquered[l.id]).length;
  return (
    <>
      <h2 className="letter__title">{CAMPAIGN.realm}</h2>
      <p className="letter__epithet">{done ? 'la campagne est achevée' : `${taken} château${taken > 1 ? 'x' : ''} sur ${CAMPAIGN.levels.length} repris au Félon`}</p>
      <p className="letter__story">
        <Glossed>{done ? CAMPAIGN.epilogue : CAMPAIGN.prologue}</Glossed>
      </p>
      {resting.length > 0 && (
        <div className="letter__resting">
          {resting.map((h) => (
            <p key={h}>{CAMPAIGN.heroLines[h]?.resting}</p>
          ))}
        </div>
      )}
      <p className="letter__hint">{taken === 0 ? 'Commencez par le Fortin du Gué pour apprendre le siège, ou marchez droit sur Roche-Grise.' : 'Choisissez un château sur la carte.'}</p>
      <TentsNote onTents={onTents} />
      <Companions resting={resting} />
    </>
  );
}

function CastleLetter({ battle, index, onCouncil, onTents }: { readonly battle: CampaignBattle | CampaignLevel; readonly index: number; readonly onCouncil: () => void; readonly onTents: () => void }) {
  const conquered = useCampaign((s) => s.conquered);
  const tutorialDone = useCampaign((s) => s.tutorialDone);
  const lesson = index < 0;
  const record = lesson ? undefined : conquered[battle.id];
  const unlocked = lesson || isUnlocked(CAMPAIGN, conquered, index);
  const previous = index > 0 ? CAMPAIGN.levels[index - 1] : undefined;
  // This castle's battle left unfinished, if it was.
  const [save] = useState(loadBattleSave);
  const saved = isSaveOf(save, battle.id, lesson) ? save : null;
  return (
    <>
      <h2 className="letter__title">{battle.name}</h2>
      <p className="letter__epithet">
        {battle.epithet} {!lesson && <Shields n={battle.difficulty} />}
      </p>
      <blockquote className="letter__lord">
        « {battle.lordLine} »<cite>{battle.lord}</cite>
      </blockquote>
      <p className="letter__story">
        <Glossed>{battle.intro}</Glossed>
      </p>
      <h3 className="letter__heading">Ce que savent les coureurs</h3>
      <EffectList lines={castleLines(battle)} />
      {'feat' in battle && <FeatNote feat={battle.feat} />}
      {record && (
        <>
          <h3 className="letter__heading">Étendards</h3>
          <BannerRow record={record} level={battle} />
        </>
      )}
      {!lesson && <TentsNote onTents={onTents} />}
      <div className="letter__actions">
        {saved && (
          <button type="button" className="letter__go" onClick={() => navigate(ROUTES.battle, resumeParams(saved))}>
            Reprendre la bataille, au tour {saved.turn}
          </button>
        )}
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
  const tents = selected === TENTS;
  const toTents = () => setSelected(TENTS);
  const taken = CAMPAIGN.levels.filter((l) => conquered[l.id]).length;

  return (
    <main className="campaign-screen">
      <header className="campaign-bar">
        <div className="campaign-bar__left">
          <button type="button" className="campaign-bar__back" onClick={() => navigate(ROUTES.title)}>
            ← Menu
          </button>
          {taken > 0 && (
            <button type="button" className="campaign-bar__back" onClick={() => navigate(ROUTES.chronicle)}>
              La chronique
            </button>
          )}
        </div>
        <h1>Campagne du {CAMPAIGN.realm}</h1>
        <p className="campaign-bar__progress">
          Châteaux {taken} / {CAMPAIGN.levels.length} · Étendards {bannerTotal(conquered)} / {CAMPAIGN.levels.length * BANNERS_PER_CASTLE}
        </p>
      </header>
      <div className="campaign-body">
        <div className="campaign-map-frame">
          <CampaignMap nodes={nodes} selected={selected} fresh={fresh} tents={tents} onSelect={(id) => setSelected((s) => (s === id ? null : id))} onTents={toTents} />
        </div>
        <aside className="campaign-letter parchment-sheet" aria-live="polite">
          {/* The sheet stays put; its writing scrolls within it. */}
          <div className="campaign-letter__scroll">
            {tents ? <TentsLetter /> : battle ? <CastleLetter key={battle.id} battle={battle} index={index} onCouncil={() => setCouncil(true)} onTents={toTents} /> : <Overview onTents={toTents} />}
            {(battle || tents) && (
              <button type="button" className="letter__close" onClick={() => setSelected(null)}>
                ← Le Val d’Orle
              </button>
            )}
          </div>
        </aside>
      </div>
      {council && level && <Council level={level} resting={resting} onClose={() => setCouncil(false)} onMarch={(plan, rank) => navigate(ROUTES.battle, { level: level.id, ...(plan ? { plan } : {}), ...(rank === DEFAULT_RANK ? {} : { rank }) })} />}
    </main>
  );
}

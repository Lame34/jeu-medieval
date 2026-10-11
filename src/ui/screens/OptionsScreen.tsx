/**
 * Options (brief §10): graphics preset, text size, sound buses, animation speed, the end-of-turn
 * confirmation, battle hints, camera edge scrolling and speed; the controls; the campaign's reset.
 * Everything is saved in the browser (state/settings.ts) and applies at once.
 */
import { useId, useState, type ReactNode } from 'react';
import { QUALITY_PRESET_IDS, QUALITY_PRESETS } from '../../render/quality/presets.ts';
import { useCampaign } from '../../state/campaign.ts';
import { cameraKeys, useKeyLabels } from '../../state/keyboard.ts';
import { ANIMATION_SPEEDS, CAMERA_SPEEDS, TEXT_SCALES, useSettings, type SavedSettings, type VolumeBus } from '../../state/settings.ts';
import { IronFrame } from '../components/IronFrame.tsx';
import { navigate, ROUTES } from '../router.ts';
import './options.css';

const QUALITY_HINT = {
  portable: 'Pour un ordinateur portable : une image fluide, des ombres et une herbe plus discrètes.',
  medium: 'Plus d’herbe, des ombres plus loin, un léger halo de lumière.',
  high: 'Pour une carte graphique dédiée : tout au plus loin.',
} as const;
const ANIMATION_LABEL = { normal: '×1', fast: '×2', instant: 'Instantané' } as const;
const CAMERA_LABEL = { slow: 'Lente', normal: 'Normale', fast: 'Rapide' } as const;
const TEXT_LABEL = { normal: 'Normal', large: 'Grand', larger: 'Très grand' } as const;
const VOLUME_LABEL: Readonly<Record<VolumeBus, string>> = { master: 'Volume général', music: 'Musique', sfx: 'Effets', ambience: 'Ambiances' };

/** The controls, the camera's keys as the player's keyboard prints them. */
const controls = (keys: ReturnType<typeof cameraKeys>): readonly (readonly [string, string])[] => [
  ['Clic gauche', 'Sélectionner, se déplacer, attaquer'],
  [`${keys.move.join(' ')} ou flèches`, 'Déplacer la caméra (bords de l’écran aussi)'],
  [`${keys.turn.join(' / ')}, clic molette`, 'Pivoter la caméra'],
  ['Molette', 'Zoomer'],
  ['Tab', 'Homme suivant'],
  ['Clic sur la mini-carte', 'Y porter la caméra'],
  ['G · B · X · F', 'Garde · flèche enflammée · éteindre · travaux de siège'],
  ['1 · 2', 'Capacités du héros'],
  ['Échap', 'Annuler, désélectionner'],
  ['Entrée', 'Fin du tour'],
  ['M', 'Couper le son'],
];

function Choice<T extends string>({ label, value, options, onChange, hint }: { readonly label: string; readonly value: T; readonly options: readonly (readonly [T, string])[]; readonly onChange: (v: T) => void; readonly hint?: ReactNode }) {
  // A label of several words cannot be an id (aria-labelledby splits on spaces).
  const id = useId();
  return (
    <div className="option">
      <span className="option__label" id={id}>
        {label}
      </span>
      <div className="option__choices" role="radiogroup" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} data-on={v === value || undefined} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
      {hint && <p className="option__hint">{hint}</p>}
    </div>
  );
}

function Toggle({ label, value, onChange, hint }: { readonly label: string; readonly value: boolean; readonly onChange: (v: boolean) => void; readonly hint?: string }) {
  return (
    <Choice
      label={label}
      value={value ? 'yes' : 'no'}
      options={[
        ['yes', 'Oui'],
        ['no', 'Non'],
      ]}
      onChange={(v) => onChange(v === 'yes')}
      {...(hint ? { hint } : {})}
    />
  );
}

function Slider({ bus }: { readonly bus: VolumeBus }) {
  const value = useSettings((s) => s.volumes[bus]);
  const muted = useSettings((s) => s.muted);
  return (
    <label className="option option--slider">
      <span className="option__label">{VOLUME_LABEL[bus]}</span>
      <input type="range" min={0} max={100} step={5} value={Math.round(value * 100)} disabled={muted} onChange={(e) => useSettings.getState().setVolume(bus, Number(e.target.value) / 100)} />
      <span className="option__value">{Math.round(value * 100)} %</span>
    </label>
  );
}

function ResetCampaign() {
  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <p className="option__hint">La campagne repart de zéro : le Félon tient de nouveau ses cinq châteaux.</p>;
  return (
    <button
      type="button"
      className="option__danger"
      data-armed={armed || undefined}
      onClick={() => {
        if (!armed) return setArmed(true);
        useCampaign.getState().reset();
        setDone(true);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? 'Vraiment ? Cliquez encore pour tout effacer' : 'Effacer la progression de la campagne'}
    </button>
  );
}

export default function OptionsScreen() {
  const s = useSettings();
  const layout = useKeyLabels((k) => k.layout);
  const set = <K extends keyof SavedSettings>(key: K) => (v: SavedSettings[K]) => s.set(key, v);
  return (
    <main className="options-screen">
      <section className="options-panel parchment-sheet" aria-labelledby="options-title">
        <IronFrame />
        <header className="options-head">
          <button type="button" className="options-back" onClick={() => navigate(ROUTES.title)}>
            ← Menu
          </button>
          <h1 id="options-title">Options</h1>
        </header>
        <div className="options-columns">
          <div>
            <h2>Affichage</h2>
            <Choice label="Qualité" value={s.quality} options={QUALITY_PRESET_IDS.map((id) => [id, QUALITY_PRESETS[id].label] as const)} onChange={s.setQuality} hint={QUALITY_HINT[s.quality]} />
            <Choice label="Texte en bataille" value={s.textScale} options={(Object.keys(TEXT_SCALES) as (keyof typeof TEXT_SCALES)[]).map((k) => [k, TEXT_LABEL[k]] as const)} onChange={set('textScale')} />
            <h2>Son</h2>
            <Toggle label="Couper le son" value={s.muted} onChange={s.setMuted} hint="Aussi avec M pendant la bataille." />
            {(['master', 'music', 'sfx', 'ambience'] as const).map((bus) => (
              <Slider key={bus} bus={bus} />
            ))}
            <h2>Partie</h2>
            <Choice label="Animations" value={s.animation} options={(Object.keys(ANIMATION_SPEEDS) as (keyof typeof ANIMATION_SPEEDS)[]).map((k) => [k, ANIMATION_LABEL[k]] as const)} onChange={set('animation')} hint="La vitesse des déplacements, des tirs et du tour adverse." />
            <Toggle label="Confirmer la fin du tour" value={s.confirmEndTurn} onChange={set('confirmEndTurn')} hint="Si des troupes peuvent encore agir." />
            <Toggle label="Conseils en bataille" value={s.hints} onChange={set('hints')} hint="Le briefing du premier tour et les rappels de commandes." />
          </div>
          <div>
            <h2>Caméra</h2>
            <Toggle label="Défilement aux bords" value={s.edgeScroll} onChange={set('edgeScroll')} />
            <Choice label="Vitesse" value={s.cameraSpeed} options={(Object.keys(CAMERA_SPEEDS) as (keyof typeof CAMERA_SPEEDS)[]).map((k) => [k, CAMERA_LABEL[k]] as const)} onChange={set('cameraSpeed')} />
            <h2>Commandes</h2>
            <dl className="options-controls">
              {controls(cameraKeys(layout)).map(([key, what]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
            <h2>Progression</h2>
            <ResetCampaign />
            <button type="button" className="option__plain" onClick={s.restoreDefaults}>
              Rétablir les options par défaut
            </button>
            {/* The light-tuning workshop is a development tool: not in the players' menu. */}
            {import.meta.env.DEV && (
              <button type="button" className="option__plain" onClick={() => navigate(ROUTES.lookdev)}>
                Atelier du peintre (réglage de la lumière)
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

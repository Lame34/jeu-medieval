# CLAUDE.md — « Siège »

Jeu de stratégie tour par tour médiéval (siège de château) en Three.js / React Three Fiber.
La bible du projet est **`docs/GAME_BRIEF.md`**, qui fait foi. La direction artistique est dans `docs/STYLE_BIBLE.md` et les décisions dans `docs/DECISIONS.md` (ADR).

## Règles de travail
- **Tout se fait en ligne de commande.** L'utilisateur ne lance aucune application et ne clique jamais : c'est l'agent qui lance serveurs, navigateurs de test, Blender headless et téléchargements.
- **Toujours charger la chaîne d'outils portable** (Node 24, Blender 4.5, KTX), qui n'est pas celle du système (Node 20) :
  - Bash : `source scripts/env.sh && <commande>`
  - PowerShell : `. ./scripts/env.ps1; <commande>`
- Autonomie de jalon en jalon ; on ne s'arrête qu'aux ⛳ du brief (J2, J5, J8) ou sur un blocage réel.
- Commits atomiques au format **Conventional Commits** (`feat(core): …`, `fix(render): …`, `docs: …`).
- Aucun cube gris à l'écran : tout asset manquant a un substitut stylisé consigné dans `docs/ASSETS_TODO.md`.

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur Vite sur :5188 |
| `npm run build` / `npm run preview` | Build de production (tsc -b puis vite build) / aperçu sur :4188 |
| `npm run typecheck` | `tsc -b` : core (sans DOM), app, scripts, tests |
| `npm run lint` | ESLint, 0 warning toléré |
| `npm test` / `npm run test:cov` | Vitest (`tests/core`), couverture ≥ 80 % sur `src/core` |
| `npm run e2e` | Playwright (`tests/e2e`) |
| `npm run bench:core` | Micro-bench navigation 512² (budgets du core) |
| `npm run bench:perf -- --preset portable [--scene battle] [--cpu-throttle 4] [--log]` | Bench GPU (Intel Arc obligatoire), une scène par passe (lookdev par défaut), écrit dans `docs/PERF_LOG.md` |
| `npm run capture:lookdev [-- <tag> --scene battle --breakdown]` | Captures des vues × 3 heures dans `docs/captures/` (ventilation des triangles avec `--breakdown`) |
| `node scripts/capture-siege.ts [<tag>] [--seed siege-1]` | Siège scripté via `?e2e` (pont-levis, fissures, effondrement, parc d'engins) capturé dans `docs/captures/` |
| `npm run assets:engines` | Blender headless : bélier et catapulte (maillages skinnés, couleurs de sommet) dans `assets-src/work/engines` |
| `npm run assets:characters` | Blender headless : RPG Characters → GLB (proportions, atlas, tabard, clips) dans `assets-src/work/rpg` |
| `npm run assets:process` | Pipeline d'assets (gltf-transform, meshopt, KTX2) vers `public/assets` |
| `node scripts/<x>.ts` | Scripts TypeScript exécutés nativement par Node 24 (ADR-013) |

## Architecture (détails dans `docs/ARCHITECTURE.md`)
```
src/core/     Simulation déterministe, TypeScript pur : pas de three, React ni DOM (tsconfig.core.json sans lib DOM)
  rng.ts        sfc32 à graine ; fork(label) = sous-flux indépendant
  math/ noise/  hash canonique, vec2 (x, z), fBm/ridged/warp
  rules/        types des règles + validation des JSON de src/data
  terrain-data/ heightfield (coins) + couche de navigation par cellule de 1 m
  nav-grid/     NavGrid, A*, Dijkstra borné (aires), lissage, ligne de vue, DDA
  commands/ events/ battle/   Command → applyCommand → GameEvent ; replay(seed, scenario, commands)
src/data/     JSON des règles (terrain, unités, dégâts), validés au chargement (DEFAULT_RULES)
src/render/   Three/R3F : materials (PaintedMaterial), terrain, vegetation, water, sky, castle, units, postfx, camera, quality
src/ui/       Écrans React, HUD, thème bois, parchemin et fer
src/state/    Stores zustand (UI uniquement ; jamais la vérité de la simulation)
tests/        core/ (Vitest), e2e/ et perf/ (Playwright)
scripts/      env.*, benchs, captures, pipeline d'assets, blender/*.py
assets-src/   Téléchargements bruts (raw/, ignoré par git) + INVENTORY.md
public/assets/ Assets optimisés livrés
```

### Invariants du core (vérifiés par ESLint et tsconfig.core)
- Jamais `Math.random`, `Date.now` ni `performance.now` dans `src/core` : la RNG et le temps sont des paramètres.
- Aucun import de `three`, `react`, `@react-three/*`, `@render`, `@ui`, `@state` ni `@audio` dans `src/core`.
- Imports relatifs avec l'extension **`.ts`** (le core tourne aussi directement sous Node) ; JSON importés avec `with { type: 'json' }`.
- Une bataille = `seed + Scenario + Command[]` ; `hashBattleState` doit être identique à chaque replay.
- Aucun nombre magique : les réglages sont dans `src/data/*.json` ou dans des constantes nommées.
- Coordonnées du sol en `(x, z)` en mètres ; la hauteur est `y` côté rendu. La cellule `(cx, cz)` couvre `[cx, cx+1) × [cz, cz+1)`.
- `edgeCost` est bit à bit identique à `segmentCost` entre centres voisins : un seul métrique de coût, de l'aperçu à l'exécution.

### Invariants du rendu
- Un seul matériau maison, le **PaintedMaterial** (base `MeshLambertMaterial` + `onBeforeCompile`), réassigné à tous les assets importés ; seul l'albédo est conservé.
- Budgets Portable (ADR-007) : ≥ 60 FPS sur l'Intel Arc, < 150 draw calls, < 1,5 M triangles, < 400 Mo de textures ; `dpr` plafonné à 1 ; une seule lumière qui projette des ombres.
- Aucune allocation dans `useFrame` ; pas de `setState` par frame ; `dispose()` vérifié via `renderer.info`.
- Shaders précompilés (`renderer.compile`) derrière l'écran de chargement.

## Sous-agents (`.claude/agents/`)
| Agent | Périmètre d'écriture |
|---|---|
| `asset-scout` | `assets-src/`, `assets/CREDITS.md` |
| `art-director` | Aucun (lecture seule, grille §13 du brief) |
| `perf-auditor` | Aucun, sauf via `bench:perf --log` |
| `test-engineer` | `tests/` |

Protocole : c'est l'agent principal qui intègre le code. Après chaque sous-agent, vérifier `git status` et annuler toute écriture hors périmètre. Jamais deux agents sur les mêmes fichiers en parallèle. Les définitions ne sont chargées qu'au démarrage d'une session ; sinon, lancer un agent généraliste en lui faisant lire la définition (ADR-011).

## Skills installés (`.claude/skills/`, ADR-003)
`three-best-practices`, `r3f-best-practices`, `threejs-syntax-shaders`, `threejs-agents-model-optimizer` (meshopt plutôt que Draco, décodeurs locaux), `threejs-errors-performance`, `procedural-landscapes` (sans `Math.random` ni CDN), `playwright-best-practices`.

## Boucle visuelle (brief §13)
Tout travail de lumière, de matériaux et de post-process se fait d'abord dans `/lookdev`. On capture (`capture:lookdev`), l'`art-director` note les 6 critères, puis on corrige. On itère tant qu'un critère est sous 8/10 ; chaque itération est consignée dans `STYLE_BIBLE.md`. Beauté et performance se valident ensemble.

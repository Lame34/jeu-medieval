# Décisions — « Siège »

Format ADR court : contexte, décision, conséquences. Les décisions les plus récentes sont en bas. Une décision remplacée est marquée ~~barrée~~, avec un lien vers celle qui la remplace.

---

## ADR-001 — Racine du projet
**Contexte** : l'arborescence du brief est enracinée dans `siege/`, mais le dépôt existe déjà dans `C:\dev\jeu-medieval`.
**Décision** : la racine du projet est `C:\dev\jeu-medieval`, et l'arborescence du §4 s'y applique telle quelle. Le paquet npm s'appelle `siege`.

## ADR-002 — Chaîne d'outils portable, sans droits administrateur
**Contexte** : l'utilisateur ne lance aucune application et veut tout piloter en ligne de commande. `winget install` des MSI Node et Blender déclenche une invite UAC qui bloque indéfiniment un shell sans élévation.
**Décision** : les outils sont installés en **portée utilisateur**, depuis les archives officielles vérifiées par SHA-256, dans `%LOCALAPPDATA%\Programs\siege-tools\` :
- Node.js **24.21.0** LTS (zip nodejs.org, SHASUMS256 vérifié)
- Blender **4.5.14 LTS** (zip download.blender.org, `.sha256` vérifié), pour le mode headless `blender -b -P`
- KTX-Software **4.4.2** (installeur NSIS extrait avec 7-Zip, digest GitHub vérifié) : `ktx`, `toktx`

`scripts/env.ps1` et `scripts/env.sh` placent ces outils en tête du PATH, pour la session seulement. Le Node 20 du système reste intact.
**Conséquence** : chaque commande du projet est précédée de `source scripts/env.sh &&` (Bash) ou de `. ./scripts/env.ps1;` (PowerShell).

## ADR-003 — Skills Claude Code
**Contexte** : le brief demande `npx add-skill`, qui est **déprécié** (npm : « use `npx skills add` »). Il demande aussi 5 skills au maximum issus du registre `majiayu000/claude-skill-registry`, chacun lu intégralement avant l'installation.
**Décision** : installation par `npx skills add <source> --skill <nom> -a claude-code --copy -y`, en portée projet (`.claude/skills/`), avec `DISABLE_TELEMETRY=1`. Chaque skill a été téléchargé dans le scratchpad, lu (SKILL.md et scripts ; les fichiers de référence ont été passés au crible des motifs suspects), puis comparé octet par octet à la copie installée.

**Hors quota (demandés explicitement par le brief)**
| Skill | Source | Remarque |
|---|---|---|
| `three-best-practices` | emalorenzo/three-agent-skills | Texte seul, three r182+. La règle « import maps » ne s'applique pas (on utilise Vite). |
| `r3f-best-practices` | emalorenzo/three-agent-skills | Texte seul. Incomplet : il annonce « 70+ règles » mais n'en contient que 7, et renvoie vers un document compilé non installé ainsi que vers un fichier mal nommé (`state-zustand-selectors.md`, en réalité `perf-zustand-selectors.md`). |

**Registre (5/5), tous présents dans l'index `search-shards` du registre (version du 2026-08-25)**
| Skill | Source | Pourquoi |
|---|---|---|
| `threejs-syntax-shaders` | OpenAEC-Foundation/Three.js-Claude-Skill-Package | Référence GLSL, `onBeforeCompile`, `customProgramCacheKey` et ShaderChunk : c'est le cœur du PaintedMaterial. |
| `threejs-agents-model-optimizer` | idem | Pipeline gltf-transform (dedup, weld, simplify, KTX2, LOD). **Écarts** : on compresse en **meshopt** plutôt qu'en Draco, les décodeurs sont auto-hébergés depuis `node_modules/three` (pas de CDN) et **aucun `npm i -g`**. |
| `threejs-errors-performance` | idem | Diagnostic de performance (`renderer.info`, dispose, instancing, pooling). Utile à `perf-auditor`. |
| `procedural-landscapes` | CK42BB/procedural-landscapes-threejs | Terrain en chunks et LOD, bruits (fBm, ridged, domain warp), texture selon la pente. **Écarts** : pas de `Math.random` (le core est déterministe), pas d'eau en `MeshPhysicalMaterial` ni de recalcul CPU des normales à chaque frame, pas de CDN. L'archive `.skill` fournie a été supprimée, faute d'avoir été relue. |
| `playwright-best-practices` | 0xBigBoss/claude-code | Court, pensé pour un agent en CLI (reporters `line`/`dot`), assertions web-first. |

**Écartés** : `r3f-shaders` (EnzeD), `procedural-gen` (gamedev-skills), `blender-scripting` (andrew1326) et `playwright-best-practices` (currents-dev), de bonne qualité mais **absents de l'index du registre**. `blender-web-pipeline`, dont les scripts sont bogués et qui décime à 30 % par défaut. Tous les skills Blender du registre (0 étoile, ponts vers un add-on, chemins en dur). Pour Blender, on s'appuie sur la documentation `bpy` 4.5 et sur nos propres scripts.

## ADR-004 — TypeScript 6.0.3 plutôt que 7.0
**Contexte** : TypeScript 7.0.2 (le compilateur natif) est la version `latest`, mais typescript-eslint 8.70 exige `typescript < 6.1`.
**Décision** : TypeScript **6.0.3**, avec `strict`, `noUncheckedIndexedAccess` et `erasableSyntaxOnly`. À réévaluer quand typescript-eslint prendra en charge TS 7.

## ADR-005 — Vitest 5 sur Node 24
Vitest 5 exige Node ≥ 22.12, ce qui est couvert par l'ADR-002. `@vitest/coverage-v8` 5, seuil de 80 % sur `src/core/**`.

## ADR-006 — Retrait de r3f-perf
**Contexte** : `r3f-perf` 7.2.3, la dernière version, dépend de `@react-three/drei` 9 et de React 18. Il installe une seconde copie de drei et `three-mesh-bvh` 0.7 (déprécié).
**Décision** : on le retire. Le monitoring passe par **stats-gl** et par un HUD maison (`src/render/debug/PerfHud.tsx`) qui lit `renderer.info`. `window.__perf` sert au bench automatisé.

## ADR-007 — GPU de référence et budgets
**Contexte** : la machine de développement (Dell Precision 3490) a un iGPU **Intel Arc** et une RTX 500 Ada. L'utilisateur a choisi de « viser plus bas » (Iris Xe / Vega 8).
**Décision** : le préréglage Portable est validé **uniquement sur l'Intel Arc** : ≥ 60 FPS en moyenne, 1 % low ≥ 40, et ≥ 40 FPS avec le CPU bridé ×4. Les autres budgets du §7 sont inchangés. `perf-bench` refuse toute mesure « Portable » dont la chaîne `UNMASKED_RENDERER_WEBGL` n'indique pas l'Intel. La préférence GPU « économie d'énergie » est appliquée seulement à l'exécutable Chromium de Playwright (clé HKCU `DirectX\UserGpuPreferences`), pas au Chrome de l'utilisateur.

## ADR-008 — Licences Quaternius
**Contexte** : les pages des packs Quaternius affichent « CC0 », mais la page License du site affiche depuis le 28/08/2026 la « Quaternius Asset License v1.0 », qui interdit la redistribution des fichiers bruts.
**Décision** : on n'utilise que des **copies publiées sous CC0** (zips OpenGameArt contenant le fichier de licence CC0, qui est irrévocable pour ces copies). Le fichier de licence est archivé avec chaque pack, avec le SHA-256 de l'archive dans `assets/CREDITS.md`. `assets-src/raw/` n'est jamais versionné ; seules les versions transformées (meshopt, KTX2 et fusion) sont livrées dans `public/assets/`.

## ADR-009 — Sources d'assets scriptables uniquement
**Contexte** : l'utilisateur ne clique jamais. itch.io et Patreon sont derrière Cloudflare ou un formulaire.
**Décision** : les sources autorisées sont OpenGameArt (liens directs), Godot Asset Store, Google Drive public, poly.pizza, kenney.nl, GitHub et Google Fonts/Fontsource. **Aucun contournement** de Cloudflare ni de captcha. Un asset introuvable par ces voies est remplacé par un substitut procédural stylisé et consigné dans `ASSETS_TODO.md`.

## ADR-010 — PaintedMaterial sur base MeshLambertMaterial
**Contexte** : le brief autorise `MeshStandardMaterial` étendu ou un `ShaderMaterial`. Sur iGPU, le PBR Standard (GGX, environnement) coûte cher et n'apporte rien au style peint.
**Décision** : le PaintedMaterial étend **`MeshLambertMaterial`** (éclairage par pixel depuis r150) via `onBeforeCompile`. Il réutilise les chunks d'ombre, de brouillard, d'instancing et de skinning de three, avec un `customProgramCacheKey` stable par combinaison de defines (`PAINTED_UNIT`, `PAINTED_INSTANCED`, `PAINTED_SKINNED`). Les uniforms globaux (soleil, ombre, brume, vent, temps) sont partagés par référence. Les normal, roughness et metalness maps importées sont **ignorées** ; seul l'albédo est conservé.

## ADR-011 — Sous-agents et périmètres
**Contexte** : les définitions `.claude/agents/*.md` ne sont chargées qu'au démarrage d'une session Claude Code. Le champ `tools` ne permet pas de restreindre les chemins.
**Décision** : les restrictions de chemin figurent dans les instructions de chaque agent. L'agent principal vérifie `git status` après chaque passage et annule toute écriture hors périmètre. Tant que la session en cours n'a pas été relancée, un agent généraliste reçoit l'instruction de lire et d'appliquer la définition correspondante.

## ADR-012 — Journal de performance écrit par le script
`perf-auditor` n'a pas de droit d'écriture. `node scripts/perf-bench.ts --log` ajoute lui-même l'entrée datée à `docs/PERF_LOG.md` ; l'agent ne fait qu'exécuter le script et en analyser la sortie.

## ADR-013 — Scripts TypeScript exécutés nativement par Node 24
Les scripts de `scripts/` sont en TypeScript « effaçable » (`erasableSyntaxOnly`, sans enum ni namespace) et s'exécutent avec `node script.ts` (type stripping natif de Node 24), sans `tsx` ni build.

## En attente
- **Personnages et animations** : dépendent du rapport d'`asset-scout` et du test de la planche (J2).
- **Cavalerie** : cheval Quaternius CC0 et cavalier attaché à l'os `Back`, ou alternative (voir le rapport d'`asset-scout`).
- **Arbres** : MegaKit (environ 6k triangles, feuilles en alpha) contre houppiers procéduraux opaques ; décision au test de la planche (J2).

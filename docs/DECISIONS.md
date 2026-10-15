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

## ADR-014 — Personnages : Quaternius « RPG Characters » convertis en headless
**Contexte** : les « Universal Base Characters » visés par le brief ne sont publiés que sur itch.io (non scriptable, ADR-009). Au test de la planche (revue v9), l'art-director a rejeté les KayKit Adventurers pour la version finale : environ 2,5 têtes de haut (chibi, alors que le brief demande des proportions « légèrement héroïques », ~4–5 têtes), têtes qui dépassent des merlons, dégradés « jouet en plastique » face aux textures peintes du MegaKit.
**Décision** : on utilise les **Quaternius RPG Characters (nov. 2020)**, copie CC0 d'OpenGameArt (`License.txt` CC0 dans l'archive). Ils ont des textures peintes, un rig commun de 44 os et 20 clips : idle, marche, course, épée, dague, **arc** (tirer et décocher), coup reçu, mort, roulade, ramasser. `scripts/blender/convert_rpg_characters.py` (`npm run assets:characters`, Blender 4.5 en headless) effectue, pour chaque corps :
- la reliure des textures ;
- la conversion des pièces rattachées à un os (visage, épaulières, arme) en parties skinnées rigides ;
- le **réglage des proportions** dans la pose de repos : tête ×0,8, jambes ×1,12 et bassin relevé, soit environ 4,5 têtes ;
- un **atlas corps + arme** (un matériau, donc un draw call par unité) et un GLB sans clips.

Une **bibliothèque d'animations** unique (`rpg-animations.glb`) est construite, après vérification que les poses de repos sont identiques. L'allégeance est peinte par recoloration par teinte de l'atlas (canvas, une fois par corps et par faction), avec un gain de luminosité car les tissus source sont sombres. KayKit ne sert plus que pour quelques props (boucliers, arbalètes) en attente de J3.
**Conséquences** : 3 corps retenus (warrior, ranger, rogue ; cleric et monk sans tissu recolorable). Manquent l'arbalète, la lance, cheer et push, à traiter en J3 (clés authorées en Blender ou reciblage UAL). Un unique réglage `UNIT_SCALE` donne environ 2,15 m.

## ADR-015 — Arbres procéduraux opaques
**Contexte** : les arbres du Stylized Nature MegaKit font environ 6 k triangles avec des feuilles en alpha, qui scintillent (anti-référence §5.2) et coûtent cher sur iGPU.
**Décision** : on garde des **houppiers procéduraux opaques**. Ce sont des grappes de blobs bosselés, avec des normales mêlées à l'ellipsoïde du houppier, des touches de pinceau dans le shader, des branches maîtresses et 5 variantes par espèce, soit environ 1,1 k triangles. Le LOD léger (icosaèdres de détail 0, normales sphériques) en fait environ 180. L'art-director les a acceptés au test de la planche (v9), sous réserve des corrections appliquées en v10.

## ADR-016 — Végétation en BatchedMesh avec LOD par instance
**Contexte** : sur la carte de 500 m, on compte 3 500 arbres, buissons et fougères, plus environ 1 400 blobs de haie. Avec des InstancedMesh par variante, on dépassait les deux budgets (plus de 2,8 M triangles, et de nombreux draw calls avec la passe d'ombre).
**Décision** : un `BatchedMesh` par espèce (`src/render/vegetation/lod-batch.ts`) regroupe toutes les variantes en deux niveaux. Chaque instance change de géométrie selon sa distance à la caméra : détaillée sous 85 m (60 m pour les haies), avec une hystérésis de 8 m et une réévaluation seulement quand la caméra a bougé de 4 m. Les fougères sont masquées au-delà de 70 m. Le culling se fait par instance, sans tri de profondeur (objets opaques, tri inutilement coûteux en CPU). Le PaintedMaterial gère `batchingMatrix` pour le vent et la position monde.
**Mesure** : sur la look-dev, 87 → 53 draw calls pour le même débit (106,8 FPS contre 106,5). Le multi-draw émulé par ANGLE/D3D11 n'a pas coûté de CPU mesurable.

## ADR-017 — Blé diffusé autour du point de visée
**Décision** : les touffes sont générées à la demande par chunks de 16 m, de façon déterministe (hachage des indices de grille, sans état global), avec au plus 6 chunks par frame. On les affiche dans un disque de 72 m autour du point de visée, en deux niveaux par culture : touffes complètes sous 40 m de la caméra, sinon 2 touffes sur 3 élargies ×1,55. Les plafonds sont de 8 000 et 14 000 instances. Sur l'anneau extérieur, les touffes s'enfoncent dans le lit de champ doré du terrain (vertex shader), qui porte seul la culture au-delà.

## ADR-018 — Génération de la carte dans un Web Worker
La carte de 512 m (environ 1,2 s, voir PERF_LOG « Chargement de la bataille ») est générée dans `src/ui/workers/worldgen.worker.ts` : le core est du TypeScript pur, et la disposition passe par clonage structuré, avec transfert des tableaux du terrain. L'écran de chargement reste vivant et l'on mesure 5,5–5,7 s jusqu'à la scène prête, shaders compilés (budget < 10 s). Le script de capture lit `document.body.dataset.worldgenMs`.

## ADR-019 — Méthode de mesure en deux passes
Une passe **non plafonnée** (`--disable-gpu-vsync --disable-frame-rate-limit`) mesure le débit et la marge. Une passe **plafonnée par la vsync** à 60 Hz mesure le 1 % low : sans plafond, les intervalles de `requestAnimationFrame` arrivent par rafales et le 1 % low perd son sens (un 4,5 FPS isolé au premier journal). `renderer.info` est cumulé sur la frame entière (`autoReset = false`), passes d'ombre et de post-process comprises.

## ADR-020 — Résolution dynamique : implémentée, désactivée par défaut
**Contexte** : sur ce portable, l'iGPU Arc s'étrangle après quelques minutes de charge soutenue. Le 1 % low tombe alors de ~52 à 20–30, en rafales de frames à ~25 ms, alors que le CPU reste inactif à 92 %. Le brief prévoit une résolution dynamique de 67 à 100 %.
**Décision** : `src/render/quality/DynamicResolution.tsx` (compte des frames lentes > 20 ms, chauffe, pas de 0,1) est en place mais **activable seulement par `?dynres`**. `postprocessing` réalloue ses tampons à chaque `setSize`, et chaque palier coûte un à-coup. En plus, les changements de vue font descendre l'échelle en cascade.
**Mesure (bataille ×1)** :
- pleine résolution : 1 % low 49 à 55 ;
- résolution dynamique : 1 % low 23 à 41, échelle tombée à 0,67.

**À faire (J8)** : rendre dans des cibles allouées une fois à la taille maximale, avec viewport et scissor réduits, sans réallocation. Réactiver ensuite par défaut.

## ADR-021 — Ombres simplifiées et anneau en parcellaire
**Contexte** : la revue v19 relève deux défauts de lecture. Les créneaux projetaient un peigne de fentes de 0,6 m que la carte d'ombre rendait en stries ondulées de 1 à 3 px, qui rampent dès que la caméra bouge. L'anneau décoratif était une plaine olive, bordée à la couture de la carte d'une bande de mousse vert sombre, parce que son canal forêt portait la *probabilité* de forêt et non les bosquets placés.
**Décision** :
- *Ombre des créneaux* : une bande pleine par segment de mur et par couronne de tour (`buildCrenelShadowProxy`), dessinée invisible (`colorWrite` et `depthWrite` désactivés), qui projette seule l'ombre du parapet. Coût : un appel de dessin et une trentaine de triangles. On ne passe pas par un calque réservé, car three r186 filtre les objets de la passe d'ombre sur les calques de la caméra de vue (`WebGLShadowMap`, `renderObject`).
- *Anneau* : parcellaire calculé dans le shader du terrain (variante `TERRAIN_RING`) : bandes de 60 à 140 m par rangs de 90 m, courbées par un bruit basse fréquence ; cinq teintes (pré, herbe sèche, jachère, blé, seigle) ; haies sur environ la moitié des bords, anticrénelées par `fwidth` et effacées entre 1,2 et 2,2 km. Le sol de forêt n'est plus peint que sous les bosquets placés (splat 512², disques de 1,6 fois l'échelle du bosquet). Les chemins s'estompent sur les 14 derniers mètres avant le bord de la carte.

## ADR-022 — Validation du jalon J2
**Contexte** : au ⛳ J2 (30/09/2026), la scène de look-dev plafonne à 6,5/10 depuis quatre revues (v17 à v20), sous le 8/10 du brief. L'art-director distingue deux sortes de freins. La lumière et la composition relèvent du réglage. Le paysage et la cohérence butent sur des limites structurelles : personnages lisses au milieu d'un décor à facettes, arbres procéduraux « low-poly », herbe à un triangle. Les performances du build de production tiennent le budget en moyenne ; le 1 % low de la bataille tombe parfois sous 40 par à-coups isolés, et le chargement à froid de la bataille prend 10,1 à 10,2 s. Captures du rapport : `docs/style-log/j2`.
**Décision (validée par l'utilisateur)** :
- le style actuel sert de base à la production et l'on passe en J3. Le look-dev continue par petites touches, avec les corrections de réglage de la revue v20 : sécheresse bornée de l'anneau, perspective aérienne, couleur de l'herbe, pierre au matin et au crépuscule, ombres du crépuscule, plan rapproché, haies, maçonnerie, lit du champ, conifères, contrôle de saturation, capuche et rim light des unités ;
- les chantiers structurels (houppiers peints en grappes de lobes, herbe en touffes, stylisation des personnages par shader, armes grossies) sont reportés au polish J7. La cible de 8/10 sera réévaluée à ce moment-là ;
- les à-coups de la carte de bataille et le temps de chargement sont profilés au début de J3, avant l'ajout des unités et des effets.

## ADR-023 — Boucle de combat (J3)
**Décision** :
- **Économie d'actions.** Une attaque coûte `attackApCost` (1 PA, la réserve du contour « déplacement + action ») et une unité attaque au plus `actionsPerTurn` fois par tour (1). Sans cette limite, quatre PA immobiles feraient quatre attaques.
- **Même calcul pour l'aperçu et la résolution.** `previewAttack` et `resolveAttack` (`battle/combat.ts`) partagent `blowOdds` : les chances affichées sont celles tirées. Le couvert ne s'applique qu'aux tirs (cellule de la cible, haie ou muret à 1,6 m devant elle côté tireur, feuillage traversé). La hauteur compte par tranche entière de 3 m, dans les deux sens. Une attaque au contact attire une riposte, moins précise (×0,75).
- **Garde** (`battle/overwatch.ts`). Réservée au tir direct. Le déplacement adverse est échantillonné tous les 0,5 m ; le premier point dans le cône (±40°), à portée et en vue, déclenche un tir (×0,85). Le déplacement est découpé en segments autour de chaque tir pour que la file d'animation les joue dans l'ordre. La garde expire au tour suivant de l'unité.
- **Morale** (`battle/morale.ts`). Allié mort à 12 m ou moins : −15 ; passage sous la moitié des PV : −10 ; victime : +5 ; récupération de +5 par tour. Sous 30, −1 PA ; sous 15, l'unité fuit d'elle-même vers la cellule atteignable la plus éloignée de l'ennemi et n'obéit plus. Encerclement, feu et effondrements en J4.
- **IA** (`ai/planner.ts`). Scores d'utilité sur au plus 160 cases atteignables par unité (attaque attendue, chance de tuer, priorité aux engins et aux blessés, riposte, exposition, couvert, trajet). L'approche se mesure en PA par un Dijkstra multi-sources depuis les ennemis (`computeCostField`), pour ne pas piétiner devant une garnison hors d'atteinte. Coût : 0,2 à 0,5 s par tour sur la carte de 512 m, à déplacer dans un worker si cela se ressent.
- **Avant-poste.** Les remparts ne sont pas encore praticables (J4). La carte de bataille place donc quatre défenseurs dans le village, en terrain ouvert, pour que la boucle se joue.
- **Architecture.** `BattleSession` (`ui/battle/session.ts`) détient l'état et le journal de commandes. Le store `battle-ui` n'en est qu'un miroir pour le HUD. `BattleDirector` joue les événements un par un (poignées d'unité : clip, vivant, silhouette). `BattleOverlays` dessine les contours, le chemin, les anneaux et les cônes de garde. Le point d'accès `?e2e` (`window.__battle`) et `?fast` (animations ×8) servent aux tests.

## ADR-024 — Ouvrages du château et engins de siège (J4)
**Décision** :
- **La grille suit les ouvrages.** Les ouvrages du château (`battle/structures.ts`) sont définis à partir de la carte : un segment de courtine par tronçon de mur (ses cellules de chemin de ronde, tours exclues), la porte et la herse sur le passage de la porterie, le pont-levis sur le couloir de la douve. L'état de bataille (`BattleState.structures`, version 3) ne porte que leurs PV et un drapeau « tombé ». La grille de navigation est une fonction pure de la carte et des ouvrages tombés : brèche en gravats franchissables au niveau du sol, passage en route quand la porte **et** la herse sont tombées, pont posé à hauteur du seuil. `syncNav` la reconstruit une fois par combinaison, puis la garde en cache ; elle est appelée au début et à la fin de chaque commande et à l'entrée des fonctions d'aperçu (déplacement, attaque, menaces, IA). Un rejeu retrouve donc exactement les mêmes grilles.
- **Marches de pont.** `deckStepCost` compare les surfaces (relief + tablier) dès qu'une des deux cellules porte un tablier ; entre deux cellules au sol, la pente reste seule juge. Un pont posé de niveau sur la douve rejoint ainsi ses deux berges, tandis que le pied d'un mur reste hors d'atteinte du chemin de ronde. `edgeCost` et `segmentCost` partagent toujours cette fonction (invariant bit à bit).
- **Qui frappe quoi** (`battle/siege.ts`). Seuls les engins de siège entament les ouvrages, au contact (bélier) ou en tir indirect (catapulte), sans ligne de vue ni modificateur de hauteur. Le bélier ne frappe que les portes. Le pont-levis levé protège la porte, et la porte intacte protège la herse. Le pont-levis ne se brise pas : il tombe quand son treuilliste meurt, quelle que soit la cause (contrôle après chaque commande). Chances : précision + `hitBonus` ; dégâts selon la table du brief contre le matériau (pierre, bois, lourd pour la herse). Aperçu et tirage partagent les mêmes chances.
- **Effondrement.** Les unités du segment chutent (`fallDamage`, garde perdue) ; les défenseurs à 20 m ou moins perdent 20 de moral (`wallCollapsed`). Les PV de départ sont les suivants, avec la cadence obtenue :
  - courtine : 120 PV, 3 coups de catapulte ;
  - porte : 60 PV, 2 coups de bélier ;
  - herse : 30 PV, 3 coups de bélier.
- **Carte.** La porterie est maçonnée jusqu'aux deux tours (le passage de 1 m qui longeait la porte est fermé). La montée au château est regradée en rampe d'au plus 0,2 (`rampAlong`) : les engins grimpent jusqu'à 0,3. Les engins attendent dans un parc de siège, sur la route à 62 m de la porte : hors de portée des archers de tour, avec trois segments à portée de catapulte. Le treuilliste est l'archer d'une tour de porte.
- **IA.** Les engins pèsent les coups contre les ouvrages : dégâts attendus, plus la chance d'en abattre un. Le bélier s'approche de la porte exposée et attend au parc tant qu'aucune ne l'est. Le treuilliste garde son poste. Les champs d'approche (`computeCostField`) s'arrêtent dès que nos unités et leur marge de déplacement sont couvertes. Des composantes connexes, en cache par grille, écartent les unités qu'aucun ennemi ne peut atteindre. Tours d'IA : 0,05 à 0,35 s pour la défense, 0,12 à 0,75 s pour l'attaque (contre 0,6 à 0,9 s sans arrêt anticipé), décisions inchangées (même empreinte de rejeu).
- **Restent pour J5** : l'IA attaquante ne vise pas encore le treuilliste ; le déploiement à 300 m du château impose une longue marche.

## ADR-025 — Rendu du siège (J4)
**Décision** :
- **Une poignée pour le château.** `Castle` expose une `CastleHandle` (`hit`, `bringDown`, `anchorOf`) que `BattleDirector` appelle sur les événements `structureDamaged` et `structureBroken`, comme pour les unités. Ni état React par image ni allocation dans `useFrame` (hors un vecteur à l'atterrissage d'un pont). L'état initial des ouvrages (`siege`) est lu une fois au montage.
- **Brèche.** La maçonnerie reste un seul maillage. Tours, donjon, linteaux et ponts sont fusionnés une fois, puis refusionnés avec les courtines à chaque effondrement : quelques dizaines de millisecondes, masquées par la poussière. Le segment tombé laisse des moignons en escalier. Ses blocs pré-fracturés (`planCollapse`, déterministes) tombent en `InstancedMesh` puis restent en tas. Le tas reste sous 0,7 m au-dessus de la brèche, là où les unités passent, et s'entasse sur les côtés.
- **Fissures et poussière.** Les fissures sont des bandes peintes sur la face extérieure : elles se ramifient à mesure que les PV baissent et utilisent le matériau du bois (aucun programme de plus). La poussière est une réserve de 192 sprites (un appel). Fissures, poussière et un lot de gravats vide sont dans la scène dès le chargement, avec une plage de dessin nulle : leurs programmes sont compilés derrière l'écran de chargement et ne coûtent aucun appel au repos.
- **Porterie.** Les portes, la herse et la travée levante pivotent sur leurs charnières, dans le repère de la porte. Les portes et la herse tombent à plat dans le passage. Le pont levé ferme l'ouverture et tombe en 2,2 s avec un rebond. Portes et herse ne projettent pas d'ombre, puisqu'elles sont à l'ombre de la porterie.
- **Engins.** Le bélier et la catapulte sont produits par `scripts/blender/build_siege_engines.py` : poutres, planches, roues à rayons, cordes, couleurs de sommet de la palette du bois du château. Chaque engin est **un maillage skinné** dont chaque pièce est liée rigidement à un os (bras, bélier, roues), soit un appel par engin au lieu de six. Les animations sont en code : roues au roulage (1,4 m/s), bras jusqu'à la butée puis rembobiné, bélier tiré puis lancé, secousse, épave couchée.
- **Visée.** Avec un engin sélectionné, l'ouvrage sous le pointeur est résolu par le point de sol, qui suit les chemins de ronde : une face de mur désigne son segment, le pont-levis passe en dernier, la herse dès que la porte est tombée. L'aperçu et le clic passent par `previewStructureAttack` et la commande `attackStructure`.
- **Cônes de garde.** Les morceaux qui enjambent un bord de tablier sont omis : plus de voiles rouges pendus aux murs.
- **Mesure.** Sur la vue d'ensemble du bench de bataille, on était à 169 appels avec des engins en six maillages et des courtines à part ; le budget de moins de 150 appels est revenu après ces corrections (test e2e `battle.spec`).

## ADR-026 — Travaux de sape : fascines et sape (J4)
**Décision** :
- **Le chantier porte la progression, pas le sapeur.** L'état de bataille (version 4) a une liste `works` (`id`, tours faits, terminé). Un autre sapeur peut reprendre un chantier, et un sapeur tué n'efface pas le travail fait. Un tour de travail prend tout le tour du sapeur (PA et action) et lui fait perdre sa garde : il reste exposé là où il creuse.
- **Fascines** (`fillMoat`, 2 tours). La douve est découpée en tranches de 4 m le long de son axe (`battle/moat.ts`). Une tranche couvre tout le fossé, berges comprises : les cellules à moins de demi-largeur + 2,5 m de l'axe et sous le seuil moins 0,25 m. Une fois comblée, elle devient une chaussée de la couche `Fascine` (praticable par tous, engins compris, inflammable), un tablier 0,3 m sous le seuil. Comme les ouvrages tombés, elle entre dans la signature de la grille de navigation : `syncNav(ctx, structures, works)`, une grille en cache par combinaison.
- **Sape** (`undermine`, 3 tours). Au pied d'un segment de courtine ; le segment s'effondre ensuite comme une brèche (`bringDown`) : chute des unités du chemin de ronde, moral, tas de gravats, crédité au sapeur.
- **Commandes.** La touche **F** comble la tranche de douve, ou sape la courtine, sous le pointeur. Le clic garde le déplacement, ce qui laisse le sapeur traverser la douve à la nage, et l'ordre reste explicite, comme la garde (**G**). Rejets propres : `noSiegeSkill`, `notAMoat`, `workDone`, `notAWall`.
- **Rendu.** Les fascines sont des bottes de branchages en instances, qui montent du fond du fossé jusqu'à la chaussée au fil des tours. Au pied du mur, un abri de planches et un tas de déblais grandissent avec la sape ; l'abri disparaît avec le mur. Un lot vide de bottes est compilé dès le chargement.
- **Parc de siège.** Le sapeur de l'armée attend avec les engins sur la route, à 62 m de la porte, au lieu de marcher 300 m depuis la zone de déploiement.
- **Capture** : `scripts/capture-works.ts` joue le chantier par de vraies commandes, sur des cibles calculées à partir de la même graine. La garnison y passe ses tours : on capture les travaux, pas les chances du sapeur sous les murs, où il meurt en trois tours face aux arbalétriers.

## ADR-027 — Tour de siège (J4)
**Décision** :
- **Une commande plutôt qu'un faux escalier.** Une tour (étiquette `transport4`) à moins de 2,5 m d'un segment de courtine intact s'y amarre (`dockTower`, son action), en passant par la douve comblée ou par la berme après le pont-levis. Une unité à pied au pied de la tour y monte (`climbTower`, 2 PA) et arrive sur la cellule libre du chemin de ronde la plus proche. La tour porte au plus 4 unités par tour, comme le brief. Une tour amarrée ne bouge plus. L'amarrage est rompu si le segment tombe ou si la tour est détruite (`releaseDocks`, après chaque commande). L'état (version 5) porte une liste `docks`.
- **Rendu.** Trois étages sur quatre roues, bardés de planches et de peaux devant et sur les côtés, ouverts derrière sur leurs échelles. La passerelle a son propre os : relevée au roulage, elle s'abat à l'amarrage. Un maillage skinné, un appel. Une montée se joue en trois temps : marche jusqu'au pied, ascension dans la tour, pas sur le chemin de ronde. La touche **F** amarre la tour sélectionnée au mur sous le pointeur, ou fait monter l'unité sélectionnée dans la tour amarrée voisine.
- **Parc de siège** : deux rangs de deux le long de la route, bélier et catapulte devant, sapeur et tour derrière.
- **À reprendre (J5/J7)** : à 2 PA par tour, la tour met environ 17 tours à aller du parc à un segment éloigné de la porte (capture `capture-works.ts --tower`). Il faudra régler la vitesse des engins ou leurs positions de départ. La plate-forme est à 10,4 m : juste pour les courtines de 10 m du premier château, trop basse pour les suivants.

## ADR-028 — Feu (J4)
**Décision** :
- **Ce qui brûle et combien de temps.** Les couches inflammables : champs et haies (végétation, 2 rounds), ponts, fascines et maisons (bois, 3 rounds). S'y ajoutent les ouvrages de bois intacts, porte et pont-levis, quelle que soit la couche sous eux. Une cellule brûlée ne reprend plus. L'état (version 6) porte le vent (tiré de la graine), les foyers (cellule, rounds restants) et les cellules brûlées.
- **Un round de feu** (`fireRound`) à chaque nouveau round, avant le tour des assaillants :
  - chaque foyer brûle les unités sur sa cellule (5) et à 1,6 m ou moins (2), multiplié par la table du brief pour le feu (le bois des engins ×2,5), avec −6 de moral ;
  - il ronge la porte (12 PV par round) ;
  - il peut gagner chaque voisin inflammable, sur le flux de la bataille, avec une chance de 0,3 relevée sous le vent (+0,5 × force), plafonnée à 0,85 et divisée par √2 en diagonale ;
  - puis il perd un round de combustible.
- **« Incendier le pont »** (brief §9.8). Quand le feu s'éteint sur ses madriers, le pont-levis brûlé tombe sur la douve, comme à la mort du treuilliste.
- **Commandes.**
  - **B** : flèche enflammée sous le pointeur. Archers (`fireArrows`), +1 PA, à portée et en vue. La flèche vise le haut de ce qui doit brûler (épis, haie, toit) : visée au ras du sol, les épis eux-mêmes masquaient la cible. Chance de prendre : précision ± hauteur − feuillage.
  - **E** : une unité éteint le foyer sous le pointeur et ses voisins, depuis 1,6 m (son action).
- **Rendu peint, sans lumière dynamique.** Les flammes sont des quads face à la caméra, dessinés en procédural dans le shader (bruit montant, rampe du rouge au jaune, bord déchiré). Une lueur additive au sol, des colonnes de fumée (réserve de 256 sprites) et des brûlures au sol complètent : trois appels au plus, aucun au repos, programmes compilés au chargement. Le brief borne les lumières dynamiques à quatre et prévoit la lueur peinte en repli. On garde ce repli : chaque lumière ajouterait une variante de programme et un coût par fragment sur toute la scène.
- **À reprendre (J5/J7)** : la pluie (J5, météo) ; l'IA qui éteint les feux et incendie les champs (J5) ; les épis encore debout sur les cellules brûlées (les brûlures passent dessous) ; des flammes plus nombreuses au plan large.

## ADR-029 — Une bataille de bout en bout : victoire, renforts, avant-garde (J5)
**Contexte** : le brief ne fixe pas de condition de victoire. Jusqu'en J4, une bataille ne finissait qu'à l'anéantissement d'un camp, et l'armée partait à 300 m du château, soit une dizaine de tours de marche avant le premier contact.
**Décision** :
- **Victoire des assaillants** : la garnison est anéantie, ou elle se débande, c'est-à-dire que tous ses survivants fuient au début de son tour.
- **Victoire des défenseurs** : l'armée est anéantie ou se débande, ou bien les renforts arrivent. Passé `turnLimit` rounds (30 par défaut, `damage.json` → `battle`, ou fixé par le scénario), le siège est levé. L'état (version 7) porte `turnLimit`, et l'événement `battleEnded` donne sa raison (`eliminated`, `routed`, `relieved`).
- **Avant-garde à la tête de pont.** Les sept hommes de l'armée partent en deux rangs en travers de la route, 16 m au-dessus du pont, du côté du château, soit environ 160 m de la porte sur `siege-1`. L'avant-poste du village est 50 m plus loin, et les engins attendent au parc de siège. La bande du sud reste dégagée de forêt : le paysage ne change pas.
- **Interface.** La bannière affiche « Tour N / limite ». Fin du tour : si des unités peuvent encore agir, le premier appui, sur le bouton ou sur Entrée, arme l'avertissement (« N unités peuvent encore agir : confirmer ? »), et le second termine le tour ; tout ordre donné entre-temps désarme l'avertissement. Le panneau de fin donne le résultat et sa raison, les tours joués, les pertes de chaque camp et les ouvrages tombés, avec « Rejouer » et « Retour ».

## ADR-030 — Tactiques de siège de l'IA (J5)
**Contexte** : le brief (§9.6) demande une garnison qui sort contre un engin isolé, se replie sur la cour quand une brèche est ouverte, éteint les feux et incendie volontairement les champs. En J4, l'IA ne savait que s'approcher, frapper et monter la garde. Côté attaquants, que pilote le joueur, l'IA restait bloquée devant la douve : les simulations (équilibrage J7) ne disaient donc rien de la défense.
**Décision** (`core/ai/tactics.ts`, branché dans `decideUnit`) :
- **Feu, évalué depuis la case où se tient l'unité** :
  - On éteint un foyer à portée selon les alliés à moins de 4 m, avec un gros bonus quand il ronge notre bois : la porte et le pont pour la garnison, les fascines pour l'armée.
  - Les flèches enflammées visent les cases combustibles autour de chaque ennemi à portée, jusqu'à 3 par ennemi, vent arrière d'abord. La valeur est l'espérance de réussite × (ennemis − alliés dans 2,6 m), avec un bonus pour le pont-levis levé et la porte côté attaquants.
  - Les archers de tour reçoivent l'étiquette `fireArrows`.
- **Repli sur la brèche** : pour la garnison, une case située à l'intérieur de l'enceinte (plus près du centre que la brèche) gagne jusqu'à 7 points à moins de 12 m d'une courtine tombée.
- **Sortie** : un engin ennemi sans escorte à moins de 10 m attire la garnison à 45 m, au lieu des 25 m habituels.
- **Objectifs des attaquants** :
  - Tant que la garnison est hors d'atteinte, le champ d'approche ajoute comme origines les cases au sol entre 6 et 16 m de l'obstacle exposé de la porterie, c'est-à-dire le pied de la porte ; le tablier, où passe le bélier, en est exclu.
  - Chaque engin a son propre champ : le bélier vise la porte exposée, le sapeur la chaussée à combler, la tour une courtine intacte.
  - La chaussée est voulue devant une brèche que la douve protège encore, ou devant la courtine la plus proche d'une tour qui n'est pas encore accostée.
  - Le bélier et la tour restent en retrait tant que leur objectif est hors d'atteinte. La tour accostée reste en place, et l'infanterie vient y grimper.
  - L'approche d'un objectif vaut 10 points par PA gagné, au lieu de 3. Le PA d'un engin couvre 5 à 7 m, et l'objectif justifie l'exposition.
**Conséquences** : les poids sont dans `TACTIC_WEIGHTS` et `AI_WEIGHTS`, réglés en J7 par des batailles simulées. Le replay reste identique. Un tour d'IA de l'armée prend 250 ms au premier tour, puis 20 à 150 ms ; la garnison prend 5 à 170 ms. Pas encore traité : la mine du sapeur, la sortie par la porte quand elle est fermée, et la coordination sapeur + tour au-delà d'une chaussée.

## ADR-031 — Météo et moment de la journée dans le core (J5)
**Contexte** : le brief (§9.11) demande une heure de départ tirée au sort qui avance à chaque tour, et quatre effets : la pluie (feu affaibli, −10 % de précision, boue), le brouillard (vision réduite, brouillard de guerre local), la nuit (portée −30 %, torches) et le vent (déviation de l'artillerie). La formule de combat (§9.7) prévoit des malus de météo et de nuit.
**Décision** (`core/battle/conditions.ts`, réglages dans `damage.json` → `weather`) :
- **État (version 8)** : il porte `weather` (`clear`, `rain` ou `fog`) et `startHour`. L'heure d'un round vaut `startHour + (tour − 1) × 20 min`.
  - En partie, `BattleSession` tire météo et heure de la graine (sous-flux `weather`, de 6 h à 17 h au quart d'heure) et les écrit dans le scénario, que le replay rejoue tels quels.
  - Un scénario qui ne les fixe pas se joue par temps clair à midi, ce qui garde les tests déterministes.
- **Chaque tir** (attaque, tir de réaction, frappe d'engin, flèche enflammée) passe par `shotConditions`. Elle renvoie un bonus de précision, un facteur de portée, une portée maximale et la liste des modificateurs, que l'aperçu expose (`preview.conditions`) pour l'infobulle.
  - **Pluie** : −0,10.
  - **Nuit**, de 20 h 30 à 5 h 30 : portée × 0,7 et −0,10, sauf si la cible est à moins de 9 m d'une torche. Les torches sont placées aux portes, tours et donjons, et à chaque maison du village (`lightsOf`).
  - **Brouillard** : portée plafonnée à 30 m.
  - **Vent de travers sur l'artillerie** : −0,15 × force × |sin|.
- **Feu sous la pluie** : chance d'embrasement × 0,5, durée × 0,5 (1 tour au moins), propagation × 0,3.
- **Boue** :
  - Sous la pluie, la plaine, la route et les champs coûtent plus de PA par mètre : × 1,2 à pied léger, × 1,25 à pied, × 1,4 à cheval, × 1,5 pour les engins.
  - La grille de navigation est construite avec des règles dérivées (`rulesOnGround`). Le contexte porte `ground`, fixé par `createBattle` via `setGround`, et la clé du cache de grilles le préfixe (`mud#…`) ; sur sol sec, la clé est inchangée.
  - `edgeCost` et `segmentCost` restent un seul et même métrique.
- **Brouillard de guerre** : chaque camp ne connaît que les ennemis à moins de 30 m de l'un de ses hommes. L'IA décide sur cet état perçu (`perceivedState`), et ses ordres se jouent sur l'état réel : elle ne triche pas (§9.6).
  - Sans ennemi en vue, les assaillants marchent quand même vers la porterie et leurs objectifs, et les défenseurs tiennent leurs postes.
**Conséquences** : le rendu (lumière, ciel et LUT interpolés selon l'heure, pluie, brouillard, torches) et le HUD (heure, météo, vent, modificateurs dans l'aperçu) lisent ces champs. Le brouillard de guerre côté joueur masque les ennemis qu'il ne voit pas. Pas encore traité : la météo qui change en cours de bataille.

## ADR-032 — Héros (J5)
**Contexte** : le brief (§9.5) demande trois héros nommés (une capitaine d'archers, un maître ingénieur, un chevalier vétéran), chacun avec 2 capacités actives à temps de recharge et 1 passive, des répliques en combat, et une blessure grave à 0 PV au lieu de la mort.
**Décision** :
- **Données** :
  - Les héros sont des types d'unités de `units.json`, marqués de l'étiquette `hero`.
  - `heroes.json` décrit pour chacun ses capacités, sa passive, ses répliques et sa personnalité. Le comportement d'une capacité est fixé par son identifiant dans le code ; ses chiffres sont des données validées au chargement.
- **Aude** : *Volée* (elle et les tireurs à moins de 12 m : +15 % jusqu'à la fin du tour, recharge 3), *Flèche perçante* (ignore le couvert et l'armure, recharge 2), passive *Œil d'aigle* (+5 % pour les tireurs à moins de 10 m).
- **Bertrand** : *Réglage du tir* (un engin à moins de 6 m : +20 % et insensible au vent, recharge 2), *Chantier forcé* (un tour de travail compte double, recharge 3), passive *Maître d'œuvre* (+10 % pour les engins à moins de 10 m).
- **Guillaume** : *Ralliement* (+30 de moral à moins de 12 m, recharge 3), *Charge héroïque* (+10 %, ×1,5 dégâts, sans riposte, recharge 3), passive *Inébranlable* (pertes de moral divisées par deux à moins de 8 m).
- **Mécanique** :
  - Une seule commande `ability` (`targetId`, `at` ou `structureId` selon la capacité). L'aperçu et la résolution partagent les vérifications.
  - Les coups de héros passent par `previewAttack` et ses options (`ignoreCover`, `armorPierce`, `accuracyBonus`, `damageFactor`, `noRiposte`, `extraAp`).
  - L'état (version 9) porte les recharges par unité, décomptées au début du tour du camp, et des *buffs* qui expirent à la fin de son tour.
  - Les buffs et les auras de précision s'ajoutent aux modificateurs de tir (`shotConditions`, type `hero`) et apparaissent dans l'aperçu. L'aura *Inébranlable* passe par la fonction centrale du moral (et par celui du feu).
  - Les auras vivent dans un module léger (`hero-auras.ts`) et les étiquettes partagées dans `tags.ts`, pour éviter les imports circulaires.
- **Blessure grave** : un héros à 0 PV quitte la bataille. Le journal dit « gravement blessé(e) » avec l'une de ses répliques ; le report sur la bataille suivante viendra avec la campagne (J6).
- **Répliques** : à chaque capacité, victoire en combat et blessure, choisies selon le tour (identiques au replay).
- **Placement** : les héros rejoignent l'armée sur les cases libres les plus proches de son centre, dans le scénario de la session. Les tests de génération ne changent pas.
- **IA** : la garnison vise les héros en priorité (×1,5). L'IA des assaillants (simulations) n'utilise pas encore leurs capacités.

## ADR-033 — Audio de base (J5)
**Contexte** : le brief (§11) demande :
- une musique en couches dynamiques (calme, tension, bataille) avec fondus enchaînés ;
- des effets spatialisés : pas selon le terrain, arcs, impacts, pont-levis, bélier, effondrements, feu, pluie, vent ;
- des ambiances de jour et de nuit ;
- des sources CC0 ou CC-BY créditées.

L'asset-scout a retenu 107 fichiers CC0, de formats et de niveaux hétérogènes : des WAV à 192 kHz en 24 bits, une FLAC, des OGG et des MP3. La machine n'a pas ffmpeg.
**Décision** :
- **Chaîne de traitement** (`npm run assets:audio`) :
  - Blender, en mode headless, sert d'encodeur : son module audaspace (`aud`) décode, rééchantillonne et encode en Ogg Vorbis. Aucun nouvel outil n'est installé.
  - `scripts/audio-manifest.json` liste chaque son du jeu, ses variantes et leur traitement : début, durée maximale avec coupe du silence et fondu, vitesse, correction de gain.
  - Le niveau est ramené à une cible RMS par catégorie (effets −16 dB, interface −20, ambiances −24, musique −18), sous un plafond crête de −1 dB.
  - Sortie à 44,1 kHz : effets en mono, ambiances et musique en stéréo. Au total, 41 sons et 93 variantes pour 7,7 Mio dans `public/assets/audio`, plus un manifeste d'exécution (`src/audio/audio-manifest.json`).
- **Moteur** (`src/audio/engine.ts`, sur Howler, choix du brief) :
  - Il joue des sons ponctuels avec variantes et une petite variation de hauteur.
  - Il les place en 2,5D par rapport au foyer de la caméra : atténuation au-delà d'un rayon qui grandit avec le recul, panoramique selon la droite de la caméra. C'est plus simple et plus lisible que l'audio 3D de Three pour une vue tactique.
  - Il gère des boucles nommées qui s'enchaînent en fondu.
  - Le chargement se fait après la scène et ne la bloque jamais ; le son est coupé par la touche M.
- **Paysage sonore** (`BattleSoundscape`) :
  - Ambiances : oiseaux et vent le jour, grillons la nuit (selon l'heure de la bataille), pluie, vent selon sa force, feux et eau près du foyer.
  - Musique : couche *bataille* si des coups sont tombés ce round ou le précédent, *tension* si un ennemi est à moins de 60 m de l'un de nos hommes, *calme* sinon. Fondu enchaîné de 3,5 s.
- **Effets** (`BattleDirector`), joués au moment de l'image :
  - décoche et impact selon l'armure (chair, métal, bois), lame ou masse ;
  - relâche de catapulte, boulet contre la pierre, bélier ;
  - effondrement puis gravats ; pont-levis : chaîne puis choc à la fin de sa chute ;
  - sape, embrasement, éclaboussure ;
  - pas selon le sol (herbe, chemin, bois, pierre des chemins de ronde) et roulement des engins ;
  - cor au tour du joueur, cloche à celui de l'adversaire ; clics d'interface.
**Conséquences** :
- Les affectations ont été faites d'après les noms de fichiers ; personne n'a encore écouté. Elles sont à valider à l'oreille (retours du ⛳ J5).
- Les boucles de musique ne sont pas sans couture : les versions « Loop » pèsent 10 Mo, à reprendre en J7.
- Il manque des sons dédiés de catapulte et de bélier : ce sont des sons génériques ralentis.

## ADR-034 — Allègement après le ⛳ J5 : barre d'actions, rythme, engins (J5+)
**Contexte** : retour du ⛳ J5 : « améliore tout, la qualité, les performances et le jeu, il faut qu'il soit un peu plus simple, plus léger ». Les actions autres que se déplacer et attaquer passaient par des touches cachées (G, B, E, F, 1, 2) qui agissaient sans aperçu sous le pointeur. Une bataille durait 30 tours, et les engins mettaient une quinzaine de tours à atteindre les murs. Le tour adverse se regardait en entier, à vitesse réelle.
**Décision** :
- **Barre d'actions** (`ui/battle/actions.ts`) sur la carte de l'unité sélectionnée. Chaque action disponible est un bouton qui porte sa touche, son coût ou sa recharge et une infobulle : Garde, Flèche enflammée, Éteindre (seulement près d'un feu), Combler ou saper, Amarrer, Monter, et les deux capacités d'un héros.
  - Une action sans visée (amarrer la tour à la courtine voisine, monter dans une tour accostée, Volée, Ralliement) part tout de suite.
  - Les autres s'arment : le pointeur montre l'aperçu (chance que la flèche prenne, foyers éteints, avancée du chantier, cible d'une capacité), un clic donne l'ordre, Échap annule.
  - L'aperçu interroge les règles : pour les ordres sans aperçu propre, la commande est appliquée à blanc, puis la grille de navigation est resynchronisée.
  - La ligne d'aide devient « Clic : se déplacer, attaquer · Tab · Échap ».
- **Tour adverse plus rapide** : ses événements se jouent ×1,8, et un déplacement qui ne passe pas dans le champ de la caméra ×12.
- **Rythme** : les engins (bélier, catapulte, tour) passent de 2 à 3 PA, contre 2 dans le brief (§9.4). La limite passe de 30 à 24 tours. Dans les simulations, la première brèche tombe au tour 5 au lieu de 6 à 9.
- **Cercles d'allégeance** inclinés selon le terrain : ils s'enfonçaient dans les pentes.
**Conséquences** : l'écart au brief (PA des engins) est un choix de rythme, à reconfirmer à l'équilibrage J7.

## ADR-035 — Une image et un chargement plus légers (J5+)
**Contexte** : après le ⛳ J5, il faut un jeu plus léger. Une image de bataille comptait environ 80 appels de dessin pour l'image et 55 pour la passe d'ombres. Quinze effets vides (feu éteint, projectiles, torches de jour, cônes) passaient quand même par le moteur. Le chargement laissait le thread principal bloqué environ 1,7 s après la carte. Les mesures sur batterie (iGPU bridé) ne sont pas comparables aux anciennes.
**Décision** :
- **Effets vides masqués** (`render/drawable.ts`) une fois les programmes précompilés derrière l'écran de chargement. Avant, ils restent visibles pour que `compileAsync` les voie.
- **Passe d'ombres redessinée seulement si nécessaire** : quand sa boîte bouge ou que la lumière change, sinon une image sur deux. Sous la pluie, plus d'ombre portée du tout (`uCastShadow` = 0, aucune passe). On garde `castShadow`, dont le changement recompilerait tous les programmes.
- **Chargement** :
  - les pièces du kit sont désindexées une seule fois ;
  - les tronçons de rivière sont rangés en cases de 64 m pour le paysage lointain ;
  - les nuages sont calculés une fois par page ;
  - la recoloration d'équipe est mise en cache par couleur ;
  - Howler n'est importé qu'au premier clic ou à la première touche ;
  - les modèles de personnages sont préchargés.
- **Kit du village simplifié** par meshopt (erreur 0,3 %, bords verrouillés) : 22,9 k → 15,2 k triangles.
- **Mesures** : sur batterie, comparer en A/B alterné (`git stash`, puis bench, puis `pop`, puis bench, deux tours). `--query live` mesure une bataille en cours ; `?nosound` coupe le paysage sonore.
**Conséquences** :
- Chargement en production : 5,5 → 4,7 s à chaud, 7,2 → 6,7 s à froid. À froid, la compilation des 42 programmes (≈ 2,2 s) domine ; Chrome la met ensuite en cache.
- A/B en bataille sur batterie : 50 à 56 → 57 à 58 fps.
- Restent des blocages GPU ponctuels (1 % bas) : aucune tâche longue en JavaScript ni aucun programme compilé en cours de jeu, cause à chercher secteur branché.

## ADR-036 — Campagne du Val d'Orle : bataille d'essai, cinq châteaux, conseil de guerre (J6)
**Contexte** : demande de l'utilisateur pour J6 : « commence la campagne, 5 niveaux faciles avec une interface créative de choix ; d'abord une bataille d'essai, toujours la même, qui explique le jeu en détail ; le bouton Campagne qui mène au choix, et les options ». Le brief (§9.1, §9.13) prévoit 4 châteaux, un tutoriel intégré au premier, et une méta lourde : recrutement, forge, XP, arbre technologique. Le retour du ⛳ J5 demandait un jeu plus simple.
**Décision** :
- **Cinq châteaux faciles** au lieu de quatre, à la demande de l'utilisateur. Ils sont décrits dans `src/data/campaign.json`, validé au chargement par `core/campaign/validate.ts` contre les règles :
  - Roche-Grise, Moulins-sur-Orle, Brumefond (brouillard), Pierre-Ardente (crépuscule), Haute-Garde (château 3) ;
  - la difficulté monte de 1 à 5 par la taille de la garnison, l'heure, la météo et le château ;
  - un récit : le Félon a pris les cinq châteaux de la comtesse Isabeau.
- **Bataille d'essai à part**, toujours la même : graine, heure, météo et garnison fixes, 30 tours. Les 15 leçons de Guillaume (`ui/tutorial/`) se cochent quand le joueur agit (caméra, sélection, déplacement, attaque, garde, fin de tour, capacité, pont-levis, bélier, catapulte, travaux). Chaque leçon peut porter la caméra sur ce dont elle parle et illuminer la partie du HUD qu'elle nomme. On peut la passer, la relire ou la masquer.
- **Le choix créatif est le conseil de guerre**, qui remplace recrutement, forge, XP et arbre technologique (reportés, peut-être abandonnés).
  - À chaque château, chacun des trois héros propose un stratagème dans sa voix : Aude la ruse, Bertrand les ouvrages (qui coûtent du temps), Guillaume le fer et le moral.
  - Le joueur en scelle un sur le plan des éclaireurs : la vraie carte de la bataille, à l'encre sépia. Ce que le plan change y est marqué : absents barrés, renforts cerclés d'or, ouvrages entamés en rouge.
  - Les effets (`BattleEffects`) s'écrivent dans le `Scenario`, donc la bataille se rejoue à l'identique : garnison réduite, renforts, ouvrage de chaque sorte le plus proche entamé ou abattu, tronçon de douve déjà comblé face au mur le plus proche de la tour, heure, météo, délai, moral par camp.
  - Bornes : le délai ne descend pas sous 8 tours ; aucun camp ne part ébranlé ; le treuilliste n'est jamais retiré.
- **Persistance légère** (`state/campaign.ts`, localStorage) : châteaux pris, meilleurs étendards (pris ; pris avant les deux tiers du délai ; au plus 3 pertes), bataille d'essai faite. Un héros gravement blessé manque la bataille suivante (§9.5) : sa lettre au conseil est grisée.
- **Core** : le `Scenario` accepte `morale` par camp, `structures` (état de départ des ouvrages) et `filled` (chaussées posées). `createBattle` les valide (`ScenarioError`) et resynchronise la navigation.
- **Écrans** :
  - menu dans l'ordre Bataille d'essai, Campagne, Escarmouche (carte au hasard), Options ; l'atelier du peintre passe dans les Options ;
  - carte de campagne en SVG : le paysage est peint une fois sur sa propre couche, les drapeaux et la route animés au-dessus ;
  - chronique de fin de bataille : récit du château, étendards, mot d'un héros, blessés.
- **Options** (`state/settings.ts`, localStorage) :
  - qualité, taille du texte en bataille, son (général, musique, effets, ambiances) ;
  - vitesse des animations (×1, ×2, instantané) ;
  - confirmation de fin de tour, conseils en bataille ;
  - défilement aux bords et vitesse de la caméra ;
  - liste des commandes, effacement de la campagne.
- **La carte du conseil sert à la bataille** : elle est gardée (`ui/campaign/battle-map.ts`), et la bataille ne la régénère pas.
- **Graines validées** par `scripts/campaign-scout.ts` (carte, approches, chaque plan) et par le test `campaign-maps`. En simulation IA contre IA, l'IA assaillante ouvre deux à sept ouvrages mais ne finit jamais la garnison avant le délai. C'est la faiblesse de l'IA en fin d'assaut, pas une mesure de la difficulté pour un joueur (corrigé par la capitulation, ADR-037).
**Conséquences** :
- Écarts au brief : cinq châteaux au lieu de quatre, tutoriel séparé, pas de recrutement, de forge, d'XP ni d'arbre technologique. Les cartes du générateur se ressemblent (butte au nord, rivière au sud) : les châteaux se distinguent par l'heure, la météo, la garnison et les plans.
- L'équilibrage fin des stratagèmes et de la difficulté revient à J7.

## ADR-037 — Passe de polish J7 : capitulation, plan d'ouverture, écus, écran-titre rendu par le jeu
**Contexte** : demande de l'utilisateur après J6 : « améliore encore, pas de nouvelles features, sois créatif et efficace pour améliorer tous les aspects ». Constats de départ :
- en simulation IA contre IA, l'assaut échouait 16 fois sur 16 : la garnison tombait à un ou deux hommes, mais le dernier, sur un chemin de ronde, tenait jusqu'au délai ;
- le briefing promettait « mettez-la en fuite », alors que seule la mort finissait une bataille ;
- le plan d'ouverture montrait trois unités entre deux maisons, ni l'armée ni le château ;
- treize types d'unités sur trois corps, et des anneaux d'engins lus comme des flaques ;
- un écran-titre plat, très en deçà du rendu 3D, et un menu au texte déformé par le filtre parchemin ;
- la touche E qui à la fois pivote la caméra et éteint un feu.
**Décision** :
- **Fin de bataille** (`core/battle/combat.ts`) :
  - un camp sans homme debout (mort ou en fuite) a perdu après n'importe quel coup, comme le promet le briefing ;
  - la garnison **capitule** quand ses hommes debout tombent à `floor(hommes × damage.battle.garrisonSurrenderShare)` (0,3, avec une marge d'arrondi : 0,3 × 10 vaut 3,000…04) ; une garnison de moins de quatre hommes se bat jusqu'au bout ; les assaillants, eux, ne capitulent pas ;
  - l'événement `battleEnded` distingue `eliminated`, `routed` et `surrendered`.
- **Équilibrage par simulations** (`scripts/campaign-scout.ts --sim`) : l'IA assaillante gagne 11 assauts sur 16. Pierre-Ardente, seul château à 0 sur 3 (la nuit tombe au huitième tour), perd un archer de tour et gagne deux tours (2 sur 3, comme Haute-Garde). Résultat par château, du fortin au dernier : 1/1, 3/3, 2/3, 2/3, 2/3, 2/3.
- **Lisibilité de la règle** :
  - une pastille « Garnison N · se rend à M » dans le bandeau de tour ;
  - la ligne de reddition dans le briefing, dans la première leçon et dans la légende du plan des éclaireurs, plan par plan ;
  - à la fin, le cor (ou le glas) sonne, et les perdants restants affichent « Se rend » ou « Fuit ! » ; le panneau de fin attend la fin de l'animation.
- **Plan d'ouverture** (`render/camera/TacticalCamera.tsx`, `render/battle/views.ts`) :
  - la caméra tient 1,6 s sur le château vu du côté de l'armée, puis glisse en 3,2 s (smootherstep) vers le gros de l'armée (le groupe le plus dense, avancé de 10 m vers le château) ;
  - le briefing s'affiche ensuite ; une touche, la molette ou un clic coupe le plan ;
  - il est sauté en test (`?e2e`, `?fast`), avec les animations instantanées et sous `prefers-reduced-motion`.
- **Tour adverse** : un coup ennemi porté hors champ sur une de nos unités y amène la caméra ; ses marches hors champ restent instantanées.
- **Écus** (`render/units/shield.ts`) : écu à talon construit par le code, colorié aux sommets sous un seul matériau peint, porté sur l'os du poing gauche des soldats et des gardes de rempart. Il porte le chevron d'or sur azur de la comtesse, ou la fasce de fer sur gueules du Félon. Coût mesuré : 4 appels de dessin.
- **Anneaux** : au-delà de la taille maximale d'un anneau de soldat (un engin), la bande s'affine et le trait se calme.
- **Écran-titre rendu par le jeu** (`scripts/capture-title.ts`) :
  - Haute-Garde à 16 h 24, l'armée et sa tour de siège dans le village, sans interface ;
  - WebP de 2400 px (121 Ko), animé d'une lente dérive ; il sert aussi de fond, assombri, aux options ;
  - le menu passe sur `.parchment-sheet` (le filtre ne déforme plus le texte) ; `PaintedBackdrop` et la règle `.parchment` sont supprimés.
- **Carte de campagne** :
  - les châteaux pris portent un sceau de cire pendant, à la fleur de lys de la comtesse, au lieu d'une coche ;
  - la lettre présente les trois compagnons (caractère, talent, repos).
- **Divers** :
  - quinze conseils des héros pendant le chargement, dont les chiffres sont lus dans les règles ;
  - les touches de la caméra sont nommées d'après le clavier du joueur (API Keyboard, AZERTY par défaut) ;
  - Éteindre passe sur **X**.
**Conséquences** :
- La capitulation est une règle nouvelle, au service de la promesse du briefing et de la demande « plus simple » (ADR-036) : plus de chasse au dernier défenseur. Elle se règle d'un nombre dans `damage.json`.
- Performance (A/B sur secteur contre le commit d'avant la passe) : 103,2 contre 99,6 i/s en moyenne, 114 contre 110 appels, chargement de 4,3 contre 5,0 s. Le 1 % bas est faible ce jour-là sur les deux versions (environ 24 i/s) : c'est l'état de la machine, pas le code.
- Restent : des cartes qui se ressemblent (butte au nord, rivière au sud) ; pas de cheval pour la cavalerie (elle a un corps de chevalier) ; l'arbalétrier porte l'arc du ranger.

## ADR-038 — Un jeu pour un connaisseur, des sauvegardes sûres, un site public protégé
**Contexte** : le jeu est en ligne, et son dépôt GitHub est public. L'utilisateur précise le joueur visé : un homme d'une soixantaine d'années, passionné et connaisseur du Moyen Âge. Il demande des textes et une logique fidèles à l'histoire, une attention à la sécurité, une progression bien enregistrée, et des bonnes pratiques partout. Constats de départ :
- les textes mêlaient jargon de jeu vidéo (PV, PA, critique, recharge) et anachronismes (tour de siège, catapulte, sapeur, officier, infanterie, amarrer) ;
- une bataille en cours se perdait à la fermeture de la page ;
- la progression était relue sans contrôle des fiches de château, et deux onglets pouvaient s'effacer l'un l'autre ;
- le site n'envoyait aucun en-tête de sécurité ;
- les points d'accès de test (`?e2e`) existaient aussi en production.
**Décision** :
- **Vocabulaire du XIIIᵉ siècle**, avec un glossaire dans `CLAUDE.md`. Mangonneau, beffroi (que l'on « accole »), mineur (« miner »), sergent, sergent du rempart, capitaine, cavalier, l'homme du treuil.
  - Les points de vie et d'action sont écrits en toutes lettres (`actionPoints()`) ; « coup terrible » remplace « critique ».
  - Qualité graphique : Légère, Moyenne, Haute.
  - Les identifiants internes ne changent pas : les sauvegardes et les adresses en dépendent.
- **Sauvegardes** (`src/core/save/`, `src/state/storage.ts`, `src/state/battle-save.ts`) :
  - la progression a un format versionné, est relue champ par champ (une fiche abîmée est écartée), et fusionne avec celle d'un autre onglet ;
  - la bataille en cours est enregistrée après chaque ordre : ses ordres, ses héros absents, l'empreinte de son état. Une bataille, c'est une graine, un scénario et des ordres : on la rejoue à l'identique ;
  - si l'empreinte ne correspond plus (autre version des règles ou des cartes), la sauvegarde est écartée et le joueur prévenu ;
  - la reprise se propose depuis le menu (« Reprendre la bataille »), la lettre du château et la bataille elle-même ;
  - le navigateur est prié une fois de conserver les données (`navigator.storage.persist`) ;
  - mesures : l'empreinte coûte 0,3 ms, et une bataille de 9 tours pèse 11 Ko d'ordres.
- **Sécurité** :
  - `vercel.json` envoie une CSP stricte : tout depuis le site, seul `'wasm-unsafe-eval'` pour le décodeur meshopt, `frame-ancestors 'none'` ;
  - avec elle : `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP ;
  - `vite preview` sert les mêmes en-têtes : le build se vérifie localement sous la même politique, et aucune violation n'a été relevée (conseil de guerre, son, leçons, bataille) ;
  - `?e2e` n'existe qu'en développement (`ui/test-flags.ts`) ; l'atelier du peintre quitte le menu de production ;
  - le jeu livré n'a aucune vulnérabilité connue (`npm audit --omit=dev`). Côté développement, sharp et source-map-js sont corrigés ; `braces` (via `@gltf-transform/cli`, sans correctif) est un risque accepté, limité à nos propres commandes d'assets.
- **Bonnes pratiques** :
  - GitHub Actions vérifie chaque envoi : typage, lint, tests du core, build, audit ;
  - un README en français sert la page publique ;
  - de nouveaux tests : 12 unitaires (sauvegardes) et 3 de bout en bout (reprise, recommencer, sauvegarde abîmée).
**Conséquences** :
- Changer le format d'une sauvegarde exige un nouveau numéro de version et une migration. Changer les règles rend les batailles en cours non reprenables (le joueur en est prévenu) ; la progression de campagne, elle, reste.
- Les tests de bout en bout restent hors CI, faute de carte graphique ; ils se lancent sur la machine de développement avant chaque déploiement.

## ADR-039 — Un clic fait la chose évidente : s'approcher d'abord, puis agir
**Contexte** : l'utilisateur ne parvenait pas à attaquer. Un clic sur un ennemi lançait l'attaque telle quelle. Hors de portée (un sergent ou un chevalier doit être au contact, à 1,6 m ; un archer porte à 35 m), l'ordre était refusé avec un seul « Hors de portée. », et rien n'expliquait qu'il fallait d'abord avancer l'homme, puis cliquer de nouveau sur l'ennemi. Il a demandé de revérifier toutes les logiques de ce genre. Le même piège se retrouvait partout :
- un déplacement trop long pour le tour était refusé ;
- le bélier devait être collé à la porte, le mineur au bord de la douve ou au pied de la courtine ;
- la flèche enflammée, l'eau sur un foyer et les gestes des héros exigeaient d'être déjà à portée ;
- « Accoler » et « Monter » n'apparaissaient que contre le mur ou le beffroi ;
- rien ne disait, avant d'avoir choisi un homme, qui était qui.
**Décision** :
- `core/battle/reach.ts` (`planApproach`) cherche, parmi les cases atteignables ce tour, la plus proche (en points d'action) d'où l'acte devient possible. La case doit être libre et à portée ; l'acte doit y être accepté par les règles, points d'action compris. Seuls l'éloignement et l'absence de vue se corrigent en marchant : un tour déjà joué, un pont-levis levé ou une douve non comblée restent des refus.
- Chaque acte a son planificateur : `planStrike`, `planStructureStrike` (bélier, mangonneau), `planFill`, `planUndermine`, `planDock`, `planClimb`. La portée d'une arme est nommée une fois (`weaponReach`).
- `planAdvance` coupe un déplacement trop long là où les points d'action s'épuisent, sur le chemin du point demandé : l'homme avance d'autant et finira au tour suivant. Un lieu qu'aucun chemin ne rejoint reste refusé.
- `ui/battle/intent.ts` dit, en un seul endroit, ce qu'un clic ferait là où est le pointeur : l'aperçu du survol et le clic ne peuvent pas diverger. Le jeu reçoit des commandes ordinaires (`move`, puis l'acte), donc le rejeu reste exact. Si un tireur en garde abat ou met en fuite l'homme en chemin, l'acte n'est pas donné.
- Au survol, l'aperçu l'annonce : « S'approcher : 2 points d'action, puis tirer », avec l'exposition aux tireurs ennemis ; le chemin est tracé au sol. « Accoler » et « Monter » s'offrent dès que le mur ou le beffroi est à une marche de ce tour, avec la note « s'approche d'abord ».
- Sans homme choisi, le survol d'un homme montre une fiche : son nom, son camp, sa vie, son moral, sa portée. C'est un ajout d'interface, signalé à l'utilisateur.
- Les refus disent quoi faire, en clair (`REJECTION_LABEL`) : « Trop loin pour l'atteindre ce tour : avancez d'abord. » Rien ne bouge, et aucun ordre refusé n'encombre le journal des commandes.
- Les leçons de la bataille d'essai l'expliquent : « Frapper », « Le bélier », « Mineurs et beffroi ».
- Les fiches d'aperçu, en lecture seule, laissent passer le pointeur. Avant, une fiche apparue sous le pointeur le captait, puis disparaissait aussitôt : l'homme placé dessous ne pouvait être ni désigné ni choisi.
**Conséquences** : les recherches au survol sont bornées (400 cases au plus, de la plus proche à la plus lointaine) et ne se refont que si la cible change (`intentKey`). L'IA n'est pas concernée : elle cherchait déjà ses positions.

## ADR-040 — Revue de cohérence : ce que le jeu dit est ce que les règles font
**Contexte** : l'utilisateur a demandé de revérifier toutes les incohérences du jeu. Chaque texte (interface, journal, leçons, conseils, lettres, plans, héros) a été relu contre les règles et les données, et chaque mot d'époque douteux contre le Trésor de la langue française.
**Décision** :
- **Les règles, une seule fois.**
  - `core/battle/heroes.ts` (`abilityCost`) donne ce qu'une capacité prend au héros : ses points d'action, et si elle est son action du tour (un coup, un tour de travail). La carte en tire sa note et son grisé. Avant, la Flèche perçante affichait 1 point d'action pour 2 réels, et l'Assaut du preux et la Double besogne restaient cliquables une fois l'action du tour dépensée.
  - `core/battle/turn.ts` (`canStillAct`) dit qui peut encore agir : des points d'action, pas en fuite, pas un beffroi accolé. L'avertissement de fin de tour et la touche Tab s'en servent. Avant, un homme sans point d'action, ou un beffroi accolé, « pouvait encore agir » à jamais.
  - Les chiffres des textes viennent des règles : la pluie, la nuit, l'ébranlement, la flèche enflammée.
- **Les délais.** Le dernier tour se joue en entier : « avant la fin du tour 24 », et les étendards disent « en 17 tours au plus », comme la règle qui les décerne.
- **Les textes contre les règles.**
  - Brumefond : le brouillard ne se lève pas pendant la bataille, c'est le vent de Bertrand qui le dissipe.
  - Pierre-Ardente : l'assaut des flambeaux part à 22 h (« la nuit close »), pas à minuit.
  - Les contours de déplacement de la leçon : le doré pour marcher en gardant de quoi frapper, le pâle pour marcher seulement.
  - Le beffroi fait monter 4 hommes par tour.
  - Une courtine effondrée coûte des points de moral : elle n'ébranle pas d'office.
  - Le Fortin attend « l'armée de secours », pas « les renforts du Félon » (ce sont des brigands).
- **La langue.** Le mangonneau est masculin. Le beffroi n'est plus « la tour ». Aude est « ébranlée », « exposée ». « Passif » devient « Talent », « briefing » devient « consignes », « unité » devient « homme ». Les apostrophes sont typographiques partout.
- **Les noms des héros, vérifiés au Trésor de la langue française (15/10).**
  - Les titres : « maître des engins » (engin, machine de guerre, 1155), au lieu de « maître ingénieur » (1537) ; « vieux chevalier », au lieu de « chevalier vétéran » (1520).
  - Les capacités : « Coup juste », au lieu de « Réglage du tir » (réglage, 1870 ; tir, 1660) ; « Double besogne » (besogne, travail, 1268), au lieu de « Chantier forcé » ; « Assaut du preux » (assaut et preux, v. 1100), au lieu de « Charge héroïque » (charge, au sens militaire, 1540).
  - Le talent : « Fermeté » (v. 1200), au lieu d'« Inébranlable » (1606).
  - Les identifiants internes ne changent pas.
- **Le banc d'essai.** Le budget de chargement des tests de bout en bout se mesure seul, avant les autres : mesuré au milieu de sept navigateurs, il échouait selon la charge de la machine.
**Conséquences** :
- Restent, en attente du choix de registre de l'utilisateur, les mots courants postérieurs : « tir » (1660), « volée » au sens d'une décharge (1555), « héroïque », ainsi que ceux du glossaire.
- Les étiquettes d'unités inutilisées par les règles (`shieldWall`, `charge`, `boilingOil`…) restent dans `units.json` comme intention du brief.

## ADR-041 — La feuille de route décidée avec l'utilisateur (15/10)
**Contexte** : l'utilisateur veut « un jeu parfait » et a répondu à trois séries de questions.
**Décisions de l'utilisateur** :
- Le joueur joue sur un **ordinateur portable, au pavé tactile** : ni molette ni clic du milieu.
- Une bataille dure environ **une demi-heure**.
- La langue est celle de **l'époque, stricte** (choix A) : chaque mot est vérifié au Trésor de la langue française, et un glossaire explique les mots rares.
- **Tout est permis, par étapes** : chaque étape est livrée, testée et déployée avant la suivante. Priorité à la **prise en main**.
- Retenu :
  - la sommation, les faits d'armes ;
  - « Que ferait Guillaume ? », les ordres groupés ;
  - le camp entre deux sièges, la chronique enluminée ;
  - les saisons ;
  - une musique refaite « en professionnel », à partir d'airs d'époque du domaine public arrangés avec des banques d'instruments CC0 ;
  - la caméra par boutons à l'écran et gestes à deux doigts ;
  - trois niveaux de difficulté.
- Écarté pour l'instant : la contre-mine, le blocus, annuler un ordre, la défense d'un château, l'ost qui se souvient, les sièges historiques, les heures canoniales, la lecture à voix haute.
**Étapes** :
1. **Prise en main** : le pavé tactile, « Que ferait Guillaume ? », les ordres groupés.
2. **Rythme et difficulté** : des batailles d'une demi-heure, trois niveaux, un rééquilibrage vérifié par `campaign-scout --sim`.
3. **Justesse historique** : le vocabulaire strict et son glossaire, la sommation, un fait d'armes par château.
4. **Campagne** : le camp entre deux sièges, la chronique enluminée.
5. **Beauté et son** : la musique, les saisons.

## ADR-042 — La caméra au pavé tactile
**Contexte** : le joueur joue sur un ordinateur portable, au pavé tactile (ADR-041). Le jeu demandait une molette pour rapprocher la vue et un clic du milieu pour la faire pivoter. Sur un pavé, glisser à deux doigts arrive comme une molette : la vue se rapprochait au lieu de se déplacer.
**Décision** :
- `render/camera/wheel-gesture.ts` lit chaque molette :
  - un pincement (une molette avec Ctrl, ainsi l'envoient les navigateurs) rapproche ou éloigne la vue ;
  - deux doigts qui glissent déplacent la vue, comme une page qu'on fait défiler ;
  - le cran d'une molette de souris rapproche ou éloigne.
- Le navigateur ne dit pas d'où vient une molette. Un pavé envoie de petits pas en pixels, souvent de biais ou fractionnaires. Dès qu'une molette lui ressemble, les suivantes sont lues comme venant d'un pavé.
- L'option **Pointeur** (Automatique, Souris, Pavé tactile) tranche quand la devinette se trompe. C'est un champ ajouté à `siege.settings.v1` et lu avec sa valeur par défaut : une ancienne sauvegarde garde ses autres options, d'où l'absence de nouveau numéro de version.
- Des boutons sous la mini-carte permettent de pivoter, de rapprocher, d'éloigner et de revenir sur l'homme choisi ou sur le milieu de l'armée. Un clic fait un pas ; tenu, le bouton répète.
- Le clic droit, soit un toucher à deux doigts sur le pavé, annule comme Échap.
- La leçon « Regarder le terrain », les commandes des options et le README le disent.
**Conséquences** : une souris à molette fine peut passer pour un pavé ; l'option « Souris » le corrige.

## ADR-043 — « Que ferait Guillaume ? »
**Contexte** : un joueur peu habitué aux jeux doit pouvoir apprendre en jouant, sans manuel (ADR-041).
**Décision** :
- Le bouton **Conseil** de la carte de chaque homme, ou la touche C, montre ce que ferait le vieux chevalier, en une phrase. Exemple : « Avance à couvert (2 points d'action), hors de portée des tireurs ennemis, puis tire sur le milicien : 70 % de toucher, de quoi l'abattre. »
- Le chemin est tracé au sol. Appuyer de nouveau (ou « Suivre le conseil ») donne les ordres ; Échap, ou « Non merci », le range.
- Le choix est celui de l'IA du jeu (`core/ai/advice.ts` appelle `decideUnit`), qui décide sur ce que voit le camp du joueur : un ennemi caché par le brouillard n'est jamais trahi.
- Le cœur rend des faits (l'acte, la marche, les tireurs, le couvert, la chance, de quoi abattre). `ui/battle/advice.ts` en fait la phrase. Un engin qui doit attendre dit pourquoi : « la porte reste hors d'atteinte tant que le pont-levis n'est pas abattu ».
- Tout ordre donné range le conseil : il valait pour la bataille telle qu'elle était.
**Conséquences** : les ordres sont des commandes ordinaires, et le rejeu reste exact.

## ADR-044 — Les ordres groupés
**Contexte** : mener quinze hommes un à un coûte beaucoup de clics à chaque tour, surtout au pavé tactile (ADR-041).
**Décision** :
- Un cadre tracé sur le champ, en glissant le bouton enfoncé, choisit les hommes qui s'y trouvent. Maj et un clic en ajoute ou en retire un. Échap les laisse.
- Sur le sol, ils marchent **en rang** (`core/battle/group.ts`, `planGroupMove`) : chacun garde sa place autour de leur milieu, resserrée à 6 m au plus. Une place prise ou hors d'atteinte est remplacée par la case libre la plus proche. Celui qui va trop loin pour ce tour s'arrête en chemin.
- Sur un ennemi, ceux qui peuvent l'atteindre ce tour frappent, après une marche s'il le faut ; les autres s'approchent (`planGroupStrike`).
- Chaque homme est planifié à son tour, sur une bataille où ceux d'avant se tiennent déjà là où ils vont. Les ordres sont donnés homme par homme : celui que les règles arrêtent (abattu en chemin, ennemi déjà tombé) s'arrête, les autres continuent.
- L'aperçu résume (« En rang : 7 hommes marchent vers ce point ; 2 n'y seront qu'au tour suivant ») et trace tous les chemins. Un anneau doré marque chaque homme choisi : un seul appel de dessin, et seulement quand ils sont plusieurs.
- Les boutons de la carte (garde, travaux, capacités, conseil) restent ceux d'un seul homme.
**Conséquences** : commandes ordinaires, rejeu exact ; aucun appel de dessin en plus hors d'un groupe.

## ADR-045 — Une bataille d'une demi-heure, et trois rangs
**Contexte** : l'utilisateur veut des batailles d'environ une demi-heure et trois niveaux de difficulté (ADR-041).

**Mesures.**
- À vitesse normale, une manche coûtait **43 s d'animations** : 39 s pour les marches de nos hommes, jouées une à une, pendant lesquelles le joueur ne peut rien ordonner ; 3,6 s pour le tour de la garnison.
- En simulation (`campaign-scout --sim`, l'IA des deux côtés), l'assaillant gagnait entre le 16ᵉ et le 27ᵉ tour.
- Une trace tour par tour montre où passe le temps :
  - l'approche : l'armée part à 141–176 m de la porte, derrière le village ;
  - la traque finale : de 7 à 5 défenseurs debout en 12 tours.
- Un joueur qui mène ses hommes en groupe (ADR-044) approche plus vite que l'IA.

**Décision.**
- **Les marches qui se suivent dans la file d'animation, d'hommes différents, se jouent ensemble** (`BattleDirector`, `together`). C'est le cas d'un ordre groupé ou de l'avance de l'ennemi. Un tir, un coup, ou tout autre événement interrompt le lot : l'ordre des faits reste lisible. Mesuré : 39 s ramenées à 23 s par manche, alors même que l'IA intercale des coups ; un ordre groupé fait mieux.
- **Le rythme du siège.**
  - La garnison se rend sous 40 % d'hommes debout (30 % jusqu'ici) : une garnison sans espoir se rendait.
  - Le délai passe à 22 tours (24). Les châteaux longs passent à 24 (26) ; la bataille d'essai, qui est une leçon, à 26 (30).
  - Sur seize assauts simulés, quatre réglages ont été essayés :

| Réglage | Victoires de l'IA |
|---|---|
| Courtines affaiblies, délai de 18 tours | 3 à 7 |
| Reddition à 40 %, 20 tours | 7 |
| Reddition à 40 %, 22 tours (retenu) | **11** (référence ADR-037 retrouvée) |
| Reddition à 40 %, 24 tours | 13 |
- **Trois rangs**, au choix du joueur au conseil de guerre et dans les options pour l'escarmouche (`campaign.json`, `ranks`). La bataille d'essai, une leçon, n'en a pas.

| Rang | Effets | Victoires de l'IA assaillante (sur 16) |
|---|---|---|
| **Écuyer** | 2 défenseurs en moins, moral de la garnison −10, son adresse −10 %, 4 tours de plus | 14 |
| **Chevalier** | aucun : le château tel que l'ont vu les éclaireurs | 11 |
| **Baron** | garnison au complet (les absents du château reviennent), moral +10, adresse +5 %, 1 tour de moins | 7 |

  Le Baron à 2 tours de moins ne laissait que 4 victoires sur 16. Les mots ont été vérifiés au TLF : « écuyer » (titre, début du XIIIᵉ siècle), « baron » (vers 1100). « Aguerri », sans entrée datée, est écarté.
- **L'adresse** est une règle nouvelle du cœur, `aim`, propre à chaque camp, dans le `Scenario` et l'état. Elle s'ajoute à la chance de toucher des coups et des tirs des hommes de ce camp, tirs de garde compris, et apparaît comme une condition (`kind: 'aim'`). La riposte n'est pas concernée.
- Le rang figure dans l'adresse de la bataille (`&rank=squire|baron`), donc dans la sauvegarde. Le rang Chevalier n'ajoute rien à l'adresse ni à la clé de sauvegarde : celles d'avant restent valables. Le dernier rang choisi est retenu dans les options (`siege.settings.v1`, champ `rank`, lu avec son défaut).
- Le conseil montre le rang sur une ligne, pour tenir dans un écran de portable (1280 × 720) ; les consignes du premier tour en donnent les chiffres.

**Conséquences.**
- Les règles changent : une bataille sauvegardée avant cette version ne se rejoue plus à l'identique. Le joueur en est prévenu et la bataille repart du début (ADR-038).
- La demi-heure dépend du joueur. Le jeu ne peut pas la mesurer seul : à vérifier en le regardant jouer.

## En attente
- **Cavalerie** : cheval Quaternius CC0 et cavalier attaché à l'os `Back`, ou alternative (voir le rapport d'`asset-scout`). À trancher en J3.
- **Animations manquantes** (cheer, push, arbalète, lance) : clés authorées en Blender headless ou reciblage depuis l'Universal Animation Library (J3).

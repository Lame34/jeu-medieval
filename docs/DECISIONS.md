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

## En attente
- **Cavalerie** : cheval Quaternius CC0 et cavalier attaché à l'os `Back`, ou alternative (voir le rapport d'`asset-scout`). À trancher en J3.
- **Animations manquantes** (cheer, push, arbalète, lance) : clés authorées en Blender headless ou reciblage depuis l'Universal Animation Library (J3).

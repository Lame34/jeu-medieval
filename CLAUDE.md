# CLAUDE.md — « Siège »

Jeu de stratégie médiéval au tour par tour (siège de château) en Three.js / React Three Fiber, en ligne sur **https://jeu-medieval.vercel.app**.

Documents de référence :
- **`docs/GAME_BRIEF.md`**, la bible du projet, fait foi ;
- `docs/STYLE_BIBLE.md`, la direction artistique ;
- `docs/DECISIONS.md`, les décisions (ADR).

**État :** J1 à J6 sont livrés (campagne du Val d'Orle, ADR-036). J7, le polish, est en cours (ADR-037). La feuille de route décidée avec l'utilisateur est l'**ADR-041**, en cinq étapes. Les étapes 1 (la prise en main : ADR-042 à 044) et 2 (le rythme et les rangs : ADR-045) sont faites ; vient l'étape 3, la justesse historique.

## Travailler avec l'utilisateur — le plus important
- **Il ne lance rien et ne clique jamais.** J'installe, je lance les serveurs, les navigateurs de test, Blender headless et les téléchargements, en ligne de commande.
  - Seules les connexions à un compte et les autorisations d'application lui reviennent. Je lui propose alors de taper `! <commande>` dans le prompt.
- **Je ne fais ni commit ni push sans son ordre.** Il dit quand committer et déployer : « commit », « publie », « déploie ».
  - D'ici là, je laisse les changements dans l'arbre de travail, groupés par sujet.
  - À son signal : des commits atomiques (`git add` par groupe de fichiers), puis `git push origin main`, puis `node scripts/check-live.ts`.
- **Déploiement :** GitHub `Lame34/jeu-medieval` (dépôt **public**), branche `main`. Vercel compile chaque push sur ses serveurs, selon `vercel.json` et `engines.node: 24.x`.
  - **Jamais d'outil Vercel en ligne de commande** : l'utilisateur l'a refusé.
  - Tout ce qui est poussé est public : aucun secret. L'e-mail `lilcstl2@gmail.com` sert uniquement d'auteur git.
- **Langues :** je lui réponds en français. Le code, les commentaires et les messages de commit sont en anglais ; le texte du jeu est en français.
- **Ce qu'il veut :**
  - un jeu plus simple et plus léger (retour du ⛳ J5) ;
  - zéro budget : assets CC0, aucune clé d'API, aucun générateur en ligne ;
  - 60 FPS sur l'Intel Arc en préréglage Portable.
  - Quand il demande « pas de nouvelles features », j'améliore l'existant, et je **signale** tout écart (exemple : la capitulation, ADR-037).
- **Mes comptes rendus :** concis et en français. Ce qui a changé et pourquoi, les chiffres mesurés, ce que j'ai vérifié, ce qui reste. Je n'annonce jamais un résultat non vérifié.
- **Je fais propre :** les bonnes pratiques d'abord, pas de raccourci (voir « Bonnes pratiques »).

## Le joueur, et la langue du jeu
Le joueur visé a une soixantaine d'années. C'est un passionné du Moyen Âge, très connaisseur ; ce n'est pas forcément un habitué des jeux vidéo. Tout texte du jeu (interface, leçons, récits, journal, astuces, README) suit ces règles :
- **Un français clair et soutenu**, des phrases complètes.
  - Ni anglicismes ni jargon de jeu vidéo : pas de « PV », « PA », « buff », « critique », « cooldown », « HUD », « preset ».
  - On écrit « points de vie », « points d'action » (`actionPoints()` dans `ui/battle/describe.ts`), « coup terrible », « pas encore prête ».
  - « Homme » ou « troupe » plutôt qu'« unité » dès que la phrase le permet.
- **Le vocabulaire de l'époque** (XIIᵉ–XIIIᵉ siècle), **vérifié avant d'entrer dans le jeu** : première attestation dans le Trésor de la langue française (cnrtl.fr/etymologie, page rendue par un navigateur sans fenêtre) et dans l'Anglo-Norman Dictionary (anglo-norman.net) pour l'ancien français. Un connaisseur relève le moindre anachronisme ; mon intuition ne suffit pas (j'avais introduit « cavalier », emprunt italien du XVᵉ siècle).
- **Une logique fidèle à l'histoire** :
  - une garnison réduite à une poignée d'hommes se rend ;
  - une armée de secours lève le siège ;
  - on comble la douve de fascines ;
  - on mine le pied d'une courtine ;
  - le beffroi s'accole au mur et abaisse son pont ;
  - la nuit, la pluie et le vent pèsent sur les tirs.
  Une règle ou un récit qui contredit l'histoire connue se discute avant d'entrer dans le jeu.
- Les identifiants internes restent en anglais et ne changent pas (`catapult`, `siegeTower`, `sapper`, l'id de plan `catapulte`) : les sauvegardes et les adresses existantes en dépendent. Seuls les noms affichés suivent le glossaire.

### Glossaire (nom affiché ← identifiant interne)
**Vérification du 11/10 (CNRTL, AND).** D'époque : mangonneau (1155), beffroi (« berfroi », v. 1155), mineur (« mineor », 1194-1199), miner (v. 1200), sergent (v. 1130), arbalétrier (XIIᵉ s.), garnison, muraille, créneau, douve, pont-levis, donjon, poterne, ost, étendard, saillie (v. 1165), capitaine (1288). Fin du Moyen Âge : herse (grille, 1358), rempart (1370), treuil (1376), escarmouche (v. 1360), cavalier (v. 1470). **Vérification du 15/10 (héros).** D'époque : engin (machine de guerre, 1155), besogne (travail, 1268), assaut et preux (v. 1100), fermeté (v. 1200), ralliement (v. 1175), coup, juste. Écartés des titres et des noms de capacités : ingénieur (1537), vétéran (1520), réglage (1870), charge (militaire, 1540), inébranlable (1606), visée (XVᵉ s.). **Postérieurs, en attente du choix de l'utilisateur** (langue d'époque stricte ou mots des historiens pour l'architecture) : tir (1660) et volée (décharge, 1555), encore dans l'interface ; bélier (engin, 1548 ; d'époque : « mouton »), fascines (1577 ; « fagots »), courtine (1587 ; « mur », « muraille »), sortie (militaire, 1570 ; « saillie »), milicien (1725), chemin de ronde.

| Affiché | Interne | Remarque |
|---|---|---|
| Sergent | `soldier` | Fantassin à l'écu (les « sergents à pied ») |
| Sergent du rempart | `wallGuard` | Défenseur du chemin de ronde, à l'écu |
| Chevalier, Chevalier de sortie | `knight`, `sallyKnight` | « Sortie » : la charge hors des murs |
| Cavalier | `cavalry` | |
| Archer, Archer de tour, Arbalétrier | `archer`, `towerArcher`, `crossbowman` | |
| Milicien | `militia` | Les milices communales |
| Capitaine | `officer` | Commande la garnison |
| Mangonneau | `catapult` | Engin à bras qui lance des pierres |
| Bélier | `ram` | Couvert d'un toit, n'enfonce que les portes |
| Beffroi | `siegeTower` | On l'« accole » au mur (pas « amarrer ») |
| Mineur ; miner, mine | `sapper` ; `undermine` | Comble la douve, mine les courtines (pas « sapeur », « saper ») |
| L'homme du treuil | `def-tower-0` | Celui qui tient le pont-levis |
| Courtine, chemin de ronde, herse, pont-levis, douve, fascines, brèche | | Les mots justes, partout |

## Sécurité — le site est public
- **En-têtes HTTP** dans `vercel.json` : une politique de sécurité du contenu (CSP) stricte, plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` et COOP/CORP. HTTPS obligatoire (HSTS) est envoyé par Vercel.
  - `vite preview` sert les mêmes en-têtes (lus dans `vercel.json`) : toute nouveauté est essayée sous cette politique avant d'être poussée.
  - Une console qui affiche « Refused to… » est un bug.
- **Aucun script, style, police ni service extérieur.** Tout est servi par le site. Pas de `innerHTML`, pas de `eval`, pas de style en ligne écrit en HTML.
  - La CSP n'autorise que `'wasm-unsafe-eval'`, pour le décodeur meshopt.
- **Points d'accès de test réservés au développement.** `?e2e` (`ui/test-flags.ts`) n'existe qu'en dev. L'atelier du peintre n'apparaît pas dans le menu en production.
- **Tout ce qui est relu (stockage, URL) est validé**, jamais cru sur parole : `core/save/*.ts`, `state/settings.ts`, `battleSetupFrom`. Une donnée abîmée est écartée, elle ne fait jamais planter le jeu.
- **Dépendances :** `npm audit --omit=dev` doit rester propre (la CI le vérifie). Une alerte des outils de développement se corrige si un correctif existe, ou se consigne.
  - Risque accepté : `braces` via `@gltf-transform/cli`, sans correctif, et seulement pour nos propres commandes d'assets.
- **Aucun secret dans le dépôt :** il est public, tout comme l'historique.

## Sauvegardes
- **Progression de campagne** (`siege.campaign.v1`) :
  - format versionné, lu strictement (`core/save/progress.ts`) ;
  - fusionnée avec un autre onglet ouvert : deux onglets ne s'effacent jamais leurs châteaux.
- **Bataille en cours** (`siege.battle.v1`) :
  - enregistrée après chaque ordre : la liste des ordres, les héros absents, et l'empreinte de l'état (`hashBattleState`) ;
  - reprise depuis le menu, la lettre du château ou la bataille elle-même ;
  - si une autre version du jeu ne rejoue plus les ordres à l'identique, l'empreinte le détecte : la sauvegarde est écartée et le joueur en est prévenu ;
  - les parties de test (`?e2e`, `?bench`) ne sauvegardent pas.
- **Options** (`siege.settings.v1`) : chaque champ est validé.
- **Règles :**
  - toute lecture et écriture passe par `state/storage.ts` (protégée, demande de conservation au navigateur) ;
  - **un changement de format = un nouveau numéro de version et une migration**, jamais une sauvegarde de joueur perdue en silence ;
  - un identifiant interne ne se renomme pas (les sauvegardes le contiennent).

## Bonnes pratiques
- La logique pure va dans `src/core`, sans DOM, testée par Vitest. L'interface et le stockage restent fins et appellent le core.
- Chaque changement de règle, de sauvegarde ou de format arrive avec ses tests ; chaque parcours joueur important a son test de bout en bout.
- Pas de code mort, pas de nombre magique, des noms qui disent ce qu'ils font, des commentaires qui disent pourquoi.
- **Vérification automatique :** GitHub Actions (`.github/workflows/ci.yml`) rejoue, à chaque envoi, le typage, le lint, les tests du core, le build et l'audit. Les tests de bout en bout restent sur la machine de développement, faute de carte graphique en CI.
- Les décisions vont dans un ADR ; le README reste à jour pour un visiteur du dépôt.

## Chaîne d'outils
Toujours charger la chaîne portable (Node 24, Blender 4.5, KTX), qui n'est pas celle du système (Node 20) :
- Bash : `source scripts/env.sh && <commande>`
- PowerShell : `. ./scripts/env.ps1; <commande>`

## Avant de dire « fini »
1. `npm run typecheck`, `npm run lint` (aucun avertissement), `npm test`, `npm run e2e`, `npm run build`.
   - Puis `npm run preview` et `node scripts/check-live.ts http://localhost:4188` : le build tourne sous la CSP de production, sans erreur.
2. Après un changement visible, **je capture et je regarde** :
   - scripts `capture-*` ;
   - pour un cas précis, un script Playwright jetable dans le dossier temporaire (scratchpad).
3. Après un changement de règle ou d'équilibrage : `node scripts/campaign-scout.ts --sim`.
   - Référence ADR-045 (rang Chevalier) : l'IA assaillante gagne 11 assauts sur 16, soit 1/1, 2/3, 2/3, 2/3, 2/3, 2/3 du fortin à Haute-Garde.
   - Avec `--rank squire` : 14 sur 16 ; avec `--rank baron` : 7 sur 16.
4. Après un changement qui pèse sur le rendu : `npm run bench:perf -- --preset portable --scene battle --query live`.
   - Comparer en **A/B** contre le commit précédent, dans un worktree : `git worktree add`, puis une jonction `mklink /J` vers `node_modules`.
   - Le « 1 % bas » varie avec l'état de la machine ; on ne compare jamais à une vieille ligne du journal.
5. Documentation :
   - un ADR pour chaque décision ;
   - les tables de `docs/ARCHITECTURE.md` ;
   - `docs/ASSETS_TODO.md` (aucun cube gris : chaque substitut y est consigné) ;
   - `docs/PERF_LOG.md` ;
   - le journal de `docs/STYLE_BIBLE.md`.

## Pièges connus
- **Shell.** Pas de backquotes ni de `${…}` dans `node -e "…"` ni dans un heredoc non protégé : Bash les exécute.
  - Utiliser Write/Edit, ou un fichier `.cjs` / `.mts` dans le scratchpad.
  - Les scripts jetables vont dans le scratchpad, jamais dans `scripts/` : `tsc -b` y vérifie tout et échouerait. En `.mts`, on importe le projet par chemin relatif.
- **Playwright.** La config est dans `tests/e2e/`. Utiliser `npm run e2e [-- <filtre>]`, pas `npx playwright test` seul.
- **Rechargement à chaud.** Le serveur de dev (:5188) et le serveur Vite des e2e rechargent les sources : ne pas éditer `src/` pendant une capture ou des e2e.
- **Port 4188.** Un aperçu orphelin bloque `bench:perf` et `npm run preview`. Trouver le processus (`Get-NetTCPConnection -LocalPort 4188`) et l'arrêter.
- **Os des modèles.** Le chargeur glTF retire les points des noms : l'os `Fist.L` s'appelle `FistL`.
- **Arrondis.** `0.3 × 10` vaut `3.0000000000000004` : prévoir une marge (epsilon) avant un `floor` (`surrenderLine`).
- **Casse des fichiers.** Vercel compile sous Linux, sensible à la casse ; Windows ne l'est pas. La casse des imports et des chemins `/assets/` doit être exacte.
- **Types de commit.** Seulement les types Conventional Commits : `feat`, `fix`, `docs`, `test`, `perf`, `refactor`, `style`, `build`, `ci`, `chore`. Chaque message se termine par la ligne `Co-Authored-By` demandée.

## Drapeaux d'URL (tests, captures, bancs)
| Drapeau | Effet |
|---|---|
| `?e2e` | **Dev seulement.** Points d'accroche de test (`window.__battle`, `__battleCamera`), sans briefing ni plan d'ouverture ni sauvegarde ; la caméra ne suit pas les coups ennemis |
| `?fast` | Animations ×8, sans plan d'ouverture |
| `?turns=N` | Avec `?e2e` : la garnison ne tient que N tours |
| `?nosound` | Sans paysage sonore |
| `?bench`, `?bench&live` | Mesures : sans partie ni HUD, ou partie sans saisie |
| `?seed=…&castle=1..4` | Escarmouche sur une carte précise |
| `?weather=clear\|rain\|fog&hour=H` | Météo et heure imposées |
| `?tutorial` | Bataille d'essai |
| `&resume` | Reprend la bataille sauvegardée sans poser la question |
| `?level=<id>&plan=<id>` | Bataille de campagne avec son stratagème |

## Commandes
| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur Vite sur :5188 |
| `npm run build` / `npm run preview` | Build de production (tsc -b puis vite build) / aperçu sur :4188 |
| `npm run typecheck` | `tsc -b` : core (sans DOM), app, scripts, tests |
| `npm run lint` | ESLint, 0 warning toléré |
| `npm test` / `npm run test:cov` | Vitest (`tests/core`), couverture ≥ 80 % sur `src/core` |
| `npm run e2e` | Playwright (`tests/e2e`) |
| `node scripts/check-live.ts [url]` | Après un push : même bundle que le build local, routes directes, bataille chargée, aucune erreur sur le site en ligne |
| `npm run bench:core` | Micro-bench navigation 512² (budgets du core) |
| `npm run bench:perf -- --preset portable [--scene battle] [--cpu-throttle 4] [--query "live&weather=rain&hour=22"] [--log]` | Bench GPU (Intel Arc obligatoire), une scène par passe ; `--query live` mesure une bataille en cours ; écrit dans `docs/PERF_LOG.md` avec `--log` |
| `npm run capture:lookdev [-- <tag> --scene battle --breakdown]` | Captures des vues × 3 heures dans `docs/captures/` (ignoré par git) |
| `node scripts/capture-siege.ts [<tag>] [--seed siege-1]` | Siège scripté (pont-levis, fissures, effondrement, parc d'engins) |
| `node scripts/capture-weather.ts [<tag>]` | Nuit, crépuscule, pluie, brouillard |
| `node scripts/capture-campaign.ts [<tag>]` | Menu, carte, lettre, conseil de guerre, options, leçon, plan d'ouverture, briefing |
| `node scripts/capture-title.ts [--hour 16.4 …]` | Illustration de l'écran-titre rendue par le jeu vers `public/assets/ui/title.webp` |
| `node scripts/campaign-scout.ts [--sim] [--try <id> <graine>…]` | Cartes de la campagne : génération, validation, chaque stratagème ; `--sim` fait jouer l'IA des deux côtés |
| `npm run assets:engines` / `assets:audio` / `assets:characters` / `assets:process` | Blender headless et pipeline d'assets (gltf-transform, meshopt, KTX2) vers `public/assets` |
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
  ai/           planificateur de l'IA (scores d'utilité, tactiques de siège)
  campaign/     campagne : validation, scénario d'une bataille, étendards
  worldgen/     carte de bataille procédurale (relief, château, village, garnison)
src/data/     JSON des règles et de la campagne, validés au chargement (DEFAULT_RULES, CAMPAIGN)
src/render/   Three/R3F : materials (PaintedMaterial), terrain, vegetation, water, sky, castle, units, vfx, camera, quality
src/ui/       Écrans React, HUD, campagne, tutoriel ; thème bois, parchemin et fer
src/state/    Stores zustand (UI uniquement ; jamais la vérité de la simulation)
tests/        core/ (Vitest), e2e/ (Playwright)
scripts/      env.*, benchs, captures, vérification en ligne, pipeline d'assets, blender/*.py
public/assets/ Assets optimisés livrés (dont ui/title.webp)
```

### Invariants du core (vérifiés par ESLint et tsconfig.core)
- Jamais `Math.random`, `Date.now` ni `performance.now` dans `src/core` : la RNG et le temps sont des paramètres.
- Aucun import de `three`, `react`, `@react-three/*`, `@render`, `@ui`, `@state` ni `@audio` dans `src/core`.
- Imports relatifs avec l'extension **`.ts`** (le core tourne aussi directement sous Node) ; JSON importés avec `with { type: 'json' }`.
- Une bataille = `seed + Scenario + Command[]` ; `hashBattleState` doit être identique à chaque replay. Les effets de campagne s'écrivent dans le `Scenario`.
- Aucun nombre magique : les réglages sont dans `src/data/*.json` ou dans des constantes nommées.
- Coordonnées du sol en `(x, z)` en mètres ; la hauteur est `y` côté rendu. La cellule `(cx, cz)` couvre `[cx, cx+1) × [cz, cz+1)`.
- `edgeCost` est bit à bit identique à `segmentCost` entre centres voisins : une seule mesure de coût, de l'aperçu à l'exécution.

### Invariants du rendu
- Un seul matériau maison, le **PaintedMaterial** (base `MeshLambertMaterial` + `onBeforeCompile`), réassigné à tous les assets importés ; seul l'albédo est conservé.
- Budgets Portable (ADR-007) : ≥ 60 FPS sur l'Intel Arc, < 150 draw calls (environ 114 en bataille aujourd'hui), < 1,5 M triangles, < 400 Mo de textures ; `dpr` plafonné à 1 ; une seule lumière qui projette des ombres.
- Aucune allocation dans `useFrame` ; pas de `setState` par frame ; `dispose()` vérifié via `renderer.info`.
- Shaders précompilés (`renderer.compile`) derrière l'écran de chargement.

## Sous-agents (`.claude/agents/`)
Coûteux : seulement si l'utilisateur le demande, ou pour une revue de la boucle visuelle.

| Agent | Périmètre d'écriture |
|---|---|
| `asset-scout` | `assets-src/`, `assets/CREDITS.md` |
| `art-director` | Aucun (lecture seule, grille §13 du brief) |
| `perf-auditor` | Aucun, sauf via `bench:perf --log` |
| `test-engineer` | `tests/` |

Protocole :
- C'est moi, l'agent principal, qui intègre le code.
- Après chaque sous-agent, je vérifie `git status` et j'annule toute écriture hors de son périmètre.
- Jamais deux agents sur les mêmes fichiers en parallèle.
- Les définitions ne sont chargées qu'au démarrage d'une session ; sinon, je lance un agent généraliste en lui faisant lire la définition (ADR-011).

## Skills installés (`.claude/skills/`, ADR-003)
`three-best-practices`, `r3f-best-practices`, `threejs-syntax-shaders`, `threejs-agents-model-optimizer` (meshopt plutôt que Draco, décodeurs locaux), `threejs-errors-performance`, `procedural-landscapes` (sans `Math.random` ni CDN), `playwright-best-practices`.

## Boucle visuelle (brief §13)
Tout travail de lumière, de matériaux et de post-process se fait d'abord dans `/lookdev` :
1. On capture (`capture:lookdev`).
2. L'`art-director` note les 6 critères.
3. On corrige, et on itère tant qu'un critère est sous 8/10.

Chaque itération est consignée dans `STYLE_BIBLE.md`. Beauté et performance se valident ensemble.

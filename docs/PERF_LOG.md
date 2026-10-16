# Journal de performance — « Siège »

## Machine de mesure
| | |
|---|---|
| Modèle | Dell Precision 3490 |
| CPU | Intel Core Ultra 7 155H (16 cœurs, 22 threads) |
| GPU de référence « Portable » | **Intel Arc (iGPU Meteor Lake)**, forcé via la préférence Windows sur le Chromium de Playwright |
| GPU secondaire | NVIDIA RTX 500 Ada Laptop 4 Go (préréglages Moyen et Haut uniquement) |
| RAM | 32 Go |
| Écran | 1920 × 1080 à 60 Hz |
| OS | Windows 11 Pro 10.0.26200 |

## Budgets du préréglage Portable (voir ADR-007)
| Métrique | Budget |
|---|---|
| FPS moyen (Arc) | **≥ 60** |
| FPS 1 % low (Arc) | **≥ 40** |
| FPS moyen, CPU bridé ×4 | **≥ 40** |
| Draw calls | < 150 |
| Triangles affichés | < 1,5 M |
| Mémoire textures | < 400 Mo |
| Chargement d'une bataille | < 10 s |

## ⚠️ Mesures antérieures au 30/09 : serveur de dev, pas le build
`scripts/browser.ts` lisait `SIEGE_URL` dans une constante évaluée à l'import, avant que `perf-bench.ts` ne la règle sur l'aperçu de production. Toutes les lignes du journal antérieures au 30/09/2026 ont donc mesuré le **serveur Vite de dev** (lancé pour les captures) et non le build. Corrigé dans `fix(perf): bench the production preview` : l'URL est lue à l'appel et imprimée dans le rapport (`url=http://localhost:4188`). Ces anciennes lignes restent comme historique ; les comparer aux nouvelles n'a pas de sens.

Autres corrections du 30/09 :
- la médiane de la passe non plafonnée, sans signification (rafales de `requestAnimationFrame`, ADR-019), est remplacée par un compte d'à-coups : frames de plus de 25 ms dans la passe à 60 Hz ;
- un aperçu orphelin gardait le port 4188 : le bench refuse maintenant de démarrer si le port répond, et il tue l'arbre de processus avant le shell.

## Profilage des à-coups de la bataille (début de J3, ADR-022)
Outils : `scripts/trace-frames.ts` (trace Chromium à 60 Hz), `scripts/frame-breakdown.ts` (coût par famille d'objets, en masquant chacune), `scripts/alloc-profile.ts` (allocations par site).

**Cause.** Vue d'ensemble de la bataille à 60 Hz sur le build : aucun à-coup pendant les 100 premières secondes, puis 46 en 3 minutes. Chacun bloque 20 à 42 ms dans `DXGISwapChainImageBacking::Present` : le GPU est en retard. Une fois chaud, l'iGPU baisse sa fréquence, et cette vue, déjà proche des 16,7 ms, dépasse le budget. Le CPU n'y est pour rien : callback d'animation à 3,0 ms en médiane (3,9 avant correctifs), 11,5 ms au maximum.

**Correctifs CPU** (commit `0e37529`). Allocations : 5,7 → 2,1 Mo/s au serveur de dev ; ramasse-miettes : 85 → 30 passages en 10 s.
- Un matériau de profondeur d'ombre par nature d'objet : le matériau partagé changeait de programme à chaque frontière de groupe.
- Niveau de détail des animations : pleine cadence sous 35 m, puis une frame sur 2, puis sur 4.
- Plus de fermetures créées dans les boucles de frame.

**Postes GPU principaux**, par masquage, mesure bruitée à ±20 % par la chaleur :

| Poste | Coût par frame |
|---|---|
| Terrain | 2,6 à 4,1 ms |
| Végétation | 3 à 3,6 ms |
| Passe d'ombre | 2,6 à 3,2 ms |
| Fixe (post-process et effacements, rien dessiné) | environ 1,2 ms |

Les requêtes de chronométrage WebGL ont été écartées : dans Chromium/ANGLE, elles comptent aussi le travail des autres contextes et les attentes de la chaîne de présentation.

**Pistes.** Retirer le terrain des objets qui projettent une ombre (son auto-ombrage se voit peu) ; alléger les maisons en LOD (149 k triangles) ; résolution dynamique sans réallocation (J8), qui reste la réponse naturelle au bridage thermique.

## Chargement de la bataille (J4, 02/10)
Mesure sur le build de production, avec un navigateur neuf à chaque passe : profil vide, puis cache HTTP chaud sans cache disque des shaders, puis les deux caches chauds. Le temps court de la navigation jusqu'à `sceneReady`. Les jalons (`worldgenMs`, `layoutAtMs`, `compileMs`, `programs`, `readyAtMs`) sont lus dans `document.body.dataset`.

| Étape | Avant | Après |
|---|---|---|
| Génération de la carte (worker) | 3,6 s | 1,2 s |
| Programmes de shader | 52 | 27 |
| Compilation, à froid | ~6 s, synchrones | 1,7 s |
| Prêt, à froid | 13,2–13,6 s | **5,4–5,5 s** |
| Prêt, à chaud | 13,1 s | **5,1–5,2 s** |

Trois causes :
- **Images dessinées pendant le chargement.** Chacune liait ses programmes de façon synchrone, un par un, sur le thread principal (5,5 s dans `getProgramParameter(LINK_STATUS)` d'après le profil CPU). Le canevas ne dessine plus rien avant `sceneReady` (`useSceneStatus`) et l'écran de chargement reste affiché.
- **`compileAsync` compilait pour le canevas** (sortie sRGB), alors que la scène est dessinée dans la cible du post-traitement (sortie linéaire). La clé de cache différait : chaque programme était compilé deux fois, et la passe anticipée ne servait à rien. On compile désormais avec une cible liée. Une image est ensuite dessinée derrière l'écran de chargement pour les programmes de profondeur de la passe d'ombre, que `compile()` ne couvre pas.
- **Tampons de lignes polygonales.** Routes, rivière, masques d'exclusion et lissages projetaient chaque cellule de la carte sur toute la polyligne. Une grille de distances calculée segment par segment (`PolylineDistanceGrid`), avec la même arithmétique, donne des cartes identiques au bit près (empreintes de 6 cartes de bataille et du look-dev).

## Bataille après le rendu du siège (J4, 02/10)
Les mesures de 3403468 (64,1 FPS, 1 % low 29,5) ont été prises après une journée de charge GPU continue (captures, e2e). Un A/B enchaîné sur le même état thermique donne : de6c368 (avant le chargement sans image) à 65,4 FPS et 1 % low 33,8 ; 3403468 à 67,0 FPS et 1 % low 32,2. Pas de régression du rendu du siège ni du chargement. La marge s'est tout de même réduite depuis le 30/09 : 120 → 145 appels, vue d'ensemble à 55–58 FPS. Une passe de performance est à faire avant ⛳ J5.

## Passe de polish (J7, 10/10, ADR-037)
Bataille en cours (`--scene battle --query live`), sur secteur, A/B contre le commit d'avant la passe (5849c63, dans un worktree) :

| Version | Moyenne | 1 % bas | Appels max | Triangles max | Chargement |
|---|---|---|---|---|---|
| Avant (5849c63) | 99,6 i/s | 23,4 | 110 | 1,05 M | 5,0 s |
| Après (écus, plan d'ouverture, anneaux) | 103,2 i/s | 24,9 | 114 | 1,05 M | 4,3 s |

- Les écus coûtent 4 appels de dessin ; le plan d'ouverture et la caméra qui suit les coups ennemis, rien de mesurable.
- Le 1 % bas sous 40 vient de la machine ce jour-là, et non du code : les deux versions font pareil, avec 5 à 24 à-coups de plus de 25 ms par vue. Le relevé du 09/10 donnait 53 i/s pour le même code de départ.

## Musique et saisons (étape 5, 16/10, ADR-051, ADR-052)
Bataille en cours (`--scene battle --query live`), A/B contre 35f2489 dans un worktree, en alternant deux tours. **La machine était sur batterie**, le processeur graphique bridé : les valeurs absolues ne se comparent pas au journal, seulement A contre B.

| Version | Moyenne | 1 % bas | Appels max | Triangles max |
|---|---|---|---|---|
| Avant (35f2489), tour 1 / tour 2 | 26,5 / 24,0 i/s | 9,3 / 14,2 | 112 / 109 | 1,02 / 1,16 M |
| Après, escarmouche (palette de la moisson), tour 1 / tour 2 | 25,4 / 22,9 i/s | 9,1 / 16,8 | 109 / 112 | 1,25 / 1,05 M |
| Après, `&season=april` | 42,9 i/s | 18,2 | 114 | 1,16 M |
| Après, `&season=october` (brouillas du matin) | 43,3 i/s | 26,4 | 112 | 1,00 M |

- Les écarts entre A et B restent dans le bruit d'un tour à l'autre, triangles compris : les blés se chargent par morceaux autour de la caméra, et le relevé ne tombe pas au même instant. Les saisons ne coûtent rien par image : leurs couleurs sont posées à la construction de la scène. Les blés jeunes et le chaume sont plus bas et sans épis, donc moins lourds.
- La musique n'est pas rendue par la carte graphique. Seul le morceau joué est téléchargé, en flux.
- À refaire sur secteur, avec `--log`, pour une ligne de référence.

## Méthode
- `npm run bench:perf -- --preset portable [--scene lookdev|battle|title] [--cpu-throttle 4] [--log]`
- Build de production (`vite build` puis `vite preview`), Chromium de Playwright lancé avec `--use-angle=d3d11 --ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit` pour mesurer la marge réelle au-delà de 60 Hz.
- Préchauffage de 3 s, puis un parcours de caméra scripté de 20 s. On relève les frame times à chaque `requestAnimationFrame` et `renderer.info` à chaque seconde.
- La mesure est refusée si la chaîne GPU n'est pas l'Intel Arc (NVIDIA et SwiftShader exclus).

## Mesures
Le FPS indiqué est la moyenne des 4 vues de la scène ; le 1 % low est la pire des 4 ; draw calls et triangles sont le maximum sur les vues, passe d'ombre et post-process compris.

> **Note du 27/09, 16 h 30 — mesures v16 (b0f36ba) marquées ❌.** Le 1 % low est tombé à 21–35 sur toutes les vues, avec des rafales d'une dizaine de frames à ~25 ms toutes les ~1 s, et 92 % d'inactivité CPU (profil CDP). Le même banc, relancé aussitôt sur le build v15 (0b029ab, 53,5 à 15 h 55), donne aussi 19,6 : la cause est l'état de la machine (plusieurs heures de benchs d'affilée, étranglement thermique probable du GPU intégré ; secteur, mode « Utilisation normale »), pas le code. Les mesures seront refaites machine reposée.

<!-- perf-bench --log ajoute une ligne à la fin du tableau ci-dessous (garder ce tableau en fin de fichier) -->

| Date (UTC) | Commit | Scène | Préréglage | CPU | FPS moy. | 1 % low | Draw calls | Triangles | Textures | Budget |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-25 12:32 | 0411f98 | lookdev | portable | ×1 | 101.6 | 4.5 | 65 | 0.82 M | 22 | ❌ |
| 2026-09-25 12:36 | 0411f98 | lookdev | portable | ×1 | 106.5 | 52.9 | 65 | 0.82 M | 22 | ✅ |
| 2026-09-25 12:38 | 0411f98 | lookdev | portable | ×4 | 81.3 | 16.1 | 65 | 0.82 M | 22 | ✅ |
| 2026-09-27 15:24 | aead228 | lookdev | portable | ×1 | 112.5 | 31.3 | 53 | 0.61 M | 44 | ❌ |
| 2026-09-27 15:26 | aead228 | lookdev | portable | ×4 | 84.2 | 29.8 | 53 | 0.61 M | 44 | ✅ |
| 2026-09-27 15:27 | aead228 | battle | portable | ×1 | 91.7 | 54.6 | 110 | 1.66 M | 60 | ❌ |
| 2026-09-27 15:29 | aead228 | battle | portable | ×4 | 56.8 | 26.5 | 110 | 1.66 M | 60 | ❌ |
| 2026-09-27 15:55 | 24a7624 | lookdev | portable | ×1 | 137.5 | 53.5 | 55 | 0.53 M | 48 | ✅ |
| 2026-09-27 15:56 | 24a7624 | lookdev | portable | ×4 | 90.6 | 39.5 | 55 | 0.53 M | 48 | ✅ |
| 2026-09-27 15:58 | 67f3ca7 | battle | portable | ×1 | 99.9 | 52.4 | 111 | 1.42 M | 61 | ✅ |
| 2026-09-27 16:00 | 67f3ca7 | battle | portable | ×4 | 92.1 | 20.7 | 111 | 1.42 M | 61 | ✅ |
| 2026-09-27 16:22 | b0f36ba | lookdev | portable | ×1 | 114.5 | 25.3 | 55 | 0.55 M | 48 | ❌ |
| 2026-09-27 16:23 | b0f36ba | lookdev | portable | ×4 | 79.7 | 27.2 | 55 | 0.55 M | 48 | ✅ |
| 2026-09-27 16:25 | b0f36ba | battle | portable | ×1 | 89.3 | 22.1 | 111 | 1.46 M | 61 | ❌ |
| 2026-09-27 16:27 | b0f36ba | battle | portable | ×4 | 52.9 | 24.2 | 111 | 1.46 M | 61 | ✅ |
| 2026-09-28 12:16 | 9a3876e | lookdev | portable | ×1 | 100.4 | 50.0 | 55 | 0.55 M | 48 | ✅ |
| 2026-09-28 12:18 | 9a3876e | lookdev | portable | ×4 | 102.9 | 29.2 | 55 | 0.55 M | 48 | ✅ |
| 2026-09-28 12:19 | 9a3876e | battle | portable | ×1 | 92.2 | 28.2 | 111 | 1.46 M | 61 | ❌ |
| 2026-09-28 12:21 | 9a3876e | battle | portable | ×4 | 68.9 | 21.6 | 111 | 1.46 M | 61 | ✅ |
| 2026-09-28 12:29 | 3d5aee6 | lookdev | portable | ×1 | 131.0 | 50.3 | 56 | 0.57 M | 48 | ✅ |
| 2026-09-28 12:31 | 3d5aee6 | lookdev | portable | ×4 | 131.7 | 33.7 | 56 | 0.57 M | 48 | ✅ |
| 2026-09-28 12:33 | 3d5aee6 | battle | portable | ×1 | 132.9 | 19.7 | 112 | 1.42 M | 61 | ❌ |
| 2026-09-28 12:35 | 3d5aee6 | battle | portable | ×4 | 94.2 | 27.8 | 112 | 1.42 M | 61 | ✅ |
| 2026-09-30 16:16 | d7a66ec | lookdev | portable | ×1 | 89.7 | 52.1 | 66 | 0.47 M | 48 | ✅ |
| 2026-09-30 16:17 | d7a66ec | lookdev | portable | ×4 | 95.4 | 15.1 | 66 | 0.47 M | 48 | ✅ |
| 2026-09-30 16:19 | d7a66ec | battle | portable | ×1 | 78.5 | 54.6 | 120 | 1.42 M | 61 | ✅ |
| 2026-09-30 16:21 | d7a66ec | battle | portable | ×4 | 63.2 | 8.2 | 120 | 1.42 M | 61 | ✅ |
| 2026-10-02 18:31 | 3403468 | battle | portable | ×1 | 64.1 | 29.5 | 145 | 1.47 M | 70 | ❌ |
| 2026-10-02 18:32 | 3403468 | battle | portable | ×4 | 62.4 | 4.6 | 145 | 1.47 M | 70 | ✅ |
| 2026-10-03 20:11 | 00477ae | battle | portable | ×1 | 75.0 | 5.9 | 123 | 1.38 M | 75 | ❌ |
| 2026-10-03 20:12 | 00477ae | battle | portable | ×1 | 73.4 | 54.3 | 133 | 1.42 M | 75 | ✅ |
| 2026-10-03 20:14 | 00477ae | battle | portable | ×4 | 22.8 | 5.3 | 129 | 1.38 M | 75 | ❌ |
| 2026-10-03 20:17 | 00477ae | battle | portable | ×1 | 73.9 | 31.8 | 123 | 1.38 M | 75 | ❌ |
| 2026-10-03 20:19 | 00477ae | battle | portable | ×4 | 35.7 | 4.9 | 129 | 1.38 M | 75 | ❌ |
| 2026-10-09 16:44 | e4c5739 | battle | portable | ×1 | 96.5 | 53.2 | 118 | 1.19 M | 75 | ✅ |

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

## Méthode
- `npm run bench:perf -- --preset portable [--scene lookdev|battle|title] [--cpu-throttle 4] [--log]`
- Build de production (`vite build` puis `vite preview`), Chromium de Playwright lancé avec `--use-angle=d3d11 --ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit` pour mesurer la marge réelle au-delà de 60 Hz.
- Préchauffage de 3 s, puis un parcours de caméra scripté de 20 s. On relève les frame times à chaque `requestAnimationFrame` et `renderer.info` à chaque seconde.
- La mesure est refusée si la chaîne GPU n'est pas l'Intel Arc (NVIDIA et SwiftShader exclus).

## Mesures
Le FPS indiqué est la moyenne des 4 vues de la scène ; le 1 % low est la pire des 4 ; draw calls et triangles sont le maximum sur les vues, passe d'ombre et post-process compris.

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

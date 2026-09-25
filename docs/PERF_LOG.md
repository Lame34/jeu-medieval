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
<!-- perf-bench --log ajoute les entrées sous cette ligne -->

`# Architecture — « Siège »
`
`> Ébauche tenue à jour à chaque jalon ; version complète prévue en J8.
`
`## Vue d'ensemble
`
````
`             ┌──────────────────────────── src/core (TS pur, déterministe) ─────────────────────────────┐
` seed ──────►│ worldgen ─► TerrainData ─► NavGrid ─► BattleContext (statique, jamais sérialisé)           │
` Scenario ──►│ createBattle ─► BattleState (sérialisable) ─► applyCommand(Command) ─► BattleState' + GameEvent[] │
` Command[] ─►│ replay(seed, scenario, commands) ─► hashBattleState                                          │
`             └──────────────────────┬───────────────────────────────────────────────────────────────────────┘
`                                    │ GameEvent[] (faits)                 ▲ Command (intentions)
`             ┌──────────────────────▼────────────── src/render + src/ui ──┴────────────────────────────────┐
`             │ AnimationQueue : joue les événements en séquence (déplacements, tirs, effondrements), puis rend la main │
`             │ Scène R3F : terrain en chunks, végétation instanciée, eau, ciel, château, unités, VFX, post-process      │
`             │ HUD React + stores zustand (sélection, survol, préréglages) : jamais la vérité de la simulation         │
`             └──────────────────────────────────────────────────────────────────────────────────────────────────┘
````
`
`## Boucle de combat (J3, ADR-023)
| Rôle | Où |
|---|---|
| Règles : déplacement, attaque avec aperçu, riposte, garde, morale, fuite | `core/battle/{movement,combat,overwatch,morale}.ts`, réglages dans `data/damage.json` |
| IA : scores d'utilité, champs d'approche | `core/ai/planner.ts`, `core/nav-grid/reachable.ts` (`computeCostField`) |
| IA : tactiques de siège (feu, brèche, sortie, objectifs des engins) | `core/ai/tactics.ts` |
| Partie en cours : état, journal de commandes, tour de l'IA | `ui/battle/session.ts` |
| Miroir pour le HUD : sélection, survol, occupation, journal | `state/battle-ui.ts` |
| File d'animation, souris et clavier, tour de l'IA | `render/battle/BattleDirector.tsx` |
| Contours peints, chemin, anneaux, cônes de garde | `render/battle/{BattleOverlays.tsx,move-field.ts}`, `terrain-material.ts` |
| HUD | `ui/battle/BattleHud.tsx`, `describe.ts` |

## Siège (J4, ADR-024 à ADR-028)
Le château se casse, se comble, s'escalade et brûle sans quitter le cadre du core : l'état de bataille ne porte que des faits sérialisables (PV et chute des ouvrages, chantiers, amarrages, foyers, vent), et la grille de navigation est une fonction pure de la carte et de ces faits. `syncNav` la reconstruit une fois par combinaison, puis la garde en cache ; elle est appelée autour de chaque commande et à l'entrée de chaque aperçu.

| Rôle | Où |
|---|---|
| Ouvrages : segments de courtine, porte, herse, pont-levis ; grille qui suit les ouvrages tombés | `core/battle/structures.ts`, porterie partagée `core/worldgen/gatehouse.ts` |
| Engins contre ouvrages : aperçu et tirage, effondrement, chute du pont-levis | `core/battle/siege.ts` |
| Douve en tranches, fascines et sape | `core/battle/{moat,siege-works}.ts` |
| Tour de siège : amarrage, montée sur le chemin de ronde | `core/battle/siege-tower.ts` |
| Feu : flèches enflammées, propagation au vent, brûlures, extinction | `core/battle/fire.ts`, réglages `data/damage.json` → `fire` |
| Les cinq approches jugées avec les règles (validateur de carte) | `core/battle/approaches.ts`, `core/worldgen/validate-map.ts` |
| Château à l'écran et sa poignée (`hit`, `bringDown`, `setWork`) : fissures, blocs, gravats, poussière, porterie mobile, fascines, abri de sape | `render/castle/{Castle.tsx,siege-fx.ts,siege-works-fx.ts}` |
| Engins : maillages skinnés (Blender headless), animés en code | `scripts/blender/build_siege_engines.py`, `render/units/engines.ts` |
| Feu peint, projectiles (flèches à traînée, boulets et leur ombre, éclaboussures) | `render/vfx/{Fire.tsx,fire-fx.ts,Projectiles.tsx,projectiles.ts}` |
| Captures scriptées du siège (vraies commandes via `?e2e`) | `scripts/{capture-siege,capture-works}.ts` |

Le directeur de bataille reçoit les poignées du château, du feu et des projectiles comme celles des unités. Un coup tiré attend l'arrivée de son projectile avant de jouer la réaction de la cible. Les effets au repos ont une plage de dessin nulle : leurs programmes sont compilés derrière l'écran de chargement, sans coûter d'appel.

## Monde logique et monde visuel
`- La **même `TerrainData`** (heightfield aux coins et couche par cellule de 1 m) alimente la navigation et le rendu : relief du mesh de terrain, splatmap, placement de la végétation. Le joueur ne voit jamais la grille.
`- Le rendu peut ajouter du détail purement visuel (bruit de couleur, touffes d'herbe, cailloux), mais ne modifie jamais la navigation.
`- La physique (Rapier) est cosmétique : débris et chutes. Aucun résultat physique ne remonte vers le core.
`
`## Génération et chargement d'une bataille
`- `generateBattleMap({ seed, castleIndex })` (`src/core/worldgen/battle.ts`) produit la carte en environ 1,8 s :
`  - relief et butte du château, vallée et lit de la rivière, gué et pont ;
`  - routes tracées par A* sur une grille de 4 m ;
`  - château (courtine, tours, porte, donjon, douve), village le long de la route, fermes ;
`  - parcelles de Voronoï bordées de haies, forêt à 30 % par quantile, arbres semés par Poisson ;
`  - validation : Dijkstra sur toute la carte, au moins 3 approches d'assaut viables sur 5.
`- `/battle` lance cette génération dans un **Web Worker** (`src/ui/workers/worldgen.worker.ts`). La disposition revient par clonage structuré, avec transfert des tableaux du terrain, puis la scène compile ses shaders. On mesure 5,5–5,7 s jusqu'à la scène prête (ADR-018).
`
`## Rendu à l'échelle d'une carte de 500 m (budgets ADR-007)
`| Couche | Technique | Fichier |
`|---|---|---|
`| Terrain | Chunks de 128 m, 3 LOD à jupes (pas 1 sous 140 m, 2 sous 300 m, puis 4), splat par cellule, détail triplanaire sur les pentes | `terrain/ChunkedTerrain.tsx`, `terrain-material.ts` |
`| Anneau lointain | Collines basse résolution raccordées au bord (quads cachés sous la carte omis), bosquets de 20 faces | `terrain/DistantLandscape.tsx` |
`| Arbres, buissons, fougères, haies | Un `BatchedMesh` par espèce. Deux LOD par instance selon la distance à la caméra. Culling grossier, réévalué seulement quand la caméra bouge : pas de boucle par instance à chaque frame (ADR-016) | `vegetation/lod-batch.ts` |
`| Blé et seigle | Diffusés par chunks de 16 m autour du point de visée, deux niveaux, plafonnés ; lit de champ peint au-delà (ADR-017) | `fields/WheatField.tsx` |
`| Herbe | Brins générés dans le vertex shader, dans un rayon autour du point de visée | `vegetation/Grass.tsx` |
`| Château | Trois maillages fusionnés (pierre, toits, bois) | `castle/Castle.tsx`, `castle-parts.ts` |
`| Unités | Un SkinnedMesh par unité (corps et arme en un atlas), un matériau par corps et par faction, bibliothèque de clips partagée | `units/Units.tsx` |
`
Diagnostic : `node scripts/capture-lookdev.ts <tag> --scene battle --breakdown` affiche les draw calls, les triangles et leur ventilation par famille d'objets.
`
`## Déterminisme
`- `Rng` (sfc32, entiers 32 bits) : séquences identiques sur tous les moteurs JS. `fork(label)` dérive des sous-flux de la graine racine, jamais de la position courante du parent.
`- Les fonctions transcendantes (`sin`, `cos`, `log`, `pow`) peuvent différer d'un ulp entre moteurs. Elles restent hors des chemins qui décident de l'état d'une bataille. Là où la génération de monde en a besoin, le résultat est quantifié (cellules de 1 m, couches entières), ce qui absorbe ces écarts.
`- L'état est immuable côté API (copie à l'écriture), les unités sont triées par id, et le hash est canonique (clés triées).
`
`## Coûts de déplacement
`- Métrique unique : `segmentCost`. Pour chaque cellule traversée par le segment (DDA exact), on additionne longueur × PA/m de la couche × (1 + pénalité × pente montante). `edgeCost` (voisins) en est l'égal bit à bit, grâce à des hauteurs précalculées aux mêmes points.
`- Le chemin est calculé par A* (8-connexité, sans couper les coins), puis lissé en tirant la ficelle. Un raccourci n'est accepté que s'il ne coûte pas plus cher que le chemin sur la grille.
`- Les PA dépensés valent `ceil(coût − ε)`. Les aires affichées (Dijkstra borné) utilisent les mêmes coûts : contour « déplacement + action » à `PA − réserve`, contour « déplacement seul » à `PA`.
`
`## Performances du core (`npm run bench:core`, grille 512², Core Ultra 7 155H)
`| Requête | Médiane | Budget |
`|---|---|---|
`| Construction du NavGrid | ~85 ms (au chargement) | — |
`| A* tactique (≤ 48 m, 6 PA) | 0,01 ms (max 0,6 ms) | < 5 ms |
`| A* traversant la carte (IA) | ~12 ms | informatif |
`| Champ atteignable (6 PA) | ~0,4 ms | < 3 ms |
`| Ligne de vue sur 560 m | ~0,5 ms | — |

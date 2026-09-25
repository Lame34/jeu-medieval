# Architecture — « Siège »

> Ébauche tenue à jour à chaque jalon ; version complète prévue en J8.

## Vue d'ensemble

```
             ┌──────────────────────────── src/core (TS pur, déterministe) ─────────────────────────────┐
 seed ──────►│ worldgen ─► TerrainData ─► NavGrid ─► BattleContext (statique, jamais sérialisé)           │
 Scenario ──►│ createBattle ─► BattleState (sérialisable) ─► applyCommand(Command) ─► BattleState' + GameEvent[] │
 Command[] ─►│ replay(seed, scenario, commands) ─► hashBattleState                                          │
             └──────────────────────┬───────────────────────────────────────────────────────────────────────┘
                                    │ GameEvent[] (faits)                 ▲ Command (intentions)
             ┌──────────────────────▼────────────── src/render + src/ui ──┴────────────────────────────────┐
             │ AnimationQueue : joue les événements en séquence (déplacements, tirs, effondrements), puis rend la main │
             │ Scène R3F : terrain en chunks, végétation instanciée, eau, ciel, château, unités, VFX, post-process      │
             │ HUD React + stores zustand (sélection, survol, préréglages) : jamais la vérité de la simulation         │
             └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Monde logique et monde visuel
- La **même `TerrainData`** (heightfield aux coins et couche par cellule de 1 m) alimente la navigation et le rendu : relief du mesh de terrain, splatmap, placement de la végétation. Le joueur ne voit jamais la grille.
- Le rendu peut ajouter du détail purement visuel (bruit de couleur, touffes d'herbe, cailloux), mais ne modifie jamais la navigation.
- La physique (Rapier) est cosmétique : débris et chutes. Aucun résultat physique ne remonte vers le core.

## Déterminisme
- `Rng` (sfc32, entiers 32 bits) : séquences identiques sur tous les moteurs JS. `fork(label)` dérive des sous-flux de la graine racine, jamais de la position courante du parent.
- Les fonctions transcendantes (`sin`, `cos`, `log`, `pow`) peuvent différer d'un ulp entre moteurs. Elles restent hors des chemins qui décident de l'état d'une bataille. Là où la génération de monde en a besoin, le résultat est quantifié (cellules de 1 m, couches entières), ce qui absorbe ces écarts.
- L'état est immuable côté API (copie à l'écriture), les unités sont triées par id, et le hash est canonique (clés triées).

## Coûts de déplacement
- Métrique unique : `segmentCost`. Pour chaque cellule traversée par le segment (DDA exact), on additionne longueur × PA/m de la couche × (1 + pénalité × pente montante). `edgeCost` (voisins) en est l'égal bit à bit, grâce à des hauteurs précalculées aux mêmes points.
- Le chemin est calculé par A* (8-connexité, sans couper les coins), puis lissé en tirant la ficelle. Un raccourci n'est accepté que s'il ne coûte pas plus cher que le chemin sur la grille.
- Les PA dépensés valent `ceil(coût − ε)`. Les aires affichées (Dijkstra borné) utilisent les mêmes coûts : contour « déplacement + action » à `PA − réserve`, contour « déplacement seul » à `PA`.

## Performances du core (`npm run bench:core`, grille 512², Core Ultra 7 155H)
| Requête | Médiane | Budget |
|---|---|---|
| Construction du NavGrid | ~85 ms (au chargement) | — |
| A* tactique (≤ 48 m, 6 PA) | 0,01 ms (max 0,6 ms) | < 5 ms |
| A* traversant la carte (IA) | ~12 ms | informatif |
| Champ atteignable (6 PA) | ~0,4 ms | < 3 ms |
| Ligne de vue sur 560 m | ~0,5 ms | — |

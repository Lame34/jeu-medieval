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

## Boucle de combat (J3, ADR-023)
| Rôle | Où |
|---|---|
| Règles : déplacement, attaque avec aperçu, riposte, garde, morale, fuite | `core/battle/{movement,combat,overwatch,morale}.ts`, réglages dans `data/damage.json` |
| IA : scores d'utilité, champs d'approche | `core/ai/planner.ts`, `core/nav-grid/reachable.ts` (`computeCostField`) |
| IA : tactiques de siège (feu, brèche, sortie, objectifs des engins) | `core/ai/tactics.ts` |
| Météo et heure : pluie, brouillard (brouillard de guerre), nuit et torches, boue, vent sur l'artillerie (ADR-031) | `core/battle/conditions.ts`, rendu : `render/atmosphere/time-of-day.ts`, `render/vfx/Torches.tsx`, `render/vfx/Rain.tsx`, `state/scene-conditions.ts` |
| Héros : capacités, recharges, buffs, auras (ADR-032) | `core/battle/heroes.ts`, `core/battle/hero-auras.ts`, `data/heroes.json`, UI : `ui/battle/actions.ts` |
| IA dans un worker (même cœur, commandes rejouées par la session) | `ui/workers/ai.worker.ts`, `ui/battle/session.ts` (`playAiTurnAsync`) |
| Audio : chaîne Blender (audaspace), moteur Howler, paysage sonore (ADR-033) | `scripts/audio-manifest.json`, `scripts/blender/process_audio.py`, `audio/engine.ts`, `render/battle/BattleSoundscape.tsx` |
| HUD : heure, météo, vent, modificateurs de tir, mini-carte | `ui/battle/BattleHud.tsx`, `ui/battle/MiniMap.tsx` |
| Barre d'actions de l'unité (garde, flèche enflammée, éteindre, ouvrages, capacités) : armer, viser, ordonner (ADR-034) | `ui/battle/actions.ts` |
| Effets vides masqués après la précompilation des shaders | `render/drawable.ts` |
| Partie en cours : état, journal de commandes, tour de l'IA | `ui/battle/session.ts` |
| Miroir pour le HUD : sélection, survol, occupation, journal | `state/battle-ui.ts` |
| File d'animation, souris et clavier, tour de l'IA | `render/battle/BattleDirector.tsx` |
| Contours peints, chemin, anneaux, cônes de garde | `render/battle/{BattleOverlays.tsx,move-field.ts}`, `terrain-material.ts` |
| HUD | `ui/battle/BattleHud.tsx`, `describe.ts` |

## Campagne et options (J6, ADR-036)
| Rôle | Où |
|---|---|
| Données de la campagne (récit, cinq châteaux, bataille d'essai, stratagèmes, répliques), validées contre les règles | `data/campaign.json`, `core/campaign/{types,validate}.ts` |
| Scénario d'une bataille de campagne : garnison réduite, renforts, ouvrages entamés, douve comblée, heure, météo, délai, moral par camp ; étendards et blessés | `core/campaign/scenario.ts`, groupes de garnison `core/worldgen/garrison.ts`, départs dans `core/battle/create.ts` |
| Quelle bataille l'URL demande (`?tutorial`, `?level=&plan=`, `?seed=`) et son récit (briefing, chronique) | `ui/campaign/{battle-setup.ts,battle-story.tsx}` |
| Carte de campagne (paysage peint une fois, châteaux et route animés), lettre du château | `ui/campaign/{CampaignMap,CastleVignette}.tsx`, `ui/screens/CampaignScreen.tsx` |
| Conseil de guerre : un plan par héros, plan des éclaireurs tiré de la vraie carte | `ui/campaign/{Council,ScoutPlan,HeroEmblem}.tsx`, `effects-text.ts` |
| Carte générée dans un worker et gardée du conseil à la bataille | `ui/campaign/battle-map.ts` |
| Leçons de la bataille d'essai | `ui/tutorial/{steps.tsx,Tutorial.tsx}` |
| Progression et options sauvegardées (localStorage) | `state/campaign.ts`, `state/settings.ts`, `ui/screens/OptionsScreen.tsx` |
| Graines de la campagne : carte, approches, chaque plan, simulation IA | `scripts/campaign-scout.ts`, `tests/core/campaign-maps.test.ts` |

## Polish (J7, ADR-037)
| Rôle | Où |
|---|---|
| Fin de bataille : camp sans homme debout, capitulation de la garnison à sa ligne (`garrisonSurrenderShare`) | `core/battle/combat.ts` (`battleStatus`, `statusAfterBlows`, `surrenderLine`, `garrisonStrength`), `data/damage.json` |
| Plan d'ouverture : château, puis glissé vers le gros de l'armée ; le briefing attend | `render/camera/TacticalCamera.tsx` (`CameraIntro`), `render/battle/views.ts` (`introView`, `openingView`), `state/battle-ui.ts` (`introDone`) |
| Dernier temps de la bataille, caméra sur les coups ennemis hors champ | `render/battle/BattleDirector.tsx` |
| Écus des soldats et des gardes de rempart | `render/units/shield.ts`, `render/units/Units.tsx` |
| Écran-titre rendu par le jeu | `scripts/capture-title.ts` → `public/assets/ui/title.webp`, `ui/screens/TitleScreen.tsx` |
| Conseils des héros au chargement, touches nommées selon le clavier | `ui/screens/loading-tips.ts`, `state/keyboard.ts` |
| La caméra au pavé tactile : deux doigts déplacent la vue, pincer la rapproche ; boutons sous la mini-carte ; clic droit pour annuler ; option Pointeur (ADR-042) | `render/camera/wheel-gesture.ts`, `render/camera/TacticalCamera.tsx` (`nudge`), `ui/battle/CameraButtons.tsx`, `state/settings.ts` |
| « Que ferait Guillaume ? » : le choix de l'IA pour l'homme choisi, sur ce que voit le joueur, dit en une phrase et suivi d'un mot (ADR-043) | `core/ai/advice.ts` (`adviseUnit`), `ui/battle/advice.ts`, `ui/battle/intent.ts` (`toggleAdvice`), `ui/battle/BattleHud.tsx` (`AdviceCard`) |
| Les ordres groupés : un cadre ou Maj et clic, la marche en rang, l'attaque ensemble (ADR-044) | `core/battle/group.ts` (`planGroupMove`, `planGroupStrike`), `ui/battle/intent.ts` (`groupIntentAt`, `issueGroupOrders`), `render/battle/BattleDirector.tsx`, `render/battle/BattleOverlays.tsx` |
| Le rythme : les marches d'hommes différents jouées ensemble ; trois rangs (Écuyer, Chevalier, Baron) au conseil et dans les options ; l'adresse d'un camp (ADR-045) | `render/battle/BattleDirector.tsx` (`together`), `core/campaign/{types,validate,scenario}.ts` (`ranks`, `battleEffects`), `core/battle/conditions.ts` (`aimModifier`), `ui/campaign/Council.tsx` (`RankChoice`), `ui/campaign/battle-setup.ts` (`rank`), `scripts/campaign-scout.ts` (`--rank`) |
| La langue de l'époque : le lexique (sens et attestation de chaque mot), son écran, les mots soulignés qui donnent leur sens au survol (ADR-046) | `data/glossary.json`, `core/text/glossary.ts` (`validateGlossary`, `glossSegments`), `ui/components/Glossed.tsx`, `ui/screens/LexiconScreen.tsx` |
| La sommation : le héraut, la chance que la garnison cède, l'attente, le capitaine qui a juré (ADR-047) | `core/battle/summons.ts` (`previewSummons`, `resolveSummons`, `summonsWait`), réglages `data/damage.json` → `battle.summons`, `ui/battle/BattleHud.tsx` (`SummonButton`), `ui/screens/BattleScreen.tsx` (`summonsInfo`) |
| Les faits d'armes : le quatrième étendard d'un château, jugé à la fin ; la progression au format 2 (ADR-048) | `data/campaign.json` (`feat`), `core/campaign/scenario.ts` (`featDone`, `bannersOf`), `core/battle/{siege-tower,fire}.ts` (`climbed`, `burned`), `core/save/progress.ts`, `ui/screens/CampaignScreen.tsx` (`FeatNote`), `ui/campaign/battle-story.tsx` |
| Les tentes de l'ost : les marcs des étendards, les provisions pour le prochain siège, le mire ; la progression au format 3, la sauvegarde de bataille au format 2 (ADR-049) | `core/campaign/camp.ts` (`purse`, `canBuy`), `core/campaign/outcome.ts` (`withOutcome`, `withPurchase`, `withHealing`), `core/campaign/scenario.ts` (`battleEffects`), `data/campaign.json` (`camp`), `core/save/{progress,battle-save}.ts`, `ui/screens/CampaignScreen.tsx` (`TentsLetter`, `TentsNote`), `ui/campaign/CampaignMap.tsx` |
| La chronique enluminée : les faits d'une bataille gagnée, leur récit, les miniatures et les lettrines, l'impression (ADR-050) | `core/campaign/deeds.ts` (`deedsOf`), `core/battle/combat.ts` (`lossReason`), `ui/campaign/chronicle-text.ts` (`chronicleOf`), `ui/campaign/Miniature.tsx`, `ui/screens/ChronicleScreen.tsx`, `ui/screens/chronicle.css` (`@media print`), `data/campaign.json` (`chronicle`, `told`) |
| La musique d'époque : trois airs transcrits, les échantillons CC0 de la VCSL, le rendu hors ligne (échantillonneur, salle, niveau) ; un air par écran, chargé au premier geste, et la pièce qui clôt une bataille (ADR-051) | `scripts/music/{tunes,arrangements,samples}.json`, `scripts/music/{score,bank,dsp}.ts`, `scripts/render-music.ts`, `scripts/fetch-music-samples.ts`, `ui/ScreenMusic.tsx`, `audio/engine.ts` (`wanted`, `durationS`), `render/battle/BattleSoundscape.tsx` |
| Les saisons : un mois par château (la boue d'avril, les blés secs de juillet, les brouillas et le chaume d'octobre), leurs couleurs, leurs lignes dans les lettres, le briefing et la chronique ; « brouillas » pour le brouillard (ADR-052) | `data/damage.json` (`weather.seasons`), `core/battle/conditions.ts` (`seasonOf`, `mistSightM`, `groundOf`, `rulesOnGround`, `fireFactors`), `data/campaign.json` (`battle.season`, `seasons`), `render/materials/season-palette.ts` (`SEASON_PALETTES`, `turnLeaves`), `render/materials/painted-globals.ts` (`MIST_FOG`), `state/scene-conditions.ts` (`mist`), `ui/campaign/effects-text.ts` (`seasonLines`) |
| Ce que coûte une capacité (sa note sur la carte), qui peut encore agir (fin du tour, touche Tab) : une seule règle pour l'interface et le jeu (ADR-040) | `core/battle/heroes.ts` (`abilityCost`), `core/battle/turn.ts` (`canStillAct`), `ui/battle/actions.ts`, `ui/battle/end-turn.ts` |
| Sauvegardes : progression versionnée et relue strictement, fusion entre onglets ; bataille en cours (ordres + empreinte) reprise à l'identique (ADR-038) | `core/save/{progress,battle-save}.ts`, `state/{storage,campaign,battle-save}.ts`, `BattleSession.restore`, `ui/screens/BattleScreen.tsx` (`ResumeDialog`) |
| Sécurité du site : en-têtes et CSP, servis aussi par `vite preview` ; points d'accès de test réservés au développement | `vercel.json`, `vite.config.ts`, `ui/test-flags.ts` |
| Vérification automatique de chaque envoi (typage, lint, tests, build, audit) ; contrôle du site en ligne | `.github/workflows/ci.yml`, `scripts/check-live.ts` |
| Un clic fait la chose évidente : s'approcher d'abord ce tour (frapper, tirer, combler, miner, accoler, monter, flèche enflammée, gestes des héros), avancer au plus loin quand c'est trop loin, la fiche d'un homme au survol, des refus qui disent quoi faire ; le chemin tracé, des commandes ordinaires (ADR-039) | `core/battle/reach.ts` (`planApproach`, `planAdvance`), `ui/battle/intent.ts` (`intentAt`, `issueOrders`), `ui/battle/actions.ts` (`worksAtOnce`), `render/battle/BattleDirector.tsx`, `render/battle/BattleOverlays.tsx`, `ui/battle/BattleHud.tsx` |

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
- La **même `TerrainData`** (heightfield aux coins et couche par cellule de 1 m) alimente la navigation et le rendu : relief du mesh de terrain, splatmap, placement de la végétation. Le joueur ne voit jamais la grille.
- Le rendu peut ajouter du détail purement visuel (bruit de couleur, touffes d'herbe, cailloux), mais ne modifie jamais la navigation.
- La physique (Rapier) est cosmétique : débris et chutes. Aucun résultat physique ne remonte vers le core.

## Génération et chargement d'une bataille
- `generateBattleMap({ seed, castleIndex })` (`src/core/worldgen/battle.ts`) produit la carte en environ 1,8 s :
  - relief et butte du château, vallée et lit de la rivière, gué et pont ;
  - routes tracées par A* sur une grille de 4 m ;
  - château (courtine, tours, porte, donjon, douve), village le long de la route, fermes ;
  - parcelles de Voronoï bordées de haies, forêt à 30 % par quantile, arbres semés par Poisson ;
  - validation : Dijkstra sur toute la carte, au moins 3 approches d'assaut viables sur 5.
- `/battle` lance cette génération dans un **Web Worker** (`src/ui/workers/worldgen.worker.ts`). La disposition revient par clonage structuré, avec transfert des tableaux du terrain, puis la scène compile ses shaders. On mesure 5,5–5,7 s jusqu'à la scène prête (ADR-018).

## Rendu à l'échelle d'une carte de 500 m (budgets ADR-007)
| Couche | Technique | Fichier |
|---|---|---|
| Terrain | Chunks de 128 m, 3 LOD à jupes (pas 1 sous 140 m, 2 sous 300 m, puis 4), splat par cellule, détail triplanaire sur les pentes | `terrain/ChunkedTerrain.tsx`, `terrain-material.ts` |
| Anneau lointain | Collines basse résolution raccordées au bord (quads cachés sous la carte omis), bosquets de 20 faces | `terrain/DistantLandscape.tsx` |
| Arbres, buissons, fougères, haies | Un `BatchedMesh` par espèce. Deux LOD par instance selon la distance à la caméra. Culling grossier, réévalué seulement quand la caméra bouge : pas de boucle par instance à chaque frame (ADR-016) | `vegetation/lod-batch.ts` |
| Blé et seigle | Diffusés par chunks de 16 m autour du point de visée, deux niveaux, plafonnés ; lit de champ peint au-delà (ADR-017) | `fields/WheatField.tsx` |
| Herbe | Brins générés dans le vertex shader, dans un rayon autour du point de visée | `vegetation/Grass.tsx` |
| Château | Trois maillages fusionnés (pierre, toits, bois) | `castle/Castle.tsx`, `castle-parts.ts` |
| Unités | Un SkinnedMesh par unité (corps et arme en un atlas), un matériau par corps et par faction, bibliothèque de clips partagée | `units/Units.tsx` |

Diagnostic : `node scripts/capture-lookdev.ts <tag> --scene battle --breakdown` affiche les draw calls, les triangles et leur ventilation par famille d'objets.

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

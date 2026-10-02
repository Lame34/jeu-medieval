# Assets manquants et substituts — « Siège »

Règle : **aucun cube gris à l'écran**. Tout asset manquant est remplacé par un substitut stylisé cohérent (même palette et même PaintedMaterial) et consigné ici jusqu'à son remplacement définitif (objectif J7 : liste vide).

| Élément | Statut | Substitut actuel | Remplacement prévu | Jalon |
|---|---|---|---|---|
| Personnages (corps et tenues) | ✅ Quaternius RPG Characters (CC0), convertis en headless (ADR-014) : warrior, ranger, rogue, avec tabard d'allégeance et yeux peints | — | Cleric et monk sans tissu recolorable : ajouter le tabard seul s'ils servent (héraut, officier) | J2 |
| Épée du warrior au repos | Le clip `Idle` Quaternius tient la lame dressée au-dessus de la tête (silhouette « corne », revue v13) | Clip `Idle` | Clé de repos arme basse authorée en Blender headless, ou `Idle_Attacking` si la pose convient | J3 |
| Animation « tir à l'arc » | ✅ `Bow_Attack_Draw` et `Bow_Attack_Shoot` (ranger) | — | — | — |
| Arbalète (arbalétriers, archers de tour) | Absente des RPG Characters | Arc du ranger | Arbalète KayKit (déjà traitée dans `public/assets/weapons/`), à fusionner dans l'atlas, avec clé de visée | J3 |
| Lance, bouclier (soldat, mur de boucliers) | Absents | Dague du rogue | Props KayKit (boucliers déjà traités) ou Fantasy Props MegaKit, fusionnés dans l'atlas | J3 |
| Animations « cheer » et « push » (engins) | Absentes | `PickUp` / `Idle` | Clés authorées en Blender headless ou reciblage depuis l'Universal Animation Library | J3 |
| Monture de cavalerie | À valider | — | Cheval Quaternius CC0 (poly.pizza), cavalier sur l'os `Back` | J3 |
| Engins de siège | Bélier et catapulte générés (`npm run assets:engines`, un maillage skinné par engin) ; tour de siège à faire | — | Scripts Blender headless (`scripts/blender/build_siege_engines.py`) | J4 |
| Château | ✅ Kit procédural (`src/render/castle/`) : courtines, tours, donjon, porterie, pont-levis, pont de pierre | — | Tours carrées de porte, double enceinte (château 4) | J4 |
| Abords des maisons (brief §5.4) | Partiels (aires de terre battue) | — | Clôtures, tas de bois et puits issus du kit (`Prop_WoodenFence`, `Prop_Crate`, `Prop_Wagon`) | J3 |
| Audio | À sourcer | — | Kenney (CC0), OpenGameArt RandomMind (CC0) | J5 |

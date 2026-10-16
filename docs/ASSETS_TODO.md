# Assets manquants et substituts — « Siège »

Règle : **aucun cube gris à l'écran**. Tout asset manquant est remplacé par un substitut stylisé cohérent (même palette et même PaintedMaterial) et consigné ici jusqu'à son remplacement définitif (objectif J7 : liste vide).

| Élément | Statut | Substitut actuel | Remplacement prévu | Jalon |
|---|---|---|---|---|
| Personnages (corps et tenues) | ✅ Quaternius RPG Characters (CC0), convertis en headless (ADR-014) : warrior, ranger, rogue, avec tabard d'allégeance et yeux peints | — | Cleric et monk sans tissu recolorable : ajouter le tabard seul s'ils servent (héraut, officier) | J2 |
| Épée du warrior au repos | Le clip `Idle` Quaternius tient la lame dressée au-dessus de la tête (silhouette « corne », revue v13) | Clip `Idle` | Clé de repos arme basse authorée en Blender headless, ou `Idle_Attacking` si la pose convient | J3 |
| Animation « tir à l'arc » | ✅ `Bow_Attack_Draw` et `Bow_Attack_Shoot` (ranger) | — | — | — |
| Arbalète (arbalétriers, archers de tour) | Absente des RPG Characters | Arc du ranger | Arbalète KayKit (déjà traitée dans `public/assets/weapons/`), à fusionner dans l'atlas, avec clé de visée | J3 |
| Bouclier (soldat, garde de rempart) | ✅ Écu à talon construit par le code (`src/render/units/shield.ts`, ADR-037) : chevron d'or sur azur ou fasce de fer sur gueules, porté sur l'os du poing gauche | — | — | J7 |
| Lance (soldat) | Absente | Dague du rogue | Prop MegaKit sur l'os `Weapon.R`, ou lance construite par le code comme l'écu | J7+ |
| Animations « cheer » et « push » (engins) | Absentes | `PickUp` / `Idle` | Clés authorées en Blender headless ou reciblage depuis l'Universal Animation Library | J3 |
| Monture de cavalerie | Absente : la cavalerie (renfort d'un stratagème) a le corps du chevalier, à pied | Corps `warrior` | Cheval Quaternius CC0 (poly.pizza), cavalier sur l'os `Back` | J7+ |
| Engins de siège | ✅ Bélier, catapulte et tour de siège générés (`npm run assets:engines`, ADR-025) | — | — | J4 |
| Château | ✅ Kit procédural (`src/render/castle/`) : courtines, tours, donjon, porterie, pont-levis, pont de pierre | — | Tours carrées de porte, double enceinte (château 4) | J4 |
| Abords des maisons (brief §5.4) | ✅ Charrette, caisses et clôture derrière chaque maison, issues du kit (`src/render/buildings/houses.ts`) | — | Puits, tas de bois | J3 |
| Audio | ✅ Sons CC0 traités par Blender headless (ADR-033), crédités dans `assets/CREDITS.md` | — | — | J5 |
| Musique | ✅ Trois airs d'époque du domaine public, joués sur les échantillons CC0 de la VCSL et rendus par le jeu (ADR-051), crédités dans `assets/CREDITS.md` | — | — | Étape 5 |

# Inventaire des assets — Projet « Siège »

Inventaire généré le 2026-09-25 par l'asset-scout. Toutes les pièces glTF/GLB ont été inspectées avec `gltf-transform` (via `@gltf-transform/core`, mêmes données que `npx gltf-transform inspect`). Triangles = nombre de triangles rendus (primitives en mode TRIANGLES). Les scripts d'inspection temporaires utilisés (`assets-src/work/*.mjs`) sont conservés pour reproductibilité mais ne font pas partie des assets ; `assets-src/work/` est ignoré par git.

Sommaire :
1. [Medieval Village MegaKit](#1-medieval-village-megakit-quaternius-cc0) (Quaternius, CC0) — bâtiments, structures
2. [Stylized Nature MegaKit](#2-stylized-nature-megakit-quaternius-cc0) (Quaternius, CC0) — végétation, terrain
3. [Fantasy Props MegaKit](#3-fantasy-props-megakit-quaternius-cc0) (Quaternius, CC0) — mobilier, armes, objets
4. [Universal Animation Library (UAL 1)](#4-universal-animation-library-ual-1-quaternius-cc0) (Quaternius, CC0) — mannequin + 46 animations
5. [Universal Animation Library 2 (UAL 2)](#5-universal-animation-library-2-ual-2-quaternius-cc0) (Quaternius, CC0) — mannequin H/F + 43 animations
6. [Cheval (cavalerie)](#6-cheval-cavalerie-quaternius-cc0-via-polypizza) (Quaternius, CC0, via poly.pizza)
7. [Personnages — options évaluées](#7-personnages--options-évaluées) : KayKit Adventurers (retenu), RPG Characters Quaternius, Ultimate Animated Character Pack Quaternius
8. [Audio (J5)](#8-audio-j5---effets-ambiances-et-musique) (CC0 : Kenney, rubberduck, Still North Media, RandomMind, packs OGA) — 107 fichiers, 36,8 Mo

---
## 1. Medieval Village MegaKit (Quaternius, CC0)

- Source : `assets-src/raw/medieval-village-megakit/medieval_village_megakitstandard.zip`
- Licence dans l'archive (`License_Standard.txt`) : **CC0 1.0 Universal — Public Domain Dedication**. Version « Standard » gratuite (sous-ensemble des modèles ; version PRO/SOURCE payante non utilisée).
- Formats fournis : `glTF/` (utilisé pour l'inventaire), `FBX/`, `OBJ/`, `Textures/` (+ variante `Normals Godot-Unity/`).
- **176 pièces glTF** inspectées (0 erreur).
- Triangles : min **4**, médiane **126**, max **6 356**, total cumulé **117 880** tris sur l'ensemble du kit.
- Aucune pièce n'a de squelette/animation (mobilier statique de bâtiment).
- **Trim sheets partagées** (texturage par nappe de motifs, pas d'atlas par pièce) — 22 textures uniques au total pour 176 pièces :
  - `T_WoodTrim_{BaseColor,Normal,Roughness}` 2048×2048 → 136 pièces (charpente/bois, l'essentiel du kit)
  - `T_Plaster_{BaseColor,Normal,ORM}` 2048×2048 → 47 pièces (colombage/torchis)
  - `T_RockTrim_{BaseColor,Normal,ORM}` 2048×2048 → 26 pièces
  - `T_Brick_{BaseColor,Normal,Roughness}` 2048×2048 → 22-23 pièces
  - `T_RoundTiles_{BaseColor,Normal,Roughness}` 2048×2048 → 19 pièces (toitures)
  - `T_UnevenBrick_{BaseColor,Normal,Roughness}` 2048×2048 → 18 pièces
  - `T_MetalOrnaments_{BaseColor 1024², Roughness 512²}` → 9 pièces
  - `T_RedBrick_BaseColor` 2048×2048, `T_VineLeaf.png` 512×512 (usage ponctuel)
- Notes d'usage : kit modulaire (murs, coins, fenêtres, balcons, toits) conçu pour un assemblage par grille — bien adapté à la construction procédurale d'un village/siège. Pas de portails de forteresse massifs ni de tours de siège dans ce kit (voir Fantasy Props pour le mobilier de siège/armes).

### Détail par pièce

| Pièce | Triangles | Matériaux | Familles de textures | Squelette | Animations |
|---|---|---|---|---|---|
| Balcony_Cross_Corner | 264 | 1 | T_WoodTrim | — | — |
| Balcony_Cross_Straight | 132 | 1 | T_WoodTrim | — | — |
| Balcony_Simple_Corner | 2240 | 1 | T_WoodTrim | — | — |
| Balcony_Simple_Straight | 1120 | 1 | T_WoodTrim | — | — |
| Corner_Exterior_Brick | 3102 | 1 | T_RockTrim | — | — |
| Corner_Exterior_TopDown | 16 | 1 | T_WoodTrim | — | — |
| Corner_Exterior_TopOnly | 8 | 1 | T_WoodTrim | — | — |
| Corner_Exterior_Wood | 12 | 1 | T_WoodTrim | — | — |
| Corner_ExteriorWide_Brick | 2882 | 1 | T_RockTrim | — | — |
| Corner_ExteriorWide_Wood | 36 | 1 | T_WoodTrim | — | — |
| Corner_Interior_Big | 24 | 1 | T_WoodTrim | — | — |
| Corner_Interior_Small | 12 | 1 | T_WoodTrim | — | — |
| Door_1_Flat | 314 | 2 | T_WoodTrim | — | — |
| Door_1_Round | 470 | 2 | T_WoodTrim | — | — |
| Door_2_Flat | 6032 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| Door_2_Round | 6188 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| Door_4_Flat | 1044 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| Door_4_Round | 1228 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| Door_8_Flat | 986 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| Door_8_Round | 1142 | 2 | T_WoodTrim, T_MetalOrnaments | — | — |
| DoorFrame_Flat_Brick | 1880 | 1 | T_RockTrim | — | — |
| DoorFrame_Flat_WoodDark | 56 | 1 | T_WoodTrim | — | — |
| DoorFrame_Round_Brick | 2046 | 1 | T_RockTrim | — | — |
| DoorFrame_Round_WoodDark | 320 | 1 | T_WoodTrim | — | — |
| Floor_Brick | 4 | 1 | T_Brick | — | — |
| Floor_RedBrick | 4 | 1 | T_Brick, T_RedBrick | — | — |
| Floor_UnevenBrick | 4 | 1 | T_UnevenBrick | — | — |
| Floor_WoodDark_Half1 | 32 | 1 | T_WoodTrim | — | — |
| Floor_WoodDark_Half2 | 32 | 1 | T_WoodTrim | — | — |
| Floor_WoodDark_Half3 | 16 | 1 | T_WoodTrim | — | — |
| Floor_WoodDark_OverhangCorner | 16 | 1 | T_WoodTrim | — | — |
| Floor_WoodDark_OverhangCorner2 | 26 | 1 | T_WoodTrim | — | — |
| Floor_WoodDark | 32 | 1 | T_WoodTrim | — | — |
| Floor_WoodLight_OverhangCorner | 16 | 1 | T_WoodTrim | — | — |
| Floor_WoodLight_OverhangCorner2 | 26 | 1 | T_WoodTrim | — | — |
| Floor_WoodLight | 32 | 1 | T_WoodTrim | — | — |
| HoleCover_90Angle | 20 | 1 | T_WoodTrim | — | — |
| HoleCover_90Half | 16 | 1 | T_WoodTrim | — | — |
| HoleCover_90Stairs | 18 | 1 | T_WoodTrim | — | — |
| HoleCover_Straight | 12 | 1 | T_WoodTrim | — | — |
| HoleCover_StraightHalf | 10 | 1 | T_WoodTrim | — | — |
| Overhang_Plaster_Corner_Front | 142 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Plaster_Corner | 440 | 2 | T_Plaster, T_WoodTrim | — | — |
| Overhang_Plaster_Long | 204 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Plaster_Short | 222 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Roof_Plaster | 38 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Roof_UnevenBricks | 38 | 2 | T_WoodTrim, T_UnevenBrick | — | — |
| Overhang_RoofIncline_Plaster | 36 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_RoofIncline_UnevenBricks | 36 | 2 | T_WoodTrim, T_UnevenBrick | — | — |
| Overhang_Side_Plaster_Long_L | 314 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Side_Plaster_Long_R | 314 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Side_Plaster_Short_L | 302 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Side_Plaster_Short_R | 302 | 2 | T_WoodTrim, T_Plaster | — | — |
| Overhang_Side_UnevenBrick_Long_L | 292 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_Side_UnevenBrick_Long_R | 292 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_Side_UnevenBrick_Short_L | 294 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_Side_UnevenBrick_Short_R | 294 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_UnevenBrick_Corner_Front | 60 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_UnevenBrick_Corner | 420 | 3 | T_Plaster, T_WoodTrim, T_UnevenBrick | — | — |
| Overhang_UnevenBrick_Long | 196 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Overhang_UnevenBrick_Short | 214 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Prop_Brick1 | 108 | 1 | T_RockTrim | — | — |
| Prop_Brick2 | 94 | 1 | T_RockTrim | — | — |
| Prop_Brick3 | 126 | 1 | T_RockTrim | — | — |
| Prop_Brick4 | 126 | 1 | T_RockTrim | — | — |
| Prop_Chimney | 618 | 2 | T_RockTrim, T_Brick | — | — |
| Prop_Chimney2 | 130 | 1 | T_UnevenBrick | — | — |
| Prop_Crate | 230 | 1 | T_WoodTrim | — | — |
| Prop_ExteriorBorder_Corner | 18 | 1 | T_RockTrim | — | — |
| Prop_ExteriorBorder_Straight1 | 16 | 1 | T_RockTrim | — | — |
| Prop_ExteriorBorder_Straight2 | 16 | 1 | T_RockTrim | — | — |
| Prop_MetalFence_Ornament | 3988 | 1 | T_MetalOrnaments | — | — |
| Prop_MetalFence_Simple | 2744 | 1 | T_MetalOrnaments | — | — |
| Prop_Support | 16 | 1 | T_WoodTrim | — | — |
| Prop_Vine1 | 82 | 1 | T_VineLeaf.png | — | — |
| Prop_Vine2 | 45 | 1 | T_VineLeaf.png | — | — |
| Prop_Vine4 | 31 | 1 | T_VineLeaf.png | — | — |
| Prop_Vine5 | 117 | 1 | T_VineLeaf.png | — | — |
| Prop_Vine6 | 114 | 1 | T_VineLeaf.png | — | — |
| Prop_Vine9 | 44 | 1 | T_VineLeaf.png | — | — |
| Prop_Wagon | 1672 | 1 | T_WoodTrim | — | — |
| Prop_WoodenFence_Extension1 | 32 | 1 | T_WoodTrim | — | — |
| Prop_WoodenFence_Extension2 | 28 | 1 | T_WoodTrim | — | — |
| Prop_WoodenFence_Single | 40 | 1 | T_WoodTrim | — | — |
| Roof_2x4_RoundTile | 1112 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_Dormer_RoundTile | 904 | 4 | T_WoodTrim, T_Plaster, T_RoundTiles | — | — |
| Roof_Front_Brick2 | 78 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick4_Half_L | 140 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick4_Half_R | 146 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick4 | 252 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick6_Half_L | 186 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick6_Half_R | 186 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick6 | 328 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick8_Half_L | 204 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick8_Half_R | 204 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_Front_Brick8 | 364 | 2 | T_WoodTrim, T_Plaster | — | — |
| Roof_FrontSupports | 60 | 1 | T_WoodTrim | — | — |
| Roof_Log | 164 | 1 | T_WoodTrim | — | — |
| Roof_Modular_RoundTiles | 136 | 1 | T_RoundTiles | — | — |
| Roof_RoundTile_2x1_Long | 628 | 2 | T_RoundTiles, T_WoodTrim | — | — |
| Roof_RoundTile_2x1 | 612 | 2 | T_RoundTiles, T_WoodTrim | — | — |
| Roof_RoundTiles_4x4 | 1996 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_4x6 | 2520 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_4x8 | 3116 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_6x10 | 4300 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_6x12 | 4752 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_6x14 | 5372 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_6x4 | 2192 | 2 | T_RoundTiles, T_WoodTrim | — | — |
| Roof_RoundTiles_6x6 | 3244 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_6x8 | 3796 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_8x10 | 4480 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_8x12 | 6356 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_8x14 | 5484 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_RoundTiles_8x8 | 3888 | 2 | T_WoodTrim, T_RoundTiles | — | — |
| Roof_Support2 | 84 | 1 | T_WoodTrim | — | — |
| Roof_Tower_RoundTiles | 4024 | 4 | T_WoodTrim, T_RockTrim, T_RoundTiles, T_MetalOrnaments | — | — |
| Roof_Wooden_2x1_Center_Mirror | 52 | 2 | T_WoodTrim | — | — |
| Roof_Wooden_2x1_Center | 52 | 2 | T_WoodTrim | — | — |
| Roof_Wooden_2x1_Corner | 82 | 2 | T_WoodTrim | — | — |
| Roof_Wooden_2x1_L | 158 | 2 | T_WoodTrim | — | — |
| Roof_Wooden_2x1_Middle | 24 | 1 | T_WoodTrim | — | — |
| Roof_Wooden_2x1_R | 158 | 2 | T_WoodTrim | — | — |
| Roof_Wooden_2x1 | 224 | 2 | T_WoodTrim | — | — |
| Stair_Interior_Rails | 3144 | 1 | T_WoodTrim | — | — |
| Stair_Interior_Simple | 208 | 1 | T_WoodTrim | — | — |
| Stair_Interior_Solid | 306 | 1 | T_WoodTrim | — | — |
| Stair_Interior_SolidExtended | 376 | 1 | T_WoodTrim | — | — |
| Stairs_Exterior_NoFirstStep | 52 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Platform | 32 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Platform45 | 55 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Platform45Clean | 45 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_PlatformU | 68 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_SidePlatform | 30 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Sides | 16 | 1 | T_Brick | — | — |
| Stairs_Exterior_Sides45 | 28 | 1 | T_Brick | — | — |
| Stairs_Exterior_SidesU | 56 | 1 | T_Brick | — | — |
| Stairs_Exterior_SingleSide | 12 | 1 | T_Brick | — | — |
| Stairs_Exterior_SingleSideThick | 12 | 1 | T_Brick | — | — |
| Stairs_Exterior_Straight_Center | 50 | 1 | T_RockTrim | — | — |
| Stairs_Exterior_Straight_L | 56 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Straight_R | 56 | 2 | T_RockTrim, T_Brick | — | — |
| Stairs_Exterior_Straight | 62 | 2 | T_RockTrim, T_Brick | — | — |
| Wall_Arch | 196 | 1 | T_WoodTrim | — | — |
| Wall_BottomCover | 36 | 1 | T_WoodTrim | — | — |
| Wall_Plaster_Door_Flat | 92 | 3 | T_WoodTrim, T_Plaster, T_RockTrim | — | — |
| Wall_Plaster_Door_Round | 137 | 3 | T_WoodTrim, T_Plaster, T_RockTrim | — | — |
| Wall_Plaster_Door_RoundInset | 180 | 3 | T_WoodTrim, T_Plaster, T_RockTrim | — | — |
| Wall_Plaster_Straight_Base | 64 | 3 | T_WoodTrim, T_Plaster, T_Brick | — | — |
| Wall_Plaster_Straight_L | 72 | 3 | T_WoodTrim, T_Plaster, T_Brick | — | — |
| Wall_Plaster_Straight_R | 72 | 3 | T_WoodTrim, T_Plaster, T_Brick | — | — |
| Wall_Plaster_Straight | 86 | 2 | T_WoodTrim, T_Plaster | — | — |
| Wall_Plaster_Window_Thin_Round | 166 | 3 | T_Plaster, T_Brick, T_WoodTrim | — | — |
| Wall_Plaster_Window_Wide_Flat | 96 | 3 | T_Plaster, T_Brick, T_WoodTrim | — | — |
| Wall_Plaster_Window_Wide_Flat2 | 122 | 2 | T_WoodTrim, T_Plaster | — | — |
| Wall_Plaster_Window_Wide_Round | 124 | 3 | T_WoodTrim, T_Plaster, T_Brick | — | — |
| Wall_Plaster_WoodGrid | 248 | 2 | T_WoodTrim, T_Plaster | — | — |
| Wall_UnevenBrick_Door_Flat | 74 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Wall_UnevenBrick_Door_Round | 136 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Wall_UnevenBrick_Straight | 56 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Wall_UnevenBrick_Window_Thin_Round | 158 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Wall_UnevenBrick_Window_Wide_Flat | 88 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Wall_UnevenBrick_Window_Wide_Round | 116 | 3 | T_WoodTrim, T_Plaster, T_UnevenBrick | — | — |
| Window_Roof_Thin | 46 | 2 | T_WoodTrim | — | — |
| Window_Roof_Wide | 66 | 2 | T_WoodTrim | — | — |
| Window_Thin_Flat1 | 112 | 2 | T_WoodTrim | — | — |
| Window_Thin_Round1 | 418 | 2 | T_WoodTrim | — | — |
| Window_Wide_Flat1 | 160 | 2 | T_WoodTrim | — | — |
| Window_Wide_Round1 | 354 | 2 | T_WoodTrim | — | — |
| WindowShutters_Thin_Flat_Closed | 96 | 1 | T_WoodTrim | — | — |
| WindowShutters_Thin_Flat_Open | 96 | 1 | T_WoodTrim | — | — |
| WindowShutters_Thin_Round_Closed | 112 | 1 | T_WoodTrim | — | — |
| WindowShutters_Thin_Round_Open | 112 | 1 | T_WoodTrim | — | — |
| WindowShutters_Wide_Flat_Closed | 120 | 1 | T_WoodTrim | — | — |
| WindowShutters_Wide_Flat_Open | 120 | 1 | T_WoodTrim | — | — |
| WindowShutters_Wide_Round_Closed | 136 | 1 | T_WoodTrim | — | — |
| WindowShutters_Wide_Round_Open | 136 | 1 | T_WoodTrim | — | — |

---

## 2. Stylized Nature MegaKit (Quaternius, CC0)

- Source : `assets-src/raw/stylized-nature-megakit/stylized_nature_megakitstandard.zip`
- Licence dans l'archive (`License_Standard.txt`) : **CC0 1.0 Universal — Public Domain Dedication**. Version « Standard » gratuite (68/116 modèles ; PRO/SOURCE payantes non utilisées).
- Formats fournis : `glTF/`, `FBX/`, `FBX (Unity)/`, `OBJ/`, `Textures/`.
- **68 pièces glTF** inspectées (0 erreur).
- Triangles : min **13**, médiane **755**, max **10 104** (un rocher/relief détaillé), total cumulé **148 947** tris.
- Aucune pièce n'a de squelette/animation (végétation statique).
- **Feuilles en alpha cutout confirmé** : matériaux de feuillage (`Leaves*`, `Leaf_Pine_C`) et d'écorce (`Bark_*`) inspectés en détail sur `CommonTree_1` → `alphaMode: MASK`, `doubleSided: true` pour les deux matériaux (écorce et feuillage). À reproduire pour toutes les pièces d'arbres/buissons dans le moteur (three.js : `material.alphaTest` + `side: THREE.DoubleSide`, pas de tri de transparence nécessaire grâce au MASK).
- **Textures partagées** (atlas), 15 textures uniques au total :
  - `Bark_NormalTree`/`_Normal` 2048² → 10 pièces ; `Bark_DeadTree`/`_Normal` 2048² → 5 ; `Bark_TwistedTree`/`_Normal` 2048² → 5
  - `Leaves` 2048² → 11 pièces (atlas de feuillage générique) ; `Leaves_NormalTree_C` 1024² → 6 ; `Leaves_TwistedTree_C` 1024² → 6 ; `Leaf_Pine_C` 2048² → 5
  - `Flowers` 1008×981 → 10 ; `Grass` 512² → 4 ; `Mushrooms` 1024² → 2
  - `PathRocks_Diffuse` 1024² → 21 pièces (le plus partagé : rochers/chemins) ; `Rocks_Diffuse` 2048² → 3
- Notes d'usage : bon complément pour le terrain autour du village/siège (arbres, rochers, buissons, fleurs). Pas de relief/terrain de base (heightmap) ni de texture de sol autre que les rochers — le sol/herbe du jeu devra venir d'ailleurs (shader procédural ou texture séparée).

### Détail par pièce

| Pièce | Triangles | Matériaux | Familles de textures | Squelette | Animations |
|---|---|---|---|---|---|
| Bush_Common_Flowers | 1368 | 2 | Leaves_NormalTree_C, Flowers | — | — |
| Bush_Common | 900 | 1 | Leaves_TwistedTree_C | — | — |
| Clover_1 | 379 | 1 | Leaves | — | — |
| Clover_2 | 615 | 1 | Leaves | — | — |
| CommonTree_1 | 6265 | 2 | Bark_NormalTree, Leaves_NormalTree_C | — | — |
| CommonTree_2 | 5648 | 2 | Bark_NormalTree, Leaves_NormalTree_C | — | — |
| CommonTree_3 | 3505 | 2 | Bark_NormalTree, Leaves_NormalTree_C | — | — |
| CommonTree_4 | 4066 | 2 | Bark_NormalTree, Leaves_NormalTree_C | — | — |
| CommonTree_5 | 3182 | 2 | Bark_NormalTree, Leaves_NormalTree_C | — | — |
| DeadTree_1 | 6169 | 1 | Bark_DeadTree | — | — |
| DeadTree_2 | 6557 | 1 | Bark_DeadTree | — | — |
| DeadTree_3 | 5802 | 1 | Bark_DeadTree | — | — |
| DeadTree_4 | 5702 | 1 | Bark_DeadTree | — | — |
| DeadTree_5 | 5648 | 1 | Bark_DeadTree | — | — |
| Fern_1 | 288 | 1 | Leaves | — | — |
| Flower_3_Group | 755 | 2 | Leaves, Flowers | — | — |
| Flower_3_Single | 285 | 2 | Leaves, Flowers | — | — |
| Flower_4_Group | 1690 | 2 | Leaves, Flowers | — | — |
| Flower_4_Single | 642 | 2 | Leaves, Flowers | — | — |
| Grass_Common_Short | 155 | 1 | Grass | — | — |
| Grass_Common_Tall | 326 | 1 | Grass | — | — |
| Grass_Wispy_Short | 494 | 1 | Grass | — | — |
| Grass_Wispy_Tall | 622 | 1 | Grass | — | — |
| Mushroom_Common | 880 | 1 | Mushrooms | — | — |
| Mushroom_Laetiporus | 3216 | 1 | Mushrooms | — | — |
| Pebble_Round_1 | 136 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Round_2 | 114 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Round_3 | 128 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Round_4 | 126 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Round_5 | 124 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_1 | 104 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_2 | 78 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_3 | 52 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_4 | 48 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_5 | 72 | 1 | PathRocks_Diffuse | — | — |
| Pebble_Square_6 | 65 | 1 | PathRocks_Diffuse | — | — |
| Petal_1 | 13 | 1 | Flowers | — | — |
| Petal_2 | 15 | 1 | Flowers | — | — |
| Petal_3 | 15 | 1 | Flowers | — | — |
| Petal_4 | 30 | 1 | Flowers | — | — |
| Petal_5 | 15 | 1 | Flowers | — | — |
| Pine_1 | 3947 | 2 | Bark_NormalTree, Leaf_Pine_C | — | — |
| Pine_2 | 3648 | 2 | Bark_NormalTree, Leaf_Pine_C | — | — |
| Pine_3 | 4964 | 2 | Bark_NormalTree, Leaf_Pine_C | — | — |
| Pine_4 | 3370 | 2 | Bark_NormalTree, Leaf_Pine_C | — | — |
| Pine_5 | 1646 | 2 | Bark_NormalTree, Leaf_Pine_C | — | — |
| Plant_1_Big | 360 | 1 | Leaves | — | — |
| Plant_1 | 120 | 1 | Leaves | — | — |
| Plant_7_Big | 112 | 1 | Leaves | — | — |
| Plant_7 | 48 | 1 | Leaves | — | — |
| Rock_Medium_1 | 342 | 1 | Rocks_Diffuse | — | — |
| Rock_Medium_2 | 244 | 1 | Rocks_Diffuse | — | — |
| Rock_Medium_3 | 522 | 1 | Rocks_Diffuse | — | — |
| RockPath_Round_Small_1 | 998 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Round_Small_2 | 1126 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Round_Small_3 | 1002 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Round_Thin | 2254 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Round_Wide | 3500 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Square_Small_1 | 783 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Square_Small_2 | 559 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Square_Small_3 | 568 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Square_Thin | 1793 | 1 | PathRocks_Diffuse | — | — |
| RockPath_Square_Wide | 2256 | 1 | PathRocks_Diffuse | — | — |
| TwistedTree_1 | 9564 | 2 | Bark_TwistedTree, Leaves_TwistedTree_C | — | — |
| TwistedTree_2 | 9134 | 2 | Bark_TwistedTree, Leaves_TwistedTree_C | — | — |
| TwistedTree_3 | 10089 | 2 | Bark_TwistedTree, Leaves_TwistedTree_C | — | — |
| TwistedTree_4 | 9600 | 2 | Bark_TwistedTree, Leaves_TwistedTree_C | — | — |
| TwistedTree_5 | 10104 | 2 | Bark_TwistedTree, Leaves_TwistedTree_C | — | — |

---

## 3. Fantasy Props MegaKit (Quaternius, CC0)

- Source : `assets-src/raw/fantasy-props-megakit/fantasy_props_megakitstandard.zip`
- Licence dans l'archive (`License_Standard.txt`) : **CC0 1.0 Universal — Public Domain Dedication**. Version « Standard » gratuite (PRO/SOURCE payantes non utilisées).
- Formats fournis : `Exports/glTF/`, `Exports/FBX/`, `Exports/OBJ/`, `Textures/` (+ variante `Normals-UnrealEngine/`).
- **Anomalie de packaging corrigée** : les fichiers `.gltf` de `Exports/glTF/` référencent leurs textures par un chemin relatif nu (ex. `"uri":"T_Trim_Furniture_Normal.png"`) alors que les PNG ne sont physiquement livrés que dans `../Textures/`. Sans correction, ~20 pièces (tous les objets utilisant les trim sheets Furniture/Metal/Props/Cloth) ne chargent pas leurs textures. **Correction appliquée** : les 13 textures référencées ont été copiées depuis `Textures/` vers `Exports/glTF/` (copie simple, `cp -n`, aucune modification des `.gltf` eux-mêmes ni de l'archive zip d'origine — le SHA-256 du zip reste la référence d'intégrité). À refaire si l'archive est re-dézippée depuis zéro.
- **94 pièces glTF** inspectées (0 erreur après correction).
- Triangles : min **52**, médiane **776**, max **5 738**, total cumulé **121 603** tris.
- Une seule pièce animée : **`Chest_Wood`** (coffre en bois), squelette à 3 os (charnière du couvercle, racine `Root`), 4 clips : `Chest_Close, Chest_Closed, Chest_Open, Chest_Opened`.
- **Trim sheets partagées**, 13 textures uniques au total :
  - `T_Trim_Metal_{BaseColor,Normal,ORM}` 2048² → 60 pièces (le plus utilisé : ferrures, armes, éléments métalliques)
  - `T_Trim_Furniture_{BaseColor,Normal,ORM}` 2048² → 41 pièces (mobilier bois)
  - `T_Trim_Props_{BaseColor,Normal,ORM}` 2048² → 39 pièces (objets divers, poteries, etc.)
  - `T_Trim_Cloth_{BaseColor,Normal,ORM}` 2048² → 10 pièces (bannières, tissus)
  - `T_Page_Noise` 4096² → 2 pièces (livres)
- **Armes/armures disponibles** : seulement `Axe_Bronze`, `Sword_Bronze`, `Pickaxe_Bronze`, `Shield_Wooden` — pas de gamme complète d'armes de siège.
- **Gap important pour un jeu « Siège »** : ce kit ne contient **aucun équipement de siège** (catapulte, trébuchet, bélier, tour de siège, échelle d'assaut) ni de mur fortifié crénelé/porte-herse — ni le Medieval Village MegaKit ni ce kit ne couvrent ce besoin. Une passe de sourcing dédiée (J2) sera nécessaire pour ces pièces spécifiques.

### Détail par pièce

| Pièce | Triangles | Matériaux | Familles de textures | Squelette | Animations |
|---|---|---|---|---|---|
| Anvil_Log | 3808 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Props | — | — |
| Anvil | 750 | 1 | T_Trim_Metal | — | — |
| Axe_Bronze | 826 | 1 | T_Trim_Props | — | — |
| Bag | 858 | 2 | T_Trim_Cloth, T_Trim_Furniture | — | — |
| Banner_1_Cloth | 138 | 2 | T_Trim_Metal, T_Trim_Cloth | — | — |
| Banner_1 | 448 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Cloth | — | — |
| Banner_2_Cloth | 119 | 2 | T_Trim_Metal, T_Trim_Cloth | — | — |
| Banner_2 | 429 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Cloth | — | — |
| Barrel_Apples | 2480 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Props | — | — |
| Barrel_Holder | 2676 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Barrel | 824 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Bed_Twin1 | 1600 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Cloth | — | — |
| Bed_Twin2 | 1584 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Cloth | — | — |
| Bench | 404 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Book_5 | 96 | 1 | T_Trim_Props | — | — |
| Book_7 | 724 | 2 | T_Trim_Props, T_Trim_Metal | — | — |
| Book_Simplified_Single | 52 | 1 | T_Trim_Props | — | — |
| Book_Stack_1 | 208 | 1 | T_Trim_Props | — | — |
| Book_Stack_2 | 446 | 2 | T_Trim_Props, T_Trim_Metal | — | — |
| Bookcase_2 | 2148 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| BookGroup_Medium_1 | 416 | 1 | T_Trim_Props | — | — |
| BookGroup_Medium_2 | 468 | 1 | T_Trim_Props | — | — |
| BookGroup_Medium_3 | 468 | 1 | T_Trim_Props | — | — |
| BookGroup_Small_1 | 104 | 1 | T_Trim_Props | — | — |
| BookGroup_Small_2 | 104 | 1 | T_Trim_Props | — | — |
| BookGroup_Small_3 | 130 | 1 | T_Trim_Props | — | — |
| BookStand | 1526 | 1 | T_Trim_Furniture | — | — |
| Bottle_1 | 312 | 1 | T_Trim_Props | — | — |
| Bucket_Metal | 540 | 1 | T_Trim_Metal | — | — |
| Bucket_Wooden_1 | 976 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Cabinet | 2388 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Cage_Small | 4588 | 1 | T_Trim_Metal | — | — |
| Candle_1 | 212 | 1 | T_Trim_Props | — | — |
| Candle_2 | 210 | 1 | T_Trim_Props | — | — |
| CandleStick_Stand | 5738 | 2 | T_Trim_Metal, T_Trim_Props | — | — |
| CandleStick_Triple | 2528 | 2 | T_Trim_Metal, T_Trim_Props | — | — |
| CandleStick | 730 | 1 | T_Trim_Metal | — | — |
| Carrot | 634 | 1 | T_Trim_Props | — | — |
| Cauldron | 2020 | 1 | T_Trim_Metal | — | — |
| Chain_Coil | 3744 | 1 | T_Trim_Metal | — | — |
| Chair_1 | 496 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Chalice | 458 | 1 | T_Trim_Metal | — | — |
| Chandelier | 5680 | 3 | T_Trim_Metal, T_Trim_Furniture, T_Trim_Props | — | — |
| Chest_Wood | 2546 | 2 | T_Trim_Furniture, T_Trim_Metal | 3 os; root=Root | 4: Chest_Close, Chest_Closed, Chest_Open, Chest_Opened |
| Coin_Pile_2 | 1062 | 1 | T_Trim_Metal | — | — |
| Coin_Pile | 960 | 1 | T_Trim_Metal | — | — |
| Coin | 304 | 1 | T_Trim_Metal | — | — |
| Crate_Metal | 2738 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Crate_Wooden | 1576 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Dummy | 2858 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Cloth | — | — |
| FarmCrate_Apple | 4028 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Props | — | — |
| FarmCrate_Carrot | 5262 | 3 | T_Trim_Props, T_Trim_Furniture, T_Trim_Metal | — | — |
| FarmCrate_Empty | 1928 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Key_Gold | 1366 | 1 | T_Trim_Metal | — | — |
| Key_Metal | 546 | 1 | T_Trim_Metal | — | — |
| Lantern_Wall | 2822 | 1 | T_Trim_Metal | — | — |
| Mug | 268 | 2 | T_Trim_Metal, T_Trim_Furniture | — | — |
| Nightstand_Shelf | 262 | 1 | T_Trim_Furniture | — | — |
| Peg_Rack | 712 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Pickaxe_Bronze | 776 | 1 | T_Trim_Props | — | — |
| Pot_1_Lid | 1292 | 1 | T_Trim_Metal | — | — |
| Pot_1 | 1068 | 1 | T_Trim_Metal | — | — |
| Potion_1 | 440 | 1 | T_Trim_Props | — | — |
| Potion_2 | 472 | 1 | T_Trim_Props | — | — |
| Potion_4 | 536 | 1 | T_Trim_Props | — | — |
| Pouch_Large | 730 | 2 | T_Trim_Props, T_Trim_Metal | — | — |
| Rope_1 | 1748 | 1 | T_Trim_Furniture | — | — |
| Rope_2 | 1460 | 1 | T_Trim_Furniture | — | — |
| Rope_3 | 1748 | 1 | T_Trim_Furniture | — | — |
| Scroll_1 | 512 | 2 | T_Page_Noise, T_Trim_Props | — | — |
| Scroll_2 | 672 | 2 | T_Page_Noise, T_Trim_Props | — | — |
| Shelf_Arch | 1286 | 2 | T_Trim_Metal, T_Trim_Furniture | — | — |
| Shelf_Simple | 480 | 1 | T_Trim_Furniture | — | — |
| Shelf_Small_Bottles | 5234 | 3 | T_Trim_Props, T_Trim_Metal, T_Trim_Furniture | — | — |
| Shield_Wooden | 1404 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Props | — | — |
| SmallBottle | 130 | 1 | T_Trim_Props | — | — |
| SmallBottles_1 | 486 | 1 | T_Trim_Props | — | — |
| Stall_Cart_Empty | 3936 | 3 | T_Trim_Metal, T_Trim_Furniture, T_Trim_Cloth | — | — |
| Stall_Empty | 1496 | 3 | T_Trim_Metal, T_Trim_Furniture, T_Trim_Cloth | — | — |
| Stool | 152 | 1 | T_Trim_Furniture | — | — |
| Sword_Bronze | 1540 | 1 | T_Trim_Props | — | — |
| Table_Fork | 108 | 1 | T_Trim_Metal | — | — |
| Table_Knife | 54 | 1 | T_Trim_Metal | — | — |
| Table_Large | 986 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Table_Plate | 172 | 1 | T_Trim_Metal | — | — |
| Table_Spoon | 164 | 1 | T_Trim_Metal | — | — |
| Torch_Metal | 970 | 1 | T_Trim_Metal | — | — |
| Vase_2 | 598 | 1 | T_Trim_Props | — | — |
| Vase_4 | 598 | 1 | T_Trim_Props | — | — |
| Vase_Rubble_Medium | 1113 | 1 | T_Trim_Props | — | — |
| WeaponStand | 2084 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Whetstone | 1100 | 3 | T_Trim_Furniture, T_Trim_Metal, T_Trim_Props | — | — |
| Workbench_Drawers | 364 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |
| Workbench | 1368 | 2 | T_Trim_Furniture, T_Trim_Metal | — | — |

---

## 4. Universal Animation Library (UAL 1) (Quaternius, CC0)

- Source : `assets-src/raw/universal-animation-library/universal_animation_librarystandard.zip`
- Licence dans l'archive (`Animation Library[Standard]/License.txt`) : **CC0 1.0 Universal — Public Domain Dedication**.
- Fichier retenu pour l'inspection : `Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb` (variantes Unity/Unreal Engine également présentes dans l'archive, non inspectées — mêmes données).
- **Contient un corps skinné complet** (pas seulement un squelette nu) : mesh « Mannequin », 2 primitives, **13 744 triangles**, 8 546 sommets.
- Matériaux : `M_Main` (couleur plate orange, baseColorFactor ≈ [0.80, 0.40, 0.04, 1], metallic 0 / roughness 0.5) et `M_Joints` (couleur plate violette, baseColorFactor ≈ [0.40, 0.13, 0.71, 1]) — **aucune texture** (mannequin de démonstration à couleurs plates, pas un personnage habillé/texturé).
- Squelette : nœud racine `Rig` → `Mannequin` + `root`, **53 os**, nommage **Blender/Rigify (`DEF-`)** : `root, DEF-hips, DEF-spine.001-003, DEF-neck, DEF-head, DEF-shoulder.L/R, DEF-upper_arm.L/R, DEF-forearm.L/R, DEF-hand.L/R`, doigts (`DEF-f_index/middle/pinky/ring.01-03.L/R`, `DEF-thumb.01-03.L/R`, 3 phalanges, **pas d'os « leaf » terminaux**), jambes (`DEF-thigh/shin/foot/toe.L/R`).
- **46 clips d'animation** : `A_TPose, Crouch_Fwd_Loop, Crouch_Idle_Loop, Dance_Loop, Death01, Driving_Loop, Fixing_Kneeling, Hit_Chest, Hit_Head, Idle_Loop, Idle_Talking_Loop, Idle_Torch_Loop, Interact, Jog_Fwd_Loop, Jump_Land, Jump_Loop, Jump_Start, PickUp_Table, Pistol_Aim_Down, Pistol_Aim_Neutral, Pistol_Aim_Up, Pistol_Idle_Loop, Pistol_Reload, Pistol_Shoot, Punch_Cross, Punch_Enter, Punch_Jab, Push_Loop, Roll, Roll_RM, Sitting_Enter, Sitting_Exit, Sitting_Idle_Loop, Sitting_Talking_Loop, Spell_Simple_Enter, Spell_Simple_Exit, Spell_Simple_Idle_Loop, Spell_Simple_Shoot, Sprint_Loop, Swim_Fwd_Loop, Swim_Idle_Loop, Sword_Attack, Sword_Attack_RM, Sword_Idle, Walk_Formal_Loop, Walk_Loop`.
- Couverture vs liste requise (idle/walk/run/attaque arme/tir arc/hit/death/flee/cheer/push) : idle ✓ (`Idle_Loop`), walk ✓ (`Walk_Loop`), run ✓ (`Sprint_Loop`/`Jog_Fwd_Loop`), attaque à l'épée ✓ (`Sword_Attack`), hit ✓ (`Hit_Chest`/`Hit_Head`), death ✓ (`Death01`), push ✓ (`Push_Loop`). **Manquant : tir à l'arc** (seulement `Pistol_*`, arme à feu moderne, et `Spell_Simple_*`, magie — pas d'archerie) ; **pas de `cheer`** explicite ; **pas de `flee`** explicite (à défaut, `Roll`/`Sprint_Loop` en sens inverse peut approximer une fuite).

---

## 5. Universal Animation Library 2 (UAL 2) (Quaternius, CC0)

- Source : `assets-src/raw/universal-animation-library-2/universal_animation_library_2standard.zip`
- Licence dans l'archive (`Universal Animation Library 2 [Standard]/License.txt`) : **CC0 1.0 Universal — Public Domain Dedication**.
- Fichiers retenus : `Unreal-Godot/UAL2_Standard.glb` (mannequin masculin + animations) et `Female Mannequin/Unreal-Godot/Mannequin_F.glb` (corps féminin seul, sans animation).

### UAL2_Standard.glb (mannequin masculin + 43 clips)
- Mesh « Mannequin » : mêmes **13 744 triangles / 8 546 sommets** que UAL 1 (même maillage de base) mais lié à un **squelette différent**.
- Matériaux identiques en principe (`M_Main` orange, `M_Joints` violet), aucune texture.
- Squelette : nœud racine `Armature` → `Mannequin` + `root`, **65 os**, nommage **style Unreal Engine Mannequin** : `root, pelvis, spine_01-03, neck_01, Head, clavicle_l/r, upperarm_l/r, lowerarm_l/r, hand_l/r`, doigts avec **os terminaux « leaf »** (`index/middle/pinky/ring/thumb_01-04_leaf_l/r`), jambes `thigh/calf/foot/ball_l/r` (+ `ball_leaf`).
- **43 clips** : `A_TPose, Chest_Open, ClimbUp_1m_RM, Consume, Farm_Harvest, Farm_PlantSeed, Farm_Watering, Hit_Knockback, Hit_Knockback_RM, Idle_FoldArms_Loop, Idle_Lantern_Loop, Idle_No_Loop, Idle_Rail_Call, Idle_Rail_Loop, Idle_Shield_Break, Idle_Shield_Loop, Idle_TalkingPhone_Loop, LayToIdle, Melee_Hook, Melee_Hook_Rec, NinjaJump_Idle_Loop, NinjaJump_Land, NinjaJump_Start, OverhandThrow, Shield_Dash_RM, Shield_OneShot, Slide_Exit, Slide_Loop, Slide_Start, Sword_Block, Sword_Dash_RM, Sword_Regular_A, Sword_Regular_A_Rec, Sword_Regular_B, Sword_Regular_B_Rec, Sword_Regular_C, Sword_Regular_Combo, TreeChopping_Loop, Walk_Carry_Loop, Yes, Zombie_Idle_Loop, Zombie_Scratch, Zombie_Walk_Fwd_Loop`.
- Couverture : combat à l'épée en combo ✓ (`Sword_Regular_A/B/C/Combo`), blocage ✓ (`Sword_Block`), hit ✓ (`Hit_Knockback`). **Pas de `Walk_Loop`/`Idle_Loop` génériques** (seulement `Walk_Carry_Loop`), **pas de mort**, **pas de tir à l'arc**, **pas de course**, **pas de cheer**.

### Female Mannequin (Mannequin_F.glb)
- Corps féminin distinct : **14 612 triangles, 25 636 sommets**, 2 matériaux (même approche couleur plate).
- Squelette : **65 os, mêmes noms que UAL2** (`root, pelvis, spine_01…`) — confirmé par `README.txt` de l'archive : *« both mannequins share the same rig »*.
- **0 animation incluse** (intentionnel, cf. README : retargeting à faire depuis UAL2/UAL1 dans Blender ou le moteur).

### ⚠️ Incompatibilité de rig UAL1 ↔ UAL2/Mannequin_F
Le mannequin **UAL 1** utilise un rig **Blender/Rigify (`DEF-`, 53 os, sans os leaf)**, tandis que **UAL 2** et le **mannequin féminin** utilisent un rig **style Unreal Mannequin (65 os, avec os leaf)**. Malgré un maillage de base identique en triangles/sommets pour le mannequin masculin, **les deux squelettes ont un nombre d'os et une nomenclature différents** : les 46 clips d'UAL 1 ne sont donc **pas directement rejouables** sur le rig UAL2/féminin (et vice versa) sans un retargeting explicite (mapping d'os + réalignement de bind-pose dans Blender ou dans le moteur). À anticiper si on veut cumuler les deux bibliothèques (UAL1 pour la locomotion de base + mort + push, UAL2 pour les combos d'épée) sur un seul personnage.

---

## 6. Cheval (cavalerie) (Quaternius, CC0, via poly.pizza)

- Deux variantes récupérées en téléchargement direct depuis `static.poly.pizza` (URL trouvée en inspectant le HTML des pages poly.pizza — pas de bouton de téléchargement direct exposé en JSON/API public, mais le lien statique est présent dans le HTML servi) :
  - `assets-src/raw/quaternius-horse/Horse.glb` — page source [poly.pizza/m/qvTrSG9pZF](https://poly.pizza/m/qvTrSG9pZF), titre « Horse - Free Model By Quaternius »
  - `assets-src/raw/quaternius-horse/WhiteHorse.glb` — page source [poly.pizza/m/bEdE4rmZy9](https://poly.pizza/m/bEdE4rmZy9), titre « White Horse - Free Model By Quaternius »
- Licence affichée sur les deux pages (balayage du HTML, pas de fichier de licence embarqué dans un GLB seul) : **« CC0 1.0 » / « Public Domain (CC0) »**, aucune attribution requise.
- **2 182 triangles, 4 400 sommets** chacun (conforme à l'estimation ~2,2k tris du brief). 7-8 matériaux à couleur plate (pas de texture — robe/harnais/yeux distingués par couleur de matériau, brun pour `Horse`, blanc pour `WhiteHorse`).
- Squelette : **50 os**, racine `Body`, préfixe d'armature `AnimalArmature|` visible dans les noms de clips (dédoublement nom court/nom qualifié, artefact d'export FBX→glTF courant, les deux pointent vers les mêmes données).
- **13 animations utiles** (26 entrées avec le doublon de préfixe) : `Idle, Idle_2, Idle_Headlow, Idle_HitReact_Left, Idle_HitReact_Right, Walk, Gallop, Gallop_Jump, Jump_toIdle, Eating, Attack_Headbutt, Attack_Kick, Death`.
- Couverture vs liste requise : idle ✓, walk ✓ (`Walk`), run ✓ (`Gallop` en tient lieu), death ✓, hit ✓ (`Idle_HitReact_*`). Pas d'attaque à l'arme montée (lance de cavalerie) ni de tir à cheval — attendu, le kit animalier ne couvre que le comportement naturel du cheval, pas le combat monté armé (le cavalier porterait ses propres animations de combat, superposées ou blendées séparément).
- Rig spécifique au cheval (`Body` racine, pas de correspondance avec les rigs humanoïdes UAL/UAL2/KayKit) — aucune tentative de retargeting croisée pertinente ici.

## 7. Personnages — options évaluées

Comme prévu par la mission, **« Universal Base Characters »** et **« Modular Character Outfits – Fantasy »** n'ont été trouvés que sur itch.io (pages `quaternius.itch.io`, non scriptables, exclues). Aucune copie scriptable (OpenGameArt, Godot Asset Store, Drive public) de ces deux packs précis n'a été localisée. Recherche de repli effectuée : trois options scriptables et sous licence CC0 confirmée ont été identifiées et téléchargées pour comparaison visuelle.

### 7a. KayKit Character Pack : Adventurers 1.0 — **retenu comme base recommandée**
- Source : GitHub, archive de la branche `main` (pas de release taguée disponible) : `https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/archive/refs/heads/main.zip`
- Licence dans l'archive (`addons/kaykit_character_pack_adventures/LICENSE.txt`) : **CC0**, auteur Kay Lousberg (kaylousberg.com), attribution non obligatoire mais appréciée.
- **5 personnages glTF/GLB déjà texturés et animés**, prêts à l'emploi, dans `Characters/gltf/` : `Barbarian.glb` (6 543 tris), `Knight.glb` (6 952 tris), `Mage.glb` (5 683 tris), `Rogue.glb` (6 377 tris), `Rogue_Hooded.glb` (6 035 tris). Chacun : 1 matériau, 1 texture peinte 1024×1024 dédiée, squelette à **41 os** (nommage `hips/spine/chest/head`, IK dédiées pieds/mains : `kneeIK, heelIK, IK-foot, IK-toe, elbowIK, handIK`, points d'attache d'arme `handslot.l/r`), mesh découpé en 6 sous-objets (`Knight_ArmLeft/ArmRight/Body/Head/LegLeft/LegRight` — esthétique « pantin » modulaire caractéristique de KayKit).
- **76 clips d'animation identiques sur les 5 personnages**, couvrant très largement la liste requise : `Idle`, `Walking_A/B/C/Backwards`, `Running_A/B/Strafe_Left/Right`, `1H_Melee_Attack_Chop/Slice_Diagonal/Slice_Horizontal/Stab`, `2H_Melee_Attack_Chop/Slice/Spin/Stab`, `Dualwield_Melee_Attack_*`, `1H_Ranged_Aiming/Reload/Shoot/Shooting`, `2H_Ranged_Aiming/Reload/Shoot/Shooting` (**tir à l'arc/arbalète couvert**), `Block/Block_Attack/Block_Hit/Blocking`, `Hit_A/Hit_B`, `Death_A/Death_A_Pose/Death_B/Death_B_Pose`, `Dodge_Backward/Forward/Left/Right` (fuite/esquive), `Cheer` (**seule bibliothèque du lot à l'avoir**), `Jump_*`, `Sit_*`, `Lie_*`, `Spellcast_*`, `Throw`, `Use_Item`, `PickUp`, `Interact`, `T-Pose`.
  - Couverture vs liste requise (idle/walk/run/attaque arme/tir arc/hit/death/flee/cheer/push) : **tout est présent sauf `push`** (aucun clip de poussée d'objet/bélier).
- Le pack Assets (`Assets/gltf/`) fournit aussi des armes/objets au format glTF compatibles (épées 1/2 mains, hache, arbalètes, dagues, boucliers, carquois/flèches, bâton, grimoire) — pertinents pour équiper les personnages en jeu.
- **Style** : low-poly stylisé « jouet en bois », mesh multi-parties, texture peinte à la main avec AO cuit — look propre et lisible mais **visuellement distinct** des MegaKits Quaternius (Quaternius = mannequins/props lisses à trim-sheets PBR ; KayKit = pantins modulaires à palette plus saturée et ombrage peint). Risque de mélange de styles réel si affiché côte à côte sans retouche (cf. règle 4 de l'agent : Kenney/KayKit/Poly Haven en complément seulement, risque signalé).

### 7b. RPG Characters (Quaternius, Nov 2020) — repli Quaternius « pur style », nécessite conversion
- Source : `https://opengameart.org/sites/default/files/rpg_characters_-_nov_2020.zip`
- Licence dans l'archive (`License.txt`) : **CC0 1.0 Universal — Public Domain Dedication**.
- 6 personnages fantasy **thématiquement pertinents** pour un siège médiéval : `Warrior, Wizard, Ranger, Rogue, Cleric, Monk`, chacun avec sa texture dédiée (`Textures/*_Texture.png`) et des armes séparées assorties (`Warrior_Sword`, `Ranger_Bow`, `Rogue_Dagger`, `Cleric_Staff`, `Wizard_Staff`).
- **⚠️ FBX/OBJ/Blend uniquement — aucun export glTF dans l'archive.** Non inspecté avec `gltf-transform` (règle : FBX/OBJ seulement signalés, pas inventoriés en détail). Nécessiterait une conversion FBX→glTF (pipeline Blender déjà configuré dans le projet via `BLENDER_BIN`, mais hors périmètre de cet agent — tâche à prévoir pour l'agent de pipeline en J2).
- Avantage : **`Ranger` avec `Ranger_Bow` séparé** — piste directe pour combler le trou « tir à l'arc » si les animations d'UAL/KayKit ne suffisent pas, et cohérence stylistique maximale avec les MegaKits puisque c'est le même auteur/même époque de production.

### 7c. Ultimate Animated Character Pack (Quaternius, Nov 2019) — repli générique, nécessite conversion
- Source : `https://opengameart.org/sites/default/files/ultimate_animated_character_pack_by_quaternius.zip`
- **⚠️ Aucun fichier de licence n'est présent dans l'archive** (ni `.txt` ni `.md` à la racine ni dans les sous-dossiers `Blends/FBX/OBJ`) — contrairement à tous les autres packs Quaternius téléchargés. La licence **CC0** n'est donc confirmée que par la métadonnée de la page OpenGameArt (`opengameart.org/content/animated-characters-pack`, champ licence = CC0, auteur `quaternius`), pas par un fichier embarqué dans l'archive. **Ne satisfait pas strictement la règle « licence vérifiée dans l'archive »** — à nettoyer/confirmer avant usage en production (contacter/vérifier une seconde source, ou accepter la métadonnée OGA comme preuve suffisante, décision à valider par l'agent principal).
- 52 variantes FBX (`BaseCharacter`, `Knight_Male`, `Knight_Golden_Male/Female`, `Viking_Male/Female`, `Elf`, `Wizard`, `Witch`, `Soldier_Male/Female`, `Ninja_*`, `Pirate_*`, plus des thèmes hors sujet : `Chef`, `Doctor`, `Cowboy`, `Suit`, `Zombie`…). **FBX/OBJ/Blend uniquement, aucun glTF.**
- Utilité limitée pour « Siège » (thème très mélangé, medieval seulement `Knight_*`/`Viking_*`/`Elf`/`Wizard`) et bloqué par le double problème licence-non-embarquée + conversion FBX requise. **Non recommandé en priorité.**

### Détail par pièce — KayKit Adventurers (les 76 clips sont identiques pour les 5 personnages, voir liste en 7a)

| Pièce | Triangles | Sommets | Matériaux | Texture | Squelette |
|---|---|---|---|---|---|
| Barbarian | 6 543 | 5 922 | 1 | barbarian_texture 1024×1024 | 41 os ; root=root |
| Knight | 6 952 | 7 024 | 1 | knight_texture 1024×1024 | 41 os ; root=root |
| Mage | 5 683 | 5 279 | 1 | mage_texture 1024×1024 | 41 os ; root=root |
| Rogue | 6 377 | 5 901 | 1 | rogue_texture 1024×1024 | 41 os ; root=root |
| Rogue_Hooded | 6 035 | 5 586 | 1 | rogue_texture 1024×1024 | 41 os ; root=root |

---

## Recommandation finale — personnages et cavalerie

**Personnages : KayKit Adventurers (`Knight.glb` en priorité, `Barbarian`/`Rogue`/`Mage` en variantes de troupe/PNJ) recommandé pour un prototype jouable immédiat.** Justification : seule option 100% prête à l'emploi (glTF, texturée, riggée, 76 animations couvrant 9 des 10 catégories requises y compris le tir à l'arc/arbalète qui manque partout ailleurs), licence CC0 embarquée sans ambiguïté, triangles raisonnables (5,7k-7k, du même ordre de grandeur que les mannequins UAL). Compromis assumé : style « pantin modulaire » légèrement différent de la patte lisse/PBR des MegaKits Quaternius — acceptable pour un prototype, à revoir en J2/J3 si une cohérence visuelle stricte est exigée (reskin, ou remplacement par les RPG Characters Quaternius une fois convertis en glTF).

**Cavalerie : `Horse.glb`/`WhiteHorse.glb` (Quaternius via poly.pizza) recommandé sans réserve.** Même auteur que les MegaKits (cohérence de style de modélisation, même si couleur plate sans texture), triangles très légers (2 182, adapté à un déplacement en nombre sur le champ de bataille), 13 animations couvrant idle/walk/gallop/death/hit ; il manque une attaque montée armée mais c'est normalement porté par les animations du cavalier (superposition/blend), pas par le cheval.

**Animation du corps de base : privilégier KayKit pour tout ce qui est joueur/PNJ principal** (autonome, pas de retargeting nécessaire). **Garder UAL1 + UAL2 en réserve** pour des besoins spécifiques non couverts par KayKit (`Push_Loop` d'UAL1 est la seule source de poussée trouvée dans tout le sourcing — utile pour un bélier ou pour déplacer du mobilier de siège) ; en cas d'usage, rattacher `Push_Loop` au squelette KayKit demandera un retargeting manuel (les 3 rigs — KayKit 41 os, UAL1 53 os `DEF-`, UAL2/Mannequin_F 65 os UE-style — sont tous mutuellement incompatibles par nommage).

**Trou non comblé** : aucune animation de type « cheer » n'existe hors KayKit ; aucune option testée ne couvre une attaque de cavalerie armée à cheval. Le mobilier/matériel de siège (catapulte, trébuchet, bélier, tour d'assaut, échelle, mur crénelé, porte-herse) est **totalement absent** des 3 MegaKits téléchargés — sourcing dédié à planifier en J2 pour un jeu appelé « Siège ».

---
## 8. Audio (J5 - effets, ambiances et musique)

Sourcé le 2026-10-03 par l'asset-scout. **107 fichiers retenus, 36.8 Mo** (budget 40 Mo). Tout est sous **CC0** (aucune attribution obligatoire ; les crédits sont néanmoins consignés dans `assets/CREDITS.md`). Fichiers dans `assets-src/raw/audio/<pack>/` (ignoré par git) ; les archives d'origine n'ont pas été conservées (trop lourdes ou inutiles), seules les pièces retenues le sont : le SHA-256 de chaque archive est dans CREDITS.md. Durées lues avec `music-metadata`.

**Réserves** : (1) aucune pièce n'a été écoutée (agent sans audio) : les affectations reposent sur les noms de fichiers et les descriptions de packs, à valider à l'oreille ; (2) mélange d'origines (Kenney + rubberduck + Still North Media + packs OGA isolés) : niveaux sonores hétérogènes, normaliser au pipeline (LUFS cible commun) ; (3) les 6 WAV Still North (192 kHz / 24 bits) pèsent 1,3 à 4,4 Mo par fichier chacun : à convertir en ogg 44,1 kHz mono ; (4) lacunes : voir fin de section.

### Combat

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `hurt-ezduzziteh/hurt_01.mp3` | mp3 44.1 kHz stéréo | 0.3 s | 7 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `hurt-ezduzziteh/hurt_02.mp3` | mp3 44.1 kHz stéréo | 0.3 s | 5 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `hurt-ezduzziteh/hurt_03.mp3` | mp3 44.1 kHz stéréo | 0.2 s | 4 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `hurt-ezduzziteh/hurt_04.mp3` | mp3 44.1 kHz stéréo | 0.3 s | 5 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `hurt-ezduzziteh/hurt_05.mp3` | mp3 44.1 kHz stéréo | 0.4 s | 8 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `hurt-ezduzziteh/hurt_06.mp3` | mp3 44.1 kHz stéréo | 0.2 s | 4 Ko | Hurt Sound Effects (EZduzziteh) | Cri bref de blessé (0,2-0,4 s, sans voix intelligible). |
| `kenney/impact-sounds/Audio/impactMetal_light_000.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 7 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactMetal_light_001.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 7 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactMetal_light_002.ogg` | ogg 44.1 kHz stéréo | 0.2 s | 7 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactMetal_medium_000.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 7 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactMetal_medium_001.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactPlate_medium_000.ogg` | ogg 44.1 kHz stéréo | 0.6 s | 11 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Épées qui s'entrechoquent / flèche sur armure métallique. |
| `kenney/impact-sounds/Audio/impactPunch_heavy_000.ogg` | ogg 44.1 kHz stéréo | 0.7 s | 11 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup contondant (masse, bouclier, assommé). |
| `kenney/impact-sounds/Audio/impactPunch_heavy_001.ogg` | ogg 44.1 kHz stéréo | 0.5 s | 11 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup contondant (masse, bouclier, assommé). |
| `kenney/impact-sounds/Audio/impactPunch_medium_000.ogg` | ogg 44.1 kHz stéréo | 0.4 s | 9 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup contondant (masse, bouclier, assommé). |
| `kenney/impact-sounds/Audio/impactSoft_medium_000.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 5 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur chair/armure (sourd, pas de vrai « thunk » de chair). |
| `kenney/impact-sounds/Audio/impactSoft_medium_001.ogg` | ogg 44.1 kHz stéréo | 0.2 s | 5 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur chair/armure (sourd, pas de vrai « thunk » de chair). |
| `kenney/impact-sounds/Audio/impactSoft_medium_002.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 5 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur chair/armure (sourd, pas de vrai « thunk » de chair). |
| `kenney/impact-sounds/Audio/impactWood_light_000.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur bois (palissade, porte, tour de bois). |
| `kenney/impact-sounds/Audio/impactWood_light_001.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur bois (palissade, porte, tour de bois). |
| `kenney/impact-sounds/Audio/impactWood_light_002.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Impact de flèche sur bois (palissade, porte, tour de bois). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_hit_01.ogg` | ogg 48 kHz stéréo | 0.1 s | 8 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de flèche sur pierre (muraille, créneau). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_wood_hit_01.ogg` | ogg 48 kHz stéréo | 0.3 s | 11 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de flèche/projectile sur bois (variantes, plus sèches). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_wood_hit_02.ogg` | ogg 48 kHz stéréo | 0.3 s | 13 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de flèche/projectile sur bois (variantes, plus sèches). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_wood_hit_03.ogg` | ogg 48 kHz stéréo | 0.4 s | 15 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de flèche/projectile sur bois (variantes, plus sèches). |
| `rubberduck-80-cc0-rpg-sfx/x/item_stone_02.ogg` | ogg 48 kHz stéréo | 0.3 s | 15 Ko | 80 CC0 RPG SFX (rubberduck) | Impact de flèche sur pierre (muraille, créneau). |
| `rubberduck-80-cc0-rpg-sfx/x/item_stone_04.ogg` | ogg 48 kHz stéréo | 0.3 s | 17 Ko | 80 CC0 RPG SFX (rubberduck) | Impact de flèche sur pierre (muraille, créneau). |
| `still-north-media/Axe Norse Sword Blade on Blade.wav` | wav 192 kHz mono | 6.3 s | 3.4 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Épées qui s'entrechoquent (mêlée, parade). 192 kHz mono. |
| `still-north-media/Crossbow Bolt Passby.wav` | wav 192 kHz mono | 2.3 s | 1.3 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Sifflement/passage du carreau en vol. |
| `still-north-media/Crossbow Shoot.wav` | wav 192 kHz mono | 3.2 s | 1.7 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Tir d'arbalète (carreau). 192 kHz 24 bits. |
| `still-north-media/English Longbow Shoot.wav` | wav 192 kHz mono | 4.0 s | 2.2 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Décoche d'arc long (archers défenseurs/attaquants). 192 kHz 24 bits : à rééchantillonner (44,1 kHz) au pipeline. |
| `still-north-media/Mace Norse Sword Blade.wav` | wav 192 kHz mono | 7.8 s | 4.3 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Coup contondant (masse sur lame : choc métallique lourd ; la vraie masse sur chair n'existe pas dans ces packs). |
| `still-north-media/Scythian Recurve Shoot.wav` | wav 192 kHz mono | 4.1 s | 2.3 Mo | Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts (Ben Jaszczak & Brian Nelson) | Décoche d'arc (variante, arc court/recourbé : cavalerie légère ou variété). |

### Siège

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `cannon-hit-wall/cannon_hit_wall.ogg` | ogg 48 kHz stéréo | 3.0 s | 177 Ko | Cannon hit wall (Thimras) | Impact de boulet sur la pierre (mur). |
| `earthquake-mieki256/shake.flac` | flac 44.1 kHz stéréo | 5.3 s | 474 Ko | Earthquake and Open sesame (mieki256) | Grondement/effondrement de pan de mur ou de tour. |
| `iron-door/iron_door.ogg` | ogg 44.1 kHz mono | 0.8 s | 13 Ko | Iron Door (themightyglider) | Grille de herse (grincement métallique ; à pitcher vers le bas). |
| `kenney/impact-sounds/Audio/impactMining_000.ogg` | ogg 44.1 kHz stéréo | 0.9 s | 12 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pelle et terre (sape) ; Mining = coups de pioche/outil. |
| `kenney/impact-sounds/Audio/impactMining_001.ogg` | ogg 44.1 kHz stéréo | 0.9 s | 11 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pelle et terre (sape) ; Mining = coups de pioche/outil. |
| `kenney/impact-sounds/Audio/impactMining_002.ogg` | ogg 44.1 kHz stéréo | 0.8 s | 11 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pelle et terre (sape) ; Mining = coups de pioche/outil. |
| `kenney/impact-sounds/Audio/impactWood_heavy_000.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `kenney/impact-sounds/Audio/impactWood_heavy_001.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `kenney/impact-sounds/Audio/impactWood_heavy_002.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `kenney/rpg-audio/Audio/creak1.ogg` | ogg 48 kHz stéréo | 0.7 s | 15 Ko | Kenney - RPG Audio 1.0 (Kenney Vleugels) | Grincement de catapulte, de roues d'engin et de bois sous charge. |
| `kenney/rpg-audio/Audio/creak2.ogg` | ogg 48 kHz stéréo | 0.8 s | 19 Ko | Kenney - RPG Audio 1.0 (Kenney Vleugels) | Grincement de catapulte, de roues d'engin et de bois sous charge. |
| `kenney/rpg-audio/Audio/creak3.ogg` | ogg 48 kHz stéréo | 0.3 s | 10 Ko | Kenney - RPG Audio 1.0 (Kenney Vleugels) | Grincement de catapulte, de roues d'engin et de bois sous charge. |
| `rubberduck-100-cc0-sfx/x/slam_01.ogg` | ogg 48 kHz stéréo | 0.5 s | 24 Ko | 100 CC0 SFX (rubberduck) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `rubberduck-100-cc0-sfx/x/slam_02.ogg` | ogg 48 kHz stéréo | 0.6 s | 28 Ko | 100 CC0 SFX (rubberduck) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `rubberduck-100-cc0-sfx/x/slam_07.ogg` | ogg 48 kHz stéréo | 0.7 s | 30 Ko | 100 CC0 SFX (rubberduck) | Chute du pont-levis (claquement sur le sol). |
| `rubberduck-100-cc0-sfx/x/spring_01.ogg` | ogg 48 kHz stéréo | 1.3 s | 50 Ko | 100 CC0 SFX (rubberduck) | Relâche de bras de catapulte / détente de torsion. |
| `rubberduck-100-cc0-sfx/x/spring_02.ogg` | ogg 48 kHz stéréo | 1.3 s | 67 Ko | 100 CC0 SFX (rubberduck) | Relâche de bras de catapulte / détente de torsion. |
| `rubberduck-100-cc0-sfx/x/spring_06.ogg` | ogg 48 kHz stéréo | 0.9 s | 48 Ko | 100 CC0 SFX (rubberduck) | Relâche de bras de catapulte / détente de torsion. |
| `rubberduck-30-cc0-sfx-loops/x/rolling.ogg` | ogg 48 kHz stéréo | 1.1 s | 50 Ko | 30 CC0 SFX loops (rubberduck) | Roues d'engin qui roulent/grincent (boucle courte). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_breaking_01.ogg` | ogg 48 kHz stéréo | 1.1 s | 29 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Grondement/effondrement de pan de mur ou de tour. |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_breaking_02.ogg` | ogg 48 kHz stéréo | 0.9 s | 45 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Grondement/effondrement de pan de mur ou de tour. |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_falling_01.ogg` | ogg 48 kHz stéréo | 0.9 s | 35 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de boulet sur la pierre (mur). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_falling_03.ogg` | ogg 48 kHz stéréo | 0.8 s | 40 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Impact de boulet sur la pierre (mur). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_rock_falling_09.ogg` | ogg 48 kHz stéréo | 0.7 s | 30 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Grondement/effondrement de pan de mur ou de tour. |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_wood_breaking_03.ogg` | ogg 48 kHz stéréo | 0.5 s | 17 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Coup de bélier sur une porte de bois (heavy = choc, breaking = porte qui cède). |
| `rubberduck-75-cc0-breaking-falling-hit/x/bfh1_wood_falling_01.ogg` | ogg 48 kHz stéréo | 0.7 s | 33 Ko | 75 CC0 breaking / falling / hit SFX (rubberduck) | Chute du pont-levis (claquement sur le sol). |
| `rubberduck-80-cc0-rpg-sfx/x/chain_01.ogg` | ogg 48 kHz stéréo | 0.5 s | 22 Ko | 80 CC0 RPG SFX (rubberduck) | Chaînes du pont-levis (levée/abaissement). |
| `rubberduck-80-cc0-rpg-sfx/x/chain_02.ogg` | ogg 48 kHz stéréo | 0.5 s | 18 Ko | 80 CC0 RPG SFX (rubberduck) | Chaînes du pont-levis (levée/abaissement). |
| `rubberduck-80-cc0-rpg-sfx/x/chain_03.ogg` | ogg 48 kHz stéréo | 0.9 s | 36 Ko | 80 CC0 RPG SFX (rubberduck) | Chaînes du pont-levis (levée/abaissement). |
| `rubberduck-80-cc0-rpg-sfx/x/stones_03.ogg` | ogg 48 kHz stéréo | 1.2 s | 40 Ko | 80 CC0 RPG SFX (rubberduck) | Impact de boulet sur la pierre (mur). |
| `shovel/shovel.ogg` | ogg 44.1 kHz stéréo | 0.9 s | 21 Ko | Shovel Sound (themightyglider) | Pelle et terre (sape) ; Mining = coups de pioche/outil. |
| `winch/x/winch - Marker #3.wav` | wav 44.1 kHz stéréo | 1.8 s | 623 Ko | Chain winch sounds (bart) | Treuil/chaîne : grincement d'engin (tension de catapulte), chaîne du pont-levis. |
| `winch/x/winch - Marker #8.wav` | wav 44.1 kHz stéréo | 3.6 s | 1.2 Mo | Chain winch sounds (bart) | Treuil/chaîne : grincement d'engin (tension de catapulte), chaîne du pont-levis. |

### Feu et eau

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `fireplace-loop/fire_loop_16bit_mono.wav` | wav 44.1 kHz mono | 29.3 s | 2.5 Mo | Fireplace Sound loop (converti en 16 bits mono par nos soins) (PagDev) | Crépitement de feu en boucle (29,3 s ; très faible niveau, pic 0,107 -> gain +15 à +19 dB). |
| `rubberduck-30-cc0-sfx-loops/x/water_flowing.ogg` | ogg 48 kHz stéréo | 1.9 s | 73 Ko | 30 CC0 SFX loops (rubberduck) | Rivière/douve en boucle (3-7 s ; vérifier le point de bouclage). |
| `rubberduck-40-cc0-water-splash-slime/x/loop_water_01.ogg` | ogg 48 kHz stéréo | 3.4 s | 172 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Rivière/douve en boucle (3-7 s ; vérifier le point de bouclage). |
| `rubberduck-40-cc0-water-splash-slime/x/loop_water_02.ogg` | ogg 48 kHz stéréo | 7.0 s | 263 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Rivière/douve en boucle (3-7 s ; vérifier le point de bouclage). |
| `rubberduck-40-cc0-water-splash-slime/x/splash_01.ogg` | ogg 48 kHz stéréo | 1.4 s | 63 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Éclaboussure (douves, gué, chute dans l'eau). |
| `rubberduck-40-cc0-water-splash-slime/x/splash_03.ogg` | ogg 48 kHz stéréo | 0.8 s | 31 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Éclaboussure (douves, gué, chute dans l'eau). |
| `rubberduck-40-cc0-water-splash-slime/x/splash_05.ogg` | ogg 48 kHz stéréo | 1.2 s | 48 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Éclaboussure (douves, gué, chute dans l'eau). |
| `rubberduck-40-cc0-water-splash-slime/x/splash_07.ogg` | ogg 48 kHz stéréo | 1.3 s | 61 Ko | 40 CC0 water / splash / slime SFX (rubberduck) | Éclaboussure (douves, gué, chute dans l'eau). |
| `rubberduck-80-cc0-rpg-sfx/x/spell_fire_03.ogg` | ogg 48 kHz stéréo | 1.9 s | 70 Ko | 80 CC0 RPG SFX (rubberduck) | Embrasement (whoosh) : départ de feu, huile enflammée. |
| `rubberduck-80-cc0-rpg-sfx/x/spell_fire_04.ogg` | ogg 48 kHz stéréo | 1.6 s | 58 Ko | 80 CC0 RPG SFX (rubberduck) | Embrasement (whoosh) : départ de feu, huile enflammée. |
| `rubberduck-80-cc0-rpg-sfx/x/spell_fire_05.ogg` | ogg 48 kHz stéréo | 1.2 s | 53 Ko | 80 CC0 RPG SFX (rubberduck) | Embrasement (whoosh) : départ de feu, huile enflammée. |

### Pas

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `kdd-different-steps/x/gravel.ogg` | ogg 44.1 kHz stéréo | 0.7 s | 21 Ko | Different steps on wood, stone, leaves, gravel and mud (TinyWorlds) | Pas sur terre/gravier (chemin, sape). Seulement 2 variantes. |
| `kdd-different-steps/x/mud02.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 10 Ko | Different steps on wood, stone, leaves, gravel and mud (TinyWorlds) | Pas sur terre/gravier (chemin, sape). Seulement 2 variantes. |
| `kenney/impact-sounds/Audio/footstep_concrete_000.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur pierre/dalle. |
| `kenney/impact-sounds/Audio/footstep_concrete_001.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur pierre/dalle. |
| `kenney/impact-sounds/Audio/footstep_concrete_002.ogg` | ogg 44.1 kHz stéréo | 0.1 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur pierre/dalle. |
| `kenney/impact-sounds/Audio/footstep_grass_000.ogg` | ogg 44.1 kHz stéréo | 0.8 s | 8 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur herbe. |
| `kenney/impact-sounds/Audio/footstep_grass_001.ogg` | ogg 44.1 kHz stéréo | 0.7 s | 8 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur herbe. |
| `kenney/impact-sounds/Audio/footstep_grass_002.ogg` | ogg 44.1 kHz stéréo | 0.7 s | 8 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur herbe. |
| `kenney/impact-sounds/Audio/footstep_wood_000.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur bois (pont, hourd, pont-levis). |
| `kenney/impact-sounds/Audio/footstep_wood_001.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur bois (pont, hourd, pont-levis). |
| `kenney/impact-sounds/Audio/footstep_wood_002.ogg` | ogg 44.1 kHz stéréo | 0.3 s | 6 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Pas sur bois (pont, hourd, pont-levis). |

### Interface

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `horn-stumpystrust/theircoming.ogg` | ogg 44.1 kHz stéréo | 14.0 s | 115 Ko | Their Coming (generic horn sound) (StumpyStrust) | Fin de tour : cor long (14 s ; version longue pour début/fin de bataille). |
| `horn-stumpystrust/theircoming3.ogg` | ogg 44.1 kHz stéréo | 5.2 s | 117 Ko | Their Coming (generic horn sound) (StumpyStrust) | Fin de tour : cor bref (5,2 s ; à couper/fondre). |
| `kenney/impact-sounds/Audio/impactBell_heavy_000.ogg` | ogg 44.1 kHz stéréo | 1.5 s | 14 Ko | Kenney - Impact Sounds 1.0 (Kenney Vleugels) | Fin de tour (alternative : cloche) ou alarme. |
| `kenney/interface-sounds/Audio/click_001.ogg` | ogg 44.1 kHz mono | 0.1 s | 5 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : clic. |
| `kenney/interface-sounds/Audio/click_002.ogg` | ogg 44.1 kHz mono | 0.0 s | 4 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : clic. |
| `kenney/interface-sounds/Audio/click_003.ogg` | ogg 44.1 kHz mono | 0.0 s | 4 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : clic. |
| `kenney/interface-sounds/Audio/confirmation_001.ogg` | ogg 44.1 kHz mono | 0.3 s | 9 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : validation d'ordre. |
| `kenney/interface-sounds/Audio/confirmation_002.ogg` | ogg 44.1 kHz mono | 0.5 s | 14 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : validation d'ordre. |
| `kenney/interface-sounds/Audio/select_001.ogg` | ogg 44.1 kHz stéréo | 0.0 s | 5 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : sélection d'unité. |
| `kenney/interface-sounds/Audio/select_002.ogg` | ogg 44.1 kHz stéréo | 0.0 s | 5 Ko | Kenney - Interface Sounds 1.0 (Kenney Vleugels) | Interface : sélection d'unité. |

### Ambiances

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `birds-and-wind-spring/Birds-and-Wind-Ambient.ogg` | ogg 44.1 kHz stéréo | 83.8 s | 1.8 Mo | Birds and Wind - Ambient, Birds, Wind and Synth (Spring Spring) | Ambiance de jour (oiseaux, vent) en boucle. |
| `birds-isaiah658/birds-isaiah658.ogg` | ogg 48 kHz stéréo | 30.7 s | 532 Ko | Ambient Bird Sounds (isaiah658) | Ambiance de jour (oiseaux, vent) en boucle. |
| `crickets/crickets.mp3` | mp3 44.1 kHz stéréo | 11.5 s | 180 Ko | Crickets Ambient Noise - loopable (Wolfgang_) | Ambiance de nuit (grillons) en boucle, 11,5 s. |
| `rain-ylmir/x/1.ogg` | ogg 44.1 kHz stéréo | 27.0 s | 537 Ko | Rain (loopable) (Ylmir) | Pluie en boucle. |
| `rain-ylmir/x/3.ogg` | ogg 44.1 kHz stéréo | 45.0 s | 892 Ko | Rain (loopable) (Ylmir) | Pluie en boucle. |
| `wind-whoosh-loop/wind-woosh-loop.ogg` | ogg 48 kHz stéréo | 6.0 s | 246 Ko | wind whoosh loop (SketchMan3) | Vent dans les blés (boucle 6 s ; filtre passe-bas/gain modulé par la météo). |

### Musique

| Fichier (sous raw/audio/) | Format | Durée | Taille | Source | Usage prévu |
|---|---|---|---|---|---|
| `randommind-music/Lament_for_a_Warriors_Soul.mp3` | mp3 44.1 kHz stéréo | 160.7 s | 3.7 Mo | Musique RandomMind : Medieval - The Bard's Tale ; Fantasy - Lament for a Warrior's Soul ; Medieval - Battle (RandomMind) | Musique couche TENSION (mineur, lent). |
| `randommind-music/Medieval_Battle.mp3` | mp3 44.1 kHz stéréo | 78.9 s | 3.0 Mo | Musique RandomMind : Medieval - The Bard's Tale ; Fantasy - Lament for a Warrior's Soul ; Medieval - Battle (RandomMind) | Musique couche BATAILLE (79 s). |
| `randommind-music/The_Bards_Tale.mp3` | mp3 44.1 kHz stéréo | 158.6 s | 3.6 Mo | Musique RandomMind : Medieval - The Bard's Tale ; Fantasy - Lament for a Warrior's Soul ; Medieval - Battle (RandomMind) | Musique couche CALME (mode majeur). Version mp3 « complète » : pas de boucle sans couture (la version Loop .wav fait 10 Mo, non retenue). |

Ces trois morceaux ne sont plus livrés depuis l'ADR-051 : ils sont gardés dans `raw/` pour mémoire.

### Licences et sources (résumé)

- **Birds and Wind - Ambient, Birds, Wind and Synth** - Spring Spring - CC0 (page OGA) - https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth
- **Ambient Bird Sounds** - isaiah658 - CC0 (page OGA) - https://opengameart.org/content/ambient-bird-sounds
- **Cannon hit wall** - Thimras - CC0 (page OGA) - https://opengameart.org/content/cannon-hit-wall
- **Crickets Ambient Noise - loopable** - Wolfgang_ - CC0 (page OGA) - https://opengameart.org/content/crickets-ambient-noise-loopable
- **Earthquake and Open sesame** - mieki256 - CC0 (page OGA) - https://opengameart.org/content/earthquake-and-open-sesame
- **Fireplace Sound loop (converti en 16 bits mono par nos soins)** - PagDev - CC0 (page OGA) - https://opengameart.org/content/fireplace-sound-loop
- **Their Coming (generic horn sound)** - StumpyStrust - CC0 (page OGA) - https://opengameart.org/content/their-coming-generic-horn-sound
- **Hurt Sound Effects** - EZduzziteh - CC0 (page OGA) - https://opengameart.org/content/hurt-sound-effects
- **Iron Door** - themightyglider - CC0 (page OGA) - https://opengameart.org/content/iron-door
- **Different steps on wood, stone, leaves, gravel and mud** - TinyWorlds ([kdd]) - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud
- **Kenney - Impact Sounds 1.0** - Kenney Vleugels (Kenney.nl) - CC0 - « License (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/ » (fichier License.txt dans l'archive, conservé dans kenney/impact-sounds/) - https://kenney.nl/assets/impact-sounds
- **Kenney - Interface Sounds 1.0** - Kenney Vleugels (Kenney.nl) - CC0 - même texte (License.txt dans l'archive, conservé dans kenney/interface-sounds/) - https://kenney.nl/assets/interface-sounds
- **Kenney - RPG Audio 1.0** - Kenney Vleugels (Kenney.nl) - CC0 - même texte (License.txt dans l'archive, conservé dans kenney/rpg-audio/) - https://kenney.nl/assets/rpg-audio
- **Rain (loopable)** - Ylmir - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/rain-loopable
- **Musique RandomMind : Medieval - The Bard's Tale ; Fantasy - Lament for a Warrior's Soul ; Medieval - Battle** - RandomMind (Sergio) - CC0 (page OGA ; attribution non requise) - https://opengameart.org/content/medieval-the-bards-tale ; https://opengameart.org/content/fantasy-lament-for-a-warriors-soul ; https://opengameart.org/content/medieval-battle
- **100 CC0 SFX** - rubberduck - CC0 (licence de la page OGA ; aucun fichier de licence dans le zip) - https://opengameart.org/content/100-cc0-sfx
- **30 CC0 SFX loops** - rubberduck - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/30-cc0-sfx-loops
- **40 CC0 water / splash / slime SFX** - rubberduck - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/40-cc0-water-splash-slime-sfx
- **75 CC0 breaking / falling / hit SFX** - rubberduck - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx
- **80 CC0 RPG SFX** - rubberduck - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/80-cc0-rpg-sfx
- **Shovel Sound** - themightyglider - CC0 (page OGA) - https://opengameart.org/content/shovel-sound
- **Medieval sound effects (Still North Media) - Weapon Textures et Weapon impacts** - Ben Jaszczak & Brian Nelson (Still North Media), soumis sur OGA par MedicineStorm - CC0 - page OGA : « You may use any of our sounds freely, with no royalties, and no credit needs to be given » ; « CC0 NO RIGHTS RESERVED » (aucun fichier de licence dans les 7z) - https://opengameart.org/content/medieval-sound-effects-weapon-textures (+ https://opengameart.org/content/medieval-sound-effects-weapon-impacts)
- **Chain winch sounds** - bart (OpenGameArt) - CC0 (page OGA ; pas de fichier de licence dans le zip) - https://opengameart.org/content/chain-winch-sounds
- **wind whoosh loop** - SketchMan3 - CC0 (page OGA) - https://opengameart.org/content/wind-whoosh-loop

### Couverture par rapport à la liste demandée

| Besoin | État | Détail |
|---|---|---|
| Décoche d'arc | OK | 2 variantes (arc long, arc recourbé) |
| Impact flèche bois / pierre / chair | OK (approx.) | bois 6, pierre 3, chair 3 ; la « chair » est un impact sourd Kenney, pas un vrai son de flèche |
| Carreau d'arbalète | OK | tir + passage en vol |
| Épées qui s'entrechoquent | OK | 1 clash Still North + 6 impacts métal/plaque Kenney |
| Coup contondant | OK | 1 masse + 3 impacts Punch |
| Cri de blessé | OK | 6 cris brefs |
| Catapulte (relâche, grincement) | Partiel | relâche = 3 « spring » génériques ; grincements = 3 creaks Kenney + 2 treuils ; pas de son dédié de catapulte |
| Boulet sur pierre | OK | 6 pièces |
| Effondrement | OK | grondement 5 s + 3 éboulements |
| Bélier sur porte | OK (approx.) | impacts bois lourds + claquements ; pas de bélier dédié |
| Pont-levis (chaînes, chute) | OK | 3 chaînes + 2 treuils + 2 chutes |
| Herse | Partiel | 1 son de porte de fer (0,8 s) + chaînes |
| Pelle et terre | OK | 1 pelle + 3 pioches |
| Roues d'engin | Partiel | creaks + 1 « rolling » de 1 s ; pas de boucle de roues |
| Feu : embrasement, crépitement, éclaboussure | OK | 3 whoosh, 1 boucle de 29 s (très faible), 4 éclaboussures |
| Pas herbe / terre / pierre / bois | OK sauf terre | herbe 3, pierre 3, bois 3 ; terre = 2 seulement (boue, gravier) |
| UI : clic, sélection, validation, fin de tour | OK | clic 3, sélection 2, validation 2, cor 2 (5 s et 14 s) + cloche |
| Ambiances jour / nuit / pluie / blés / rivière | OK (approx.) | jour 2, nuit 1, pluie 2, vent 1, rivière 3 ; boucles courtes, points de bouclage non vérifiés ; pas de « vent dans les blés » dédié (vent générique) |
| Musique | OK (ADR-051) | sept morceaux rendus par `scripts/render-music.ts` à partir de trois airs du domaine public (Kalenda maya, Reis glorios, Palästinalied) joués sur les échantillons CC0 de la VCSL (165 fichiers, `scripts/music/samples.json`), bouclés sans couture ; la musique RandomMind n'est plus livrée |
| Non trouvé en CC0 scriptable | Manque | vrais sons de catapulte/trébuchet/bélier/herse (les packs CC0 ne couvrent pas, Freesound exige une connexion, Sonniss et FuseHive sont à licence maison) |


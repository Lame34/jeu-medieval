# Bible de style — « Siège »

> Source d'autorité : section 5 de `GAME_BRIEF.md`. Ce document traduit l'intention en **paramètres** utilisables par le code (`src/render/materials/palette.ts` en est le miroir exact) et consigne chaque itération de look-dev.

## 1. Intention en une phrase

**Une maquette peinte à l'aquarelle et à la gouache, éclairée par un soleil de fin d'après-midi.**

Trois règles guident chaque décision :

1. **La lumière fait le tableau.** Soleil doré et rasant, ombres bleu-violet qui gardent leur couleur, et brume qui bleuit les lointains. Un décor moyen sous une belle lumière vaut mieux qu'un beau décor sous une lumière plate.
2. **Les valeurs structurent, la saturation désigne.** Le paysage vit dans des valeurs moyennes et des teintes désaturées ; seules les unités portent des couleurs pures (bleu royal et or contre rouge sang et fer). L'œil trouve donc les unités en moins d'une seconde.
3. **Rien n'est plat.** Chaque surface a un dégradé vertical (base sombre et saturée, sommet éclairci), une variation de teinte à grande échelle et une occlusion peinte à son pied.

## 2. Palette (sRGB)

### Paysage (saturation moyenne à faible)
| Rôle | Lumière | Base / ombre propre | Notes |
|---|---|---|---|
| Herbe grasse | `#86A34E` | `#4F6D2F` | Vert mousse, légèrement jaune dans la lumière |
| Herbe sèche | `#B7A862` | `#7E7440` | Dans les zones exposées et en crête |
| Sous-bois / mousse | `#6B8A3A` | `#3F5626` | Au pied des arbres et des murs |
| Feuillage (houppier) | `#8FAE52` | `#3E5A2A` | Le haut du houppier capte la lumière chaude |
| Conifère | `#5E7A48` | `#2F4630` | Plus froid et plus sombre |
| Terre battue | `#9C7A52` | `#6B5238` | Cours, abords des maisons |
| Chemin | `#BC9E70` | `#8A7050` | Routes, plus clair que la terre |
| Boue / gué | `#6E5842` | `#4A3B2C` | Berges, gué, pluie |
| Roche / pierre chaude | `#A0978A` | `#6A6258` | Pentes fortes, falaises, château |
| Blé mûr | `#DCB65C` | `#A3813A` | Champs, ondule au vent |
| Seigle | `#C6AA6A` | `#8F7A48` | Plus gris que le blé |
| Jachère | `#8F8A56` | `#5F5C38` | Parcelles au repos |
| Bois chaud | `#7A5234` | `#4E3322` | Colombages, charpente, engins |
| Bois clair | `#A67B4F` | `#6E5034` | Planches neuves, palissades |
| Chaume | `#C9A45C` | `#8B6E3C` | Toits de chaume |
| Tuile | `#A5573C` | `#6E3628` | Toits de tuiles ; **moins saturée** que le rouge d'allégeance |
| Torchis / enduit | `#E2D4B6` | `#A89A7E` | Murs des maisons |

### Eau
| Rôle | Couleur |
|---|---|
| Rivière, eau peu profonde | `#6E9C8E` |
| Rivière, eau profonde | `#2F5963` |
| Douves (eau stagnante) | `#3A4A3C` → `#26332B` |
| Écume, reflet peint | `#EDE6D2` |

### Allégeances (les seules couleurs très saturées de la scène)
| Camp | Principale | Secondaire | Motif (mode daltonien) |
|---|---|---|---|
| Attaquant | Bleu royal `#1F4FC4` | Or `#E6B325` | Chevrons ▲, bouclier rond |
| Défenseur | Rouge sang `#B3141E` | Fer `#4A4F57` | Barres ■, bouclier en écu |

Règle : aucun autre élément de la scène ne dépasse une saturation HSV de 0,55 (sauf feu et braises). Le script de capture vérifie cette règle sur un histogramme.

## 3. Lumière — trois heures de référence

Les valeurs sont interpolées selon l'heure du tour. Élévation du soleil en degrés ; intensités pour `MeshLambertMaterial` avec `renderer.toneMapping = ACESFilmic`, exposition 1.0.

| Paramètre | Matin (8 h) | **Fin d'après-midi (16 h 30, défaut)** | Crépuscule (19 h 30) |
|---|---|---|---|
| Élévation / azimut | 18° / 110° | **24° / 245°** | 6° / 285° |
| Couleur du soleil | `#FFE7C8` | **`#FFD39A`** | `#FF9A58` |
| Intensité du soleil | 2.4 | **2.8** | 1.8 |
| Ciel au zénith | `#7FA6CF` | **`#6F96C4`** | `#4C5A8C` |
| Horizon, côté soleil | `#F4E2C4` | **`#F3D09C`** | `#F29A62` |
| Horizon, côté opposé | `#C5D3DF` | **`#B8C6D4`** | `#8A7FA0` |
| Ambiante, ciel | `#A9BCD8` | **`#9DB2D4`** | `#6A6C98` |
| Ambiante, sol (rebond) | `#6E6450` | **`#7A5E3C`** | `#5A3E36` |
| Couleur de l'ombre | `#5F6C98` | **`#5B5A8E`** | `#4A4278` |
| Force de teinte de l'ombre | 0.50 | **0.58** | 0.65 |
| Brume, côté soleil | `#E8DCC6` | **`#EBC896`** | `#E39A6C` |
| Brume, côté opposé | `#B4C3D2` | **`#A8B8CA`** | `#7E7896` |

### Ombres
- Aucune ombre grise ou noire. La lumière reçue est calculée par `shadowTint = mix(shadowColor * albedo * ambient, litColor, shadowFactor)`, jamais par une simple multiplication vers le noir.
- Une seule lumière projette des ombres (le soleil), avec une carte de 2048 px au maximum et un frustum resserré qui suit la caméra. Les ombres du terrain et l'AO sont précalculées dans une texture au chargement.

### Perspective aérienne
- La brume commence à **80 m** du point visé et atteint **70 %** vers 900 m. Au-delà, les montagnes peintes sont presque entièrement noyées (90 %).
- La brume se teinte selon l'angle avec le soleil (doré côté soleil, bleu gris à l'opposé), avec un léger brouillard de hauteur dans les vallons (densité ×1,6 sous 4 m).
- Les montagnes du fond sont trois couches de silhouettes, de plus en plus claires et bleues.

## 4. PaintedMaterial — paramètres par défaut

| Paramètre | Valeur | Effet |
|---|---|---|
| `wrap` (half-Lambert) | 0.45 | Les faces à l'ombre gardent 45 % de modelé ; aucune face n'est morte |
| `gradientBase` | 0.72 | Luminosité multipliée au pied de l'objet |
| `gradientTop` | 1.08 | Sommet légèrement éclairci |
| `gradientSatBoost` | 0.12 | Saturation ajoutée à la base |
| `hueNoiseScale` | 1/45 m⁻¹ | Taches de teinte à l'échelle du paysage |
| `hueNoiseAmp` | 0.035 | Décalage de teinte (en tours HSV) |
| `valueNoiseAmp` | 0.07 | Variation de valeur |
| `instanceJitter` | 0.05 | Variation de teinte par instance (arbres, maisons) |
| `rimStrength` (unités uniquement) | 0.35, `#FFF1D6` | Détache les silhouettes du décor |
| `groundAO` | 0.35 sur 0,6 m | Assombrissement peint au contact du sol (ancrage) |

## 5. Interface
- Bois sombre `#2B1E14`, bois moyen `#4A3423`, parchemin `#E8D9B5`, encre `#3A2A1A`, fer forgé `#3C3F44`, accent or `#C9A13B`.
- Titres en **Cinzel** (600 et 700), texte courant en **Alegreya** (400, 500 et italique).
- Icônes en SVG maison, avec un trait d'encre irrégulier de 1,5 px et un remplissage aplat plus sombre, dans le style gravure sur bois.

## 6. Anti-références (section 5.2 du brief, contrôle à chaque capture)
- [ ] Lumière blanche neutre, ou ombres grises ou noires
- [ ] Terrain d'une seule couleur, ou tuilage visible
- [ ] Arbres identiques alignés, ou lisières coupées net
- [ ] Horizon vide, bord de carte visible, ciel uniforme
- [ ] Objets flottants sans ancrage
- [ ] Assets de styles différents côte à côte
- [ ] Saturation uniforme
- [ ] Scintillement sur l'herbe ou le feuillage
- [ ] Interface générique

## 7. Journal des itérations de look-dev

| Itération | Date | Captures | Cohérence | Lumière | Paysage | Lisibilité | Composition | Défauts 5.2 | Changements |
|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | Première itération en J2 |

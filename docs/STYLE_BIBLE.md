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
| Herbe grasse | `#8C9C5C` | `#566A3C` | Vert mousse, légèrement jaune dans la lumière |
| Herbe sèche | `#B7A862` | `#7E7440` | Dans les zones exposées et en crête |
| Sous-bois / mousse | `#6B8A3A` | `#3F5626` | Au pied des arbres et des murs |
| Feuillage (houppier) | `#8FAE52` | `#3E5A2A` | Le haut du houppier capte la lumière chaude |
| Conifère | `#5E7A48` | `#2F4630` | Plus froid et plus sombre |
| Terre battue | `#9C7A52` | `#6B5238` | Cours, abords des maisons |
| Chemin | `#BC9E70` | `#8A7050` | Routes, plus clair que la terre |
| Boue / gué | `#6E5842` | `#4A3B2C` | Berges, gué, pluie |
| Roche / pierre chaude | `#A0978A` | `#6A6258` | Pentes fortes, falaises, château |
| Blé mûr | `#D2AE62` | `#977D4C` | Champs, ondule au vent ; lit du champ entre les touffes `#806A40` |
| Seigle | `#C6AA6A` | `#8F7A48` | Plus gris que le blé |
| Jachère | `#8F8A56` | `#5F5C38` | Parcelles au repos |
| Bois chaud | `#7A5234` | `#4E3322` | Colombages, charpente, engins |
| Bois clair | `#A67B4F` | `#6E5034` | Planches neuves, palissades |
| Chaume | `#B89C68` | `#7F6A48` | Toits de chaume (brins peints dans le shader) |
| Tuile | `#9A6450` | `#6A4436` | Toits de tuiles ; **moins saturée** que le rouge d'allégeance (textures du kit : saturation ×0,6) |
| Toit des tours | `#7E5646` | — | Bardeaux en rangs alternés |
| Mortier | `#6D665A` | — | Joints de la maçonnerie procédurale |
| Torchis / enduit | `#E2D4B6` | `#A89A7E` | Murs des maisons |

### Eau
| Rôle | Couleur |
|---|---|
| Rivière, eau peu profonde | `#6E9C8E` |
| Rivière, eau profonde | `#2F5963` |
| Douves (eau stagnante) | `#4A5C48` → `#2E3D33`, reflet du ciel renforcé |
| Écume, reflet peint | `#EDE6D2` |

### Allégeances (les seules couleurs très saturées de la scène)
| Camp | Principale | Secondaire | Motif (mode daltonien) |
|---|---|---|---|
| Attaquant | Bleu royal `#1F4FC4` | Or `#E6B325` | Chevrons ▲, bouclier rond |
| Défenseur | Rouge sang `#B3141E` | Fer `#4A4F57` | Barres ■, bouclier en écu |

Règle : aucun autre élément de la scène ne dépasse une saturation HSV de 0,55 (sauf feu et braises). Le script de capture vérifie cette règle sur un histogramme.

## 3. Lumière — trois heures de référence

Les valeurs sont interpolées selon l'heure du tour (miroir de `src/render/atmosphere/time-of-day.ts`). Élévation du soleil en degrés ; intensités pour `MeshLambertMaterial`, exposition puis ACES Filmic dans le post-process.

| Paramètre | Matin (8 h) | **Fin d'après-midi (16 h 30, défaut)** | Crépuscule (19 h 30) |
|---|---|---|---|
| Élévation / azimut | 18° / 110° | **24° / 245°** | 6° / 285° |
| Couleur du soleil | `#FFE7C8` | **`#FFD8A6`** | `#FFAC6E` |
| Intensité du soleil | 2.3 | **2.5** | 2.2 |
| Ciel au zénith | `#7FA6CF` | **`#6F96C4`** | `#4C5A8C` |
| Horizon, côté soleil | `#F4E2C4` | **`#F3D09C`** | `#F29A62` |
| Horizon, côté opposé | `#C5D3DF` | **`#B8C6D4`** | `#8A7FA0` |
| Ambiante, ciel | `#AEC0DC` | **`#A4B8D8`** | `#7D84B4` |
| Ambiante, sol (rebond) | `#6E6450` | **`#7A6242`** | `#74523A` |
| Intensité ambiante | 1.9 | **1.9** | 2.3 |
| Couleur de l'ombre | `#5F6C98` | **`#5B5A8E`** | `#4A4278` |
| Teinte multiplicative de l'ombre (`shadowStrength`) | 0.25 | **0.28** | 0.30 |
| Décalage de teinte à luminance constante (`shadowHue`) | 0.22 | **0.28** | 0.24 |
| Chaleur de l'étalonnage / exposition | 0.03 / 1.0 | **0.045 / 1.0** | 0.06 / 1.15 |
| Brume, côté soleil | `#E8DCC6` | **`#EBC896`** | `#E39A6C` |
| Brume, côté opposé | `#B4C3D2` | **`#A8B8CA`** | `#7E7896` |

### Ombres
- Aucune ombre grise ou noire. À l'ombre, la lumière ambiante reçoit une teinte multiplicative normalisée par la moyenne des canaux, bornée entre 0,75 et 1,25. Elle glisse ensuite vers la couleur d'ombre **à luminance constante** (`shadowHue`, teinte gardée à 60 %). Herbe, pierre et tuiles prennent ainsi la même ombre bleu-violet (revue v13).
- Une seule lumière projette des ombres (le soleil), avec une carte de 2048 px au maximum et un frustum resserré qui suit la caméra. Les ombres du terrain et l'AO sont précalculées dans une texture au chargement.

### Perspective aérienne
- La brume commence à **70 m** au-delà du point visé et atteint **72 %** à 900 m, en ease-out. Hors de la carte jouable, un voile supplémentaire (jusqu'à 70 % à 45 m du bord) cache le bord.
- La brume se teinte selon l'angle avec le soleil (doré côté soleil, bleu gris à l'opposé), avec un léger brouillard de vallon (0,12 sous 3 m).
- Le ciel porte des bancs de nuages peints, précalculés au chargement (panorama 1024 × 256), concentrés juste au-dessus des montagnes.
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
| `rimStrength` (unités uniquement) | 0.55, `#FFF1D6`, exposant 2, 70 % à l'ombre | Détache les silhouettes du décor, même à l'ombre |
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
| v0–v8 | 25/09 | `docs/captures/2026-09-25-v0…v8` | — | — | — | — | — | — | Mise en place, sans notation. PaintedMaterial (wrap, ombre teintée, dégradé vertical, bruit de teinte, AO de contact), 3 réglages horaires, ciel en dégradé avec montagnes peintes, terrain par splat avec détail procédural, herbe GPU, ruban d'eau, arbres procéduraux, maisons issues du kit MegaKit, château procédural, unités KayKit fusionnées, post-process (SMAA, ACES, étalonnage). Principaux bugs corrigés : eau invisible (sens des faces), murs invisibles (DoubleSide), pointes sombres de l'herbe, pose en T des unités. |
| **v9** | 25/09 | `2026-09-25-v9` | 4 | 4 | 4 | 6 | 4 | 3 | **Première revue art-director, moyenne 4,2.** Test de la planche : KayKit refusé (chibi, plastique), arbres procéduraux acceptés sous conditions. Corrections C1 à C12. |
| v10–v11 | 25/09 | `2026-09-25-v10`, `v11` | — | — | — | — | — | — | C1 à C12 appliquées. Teinte d'ombre normalisée et bornée, passe d'exposition, brume en ease-out avec voile de bord de carte, rivière prolongée de 250 m, reflets de l'eau éclairés par la scène, discipline de saturation (palette, tuiles), terrain : zones sèches face au soleil et trèfle, abords des maisons et pied des murs. Herbe : penchée sous le vent, fleurs. Arbres : bosses, branches, touches de pinceau. Buissons en grappes, haie et muret, chaume en brins, maçonnerie par abscisse curviligne, glacis et épi. Anneaux d'allégeance à l'encre, mis à l'échelle de la distance. Correction de la vue close. |
| v12 | 25/09 | `2026-09-25-v12` | — | — | — | — | — | — | **Personnages Quaternius RPG** (ADR-014), recoloration de l'atlas par camp. Coupe tactique en trame près de la caméra, joints plus fins et mortier #6d665a, bosquets lointains lissés et posés au sol, vue close à 11 m. |
| **v13** | 27/09 | `2026-09-27-v13` | 6 | 6 | 5 | 6 | 5 | 4 | **Deuxième revue, moyenne 5,3.** Végétation en BatchedMesh avec LOD (ADR-016), blé diffusé (ADR-017), lit de champ doré, canopées LOD à normales lisses. Personnages acceptés comme base, sous conditions : yeux, tabard, épée au repos, rim light, planche défenseur. Corrections 1 à 15 : ombre en décalage de teinte à luminance constante, crépuscule, masse de couleur des unités, blé, bords de carte, répartition de la végétation, maçonnerie, coupe, herbe, brume et nuages, anneau, eau, saturation, cadrages, documentation. |

| v14 | 27/09 | `2026-09-27-v14`, `v14b`, `v14c` | — | — | — | — | — | — | Corrections v13 appliquées. Deux bugs trouvés en route : la déformation des assises à 0,45 créait des bandes sombres (ramenée à 0,25), et le tabard se collait à l'épée dans la pose de repos (surface du corps restreinte aux os du tronc). Coupe tactique limitée aux caméras à moins de 25 m. |
| **v15** | 27/09 | `2026-09-27-v15` | 6 | 6 | 6 | 7 | 5 | 5 | **Troisième revue, moyenne 5,8.** Restent : ombre à faire tourner en teinte (YIQ) plutôt qu'à mélanger vers le violet ; plafond de saturation dans le shader ; bords de carte (anneau à meubler, voile en plans étagés, rivière prolongée qui méandre) ; vue castle à recadrer (75 m / 14°) et joints plus fins ; unités ×1,2 avec métal de l'attaquant plus clair ; feuillage à normales lisses ; herbe à la couleur du sol, fleurs en taches ; bords du chemin analytiques ; prairie plus sèche et abords des maisons ; vue close plus basse ; blé à l'ombre ; crépuscule ; socle des maisons. |

| **v16** | 27/09 | `2026-09-27-v16b` | 6 | 7 | 6 | 7 | 6 | 5 | **Quatrième revue, moyenne 6,2.** Ombre en rotation de teinte YIQ (unités exemptées), plafond de saturation 0,52, bords de carte meublés, vue castle recadrée, unités ×1,12, herbe à la couleur du sol, abords des maisons. Restent : pli en « V » au bord de la carte (camera castle hors carte), teintes chaudes lilas à l'ombre, chemin trop large et pixellisé, herbe en dents, brume laiteuse du lointain, maçonnerie régulière, bosquets proches facettés, rivière hors carte, rayon du blé. |

Carte de bataille (J2 §12) : `docs/captures/2026-09-27-battle-v1…v3`, vues dérivées de la carte (`src/render/battle/views.ts`). Château complet (donjon, porterie, pont-levis) et pont de pierre à partir de battle-v2.

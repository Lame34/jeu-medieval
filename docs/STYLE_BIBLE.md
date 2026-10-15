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
| Roche / pierre chaude | `#A89A84` | `#706454` | Pentes fortes, falaises, château ; un gris chaud à l'ombre, jamais l'ardoise (v20) |
| Blé mûr | `#D2AE62` | `#977D4C` | Champs, ondule au vent ; lit du champ entre les touffes `#9A8050` |
| Seigle | `#C6AA6A` | `#8F7A48` | Plus gris que le blé |
| Jachère | `#8F8A56` | `#5F5C38` | Parcelles au repos |
| Bois chaud | `#7A5234` | `#4E3322` | Colombages, charpente, engins |
| Bois clair | `#A67B4F` | `#6E5034` | Planches neuves, palissades |
| Chaume | `#B89C68` | `#7F6A48` | Toits de chaume (brins peints dans le shader) |
| Tuile | `#9A6450` | `#6A4436` | Toits de tuiles ; **moins saturée** que le rouge d'allégeance (textures du kit : saturation ×0,6) |
| Toit des tours | `#7E5646` | — | Bardeaux en rangs alternés |
| Mortier | `#847B6C` | — | Joints de la maçonnerie procédurale |
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
| Couleur du soleil | `#FFE7C8` | **`#FFD8A6`** | `#FFB47A` |
| Intensité du soleil | 2.3 | **2.5** | 2.2 |
| Ciel au zénith | `#7FA6CF` | **`#6F96C4`** | `#4C5A8C` |
| Horizon, côté soleil | `#F4E2C4` | **`#F3D09C`** | `#F29A62` |
| Horizon, côté opposé | `#C5D3DF` | **`#C0C4CA`** | `#8A7FA0` |
| Ambiante, ciel | `#AEC0DC` | **`#A4B8D8`** | `#7D84B4` |
| Ambiante, sol (rebond) | `#7A6A4C` | **`#7A6242`** | `#74523A` |
| Intensité ambiante | 1.9 | **1.9** | 2.3 |
| Couleur de l'ombre | `#5F6C98` | **`#55618F`** | `#444E80` |
| Teinte multiplicative de l'ombre (`shadowStrength`) | 0.25 | **0.28** | 0.24 |
| Rotation de teinte YIQ à l'ombre (`shadowHue`) | 0.22 | **0.28** | 0.24 |
| Chaleur de l'étalonnage / exposition | 0.03 / 1.0 | **0.045 / 1.0** | 0.06 / 1.15 |
| Brume, côté soleil | `#E8D4B4` | **`#EBC896`** | `#E39A6C` |
| Brume, côté opposé | `#A9B9CC` | **`#A2AEBE`** | `#7E7896` |

### Ombres
- Aucune ombre grise ou noire. À l'ombre, la lumière ambiante reçoit une teinte multiplicative normalisée par la moyenne des canaux, bornée entre 0,75 et 1,25. La teinte tourne ensuite en YIQ à luminance constante : les teintes froides tournent d'au plus 14° vers la couleur d'ombre, les ocres d'au plus 10° vers l'olive, les rouges ne tournent pas, les gris reçoivent la chroma de l'ombre. Les albédos chauds reçoivent une lumière de rebond neutralisée à 40 %. Les ombres portées sont relevées de 10 %, pour se lire comme des lavis. Les unités sont exemptées de la rotation et du plafond de saturation (0,52).
- Une seule lumière projette des ombres (le soleil), avec une carte de 2048 px au maximum et un frustum resserré qui suit la caméra. Les ombres du terrain et l'AO sont précalculées dans une texture au chargement.

### Perspective aérienne
- La brume commence à **70 m** au-delà du point visé et atteint **66 %** à 900 m, en ease-out. Hors de la carte jouable, un voile par plans étagés (jusqu'à 25 % à 240 m du bord) cache le bord.
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
- Titres en **Cinzel** (600 et 700), texte courant en **Alegreya** (400, 700 pour le gras, et italique : un gras dessiné, non simulé par le navigateur).
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
| **v17** | 28/09 | `2026-09-28-v17b` | 7 | 7 | 6 | 7 | 6 | 6 | **Cinquième revue, moyenne 6,5.** Pli du bord supprimé, chemin à sa vraie largeur (bug de smoothstep), ombres des teintes chaudes sans lilas, caméra castle dans la carte. Restent : herbe proche en dents, ombres des teintes chaudes grises le matin, abords des maisons redevenus nets, couture de couleur de l'anneau, bosquets lointains identiques, lointain laiteux, chemin sans issue, blé en confettis, capuche de l'archer, rivière « marbre », ombres trop opaques, maçonnerie, cadrages, prairie vide, liseré des socles. |
| **v18** | 28/09 | `2026-09-28-v18b` | 7 | 7 | 6 | 7 | 6 | 6 | **Sixième revue, moyenne 6,5 : plateau.** Bosquets lointains en quatre variantes, fanions d'allégeance, résolution dynamique optionnelle (ADR-020). Restent : acné et bords durs des ombres, ombres du sol encore opaques, prairie uniforme au-delà du rayon d'herbe, lit du champ, maçonnerie peu contrastée, rivière trop saturée, nuages froids, ligne claire à la couture de l'anneau, bosquets en semis régulier, bouts de mur coupés net, prairie sans objets à l'échelle humaine. |
| **v19** | 28/09 | `2026-09-28-v19` | 7 | 7 | 6 | 7 | 6 | 6 | **Septième revue, moyenne 6,5 : deuxième plateau.** Corrections v18. Ombres : décalage de la coordonnée d'ombre (anti-acné), sol relevé à ×1,22, biais normal du feuillage. Prairie : masse d'herbe peinte au-delà du rayon, sécheresse selon l'altitude. Lit du champ #9a8050, maçonnerie plus contrastée, rivière désaturée (plafond 0,4), nuages chauds. Couture de l'anneau calculée sur la surface visible. Bosquets lointains en massifs parents-enfants, teinte par massif, émergents. Mur tourné vers la prairie (merlons et talus côté assaillants), pilastres aux bouts libres, assises continues sur les faces d'about. Accessoires : rochers moussus, meules, tronc couché (`src/render/props/Props.tsx`, un seul appel de dessin). |
| **v20** | 28/09 | `2026-09-28-v20` | 7 | 7 | 6 | 7 | 6 | 6 | **Huitième revue, moyenne 6,5 : quatrième revue au même niveau (v17 à v20).** L'art-director estime qu'il faut encore 3 à 5 itérations, et qu'une partie du plafond est structurelle : personnages lisses contre décor à facettes, arbres procéduraux « low-poly », herbe à un triangle. Arrêt au ⛳ J2 pour décision. Corrections v19 (ADR-021). Cadrages : overview 140 m / 26° avec une bande de lointain ; plan rapproché bas (12°), tourné vers le sud, unités vers 1/3 et 2/3 ; vue castle à 54 m avec un chêne repoussoir et des rochers au plan intermédiaire. Anneau en parcellaire avec haies, ceinture de massifs au-delà du bord, sol de forêt sous les seuls bosquets (la couture de la carte disparaît). Bande d'ombre pleine à la place des créneaux (plus de stries). Accessoires à facettes et en groupes, meule à fût, débord et cône, poterne en saillie au bout du chemin, chemin estompé au bord de la carte. Pierre plus chaude (#A89A84 / #706454), rebond du sol du matin plus chaud, perspective aérienne (désaturation avec la distance), ciel de l'après-midi moins laiteux et nuages chauds, crépuscule moins noir, rivière du crépuscule plus chaude, muret éclairci avec chaperon d'herbe, blé à l'ombre moins olive. |
| **J4-r1** | 03/10 | `2026-10-02-j4-siege-v5`, `works-v2`, `tower-v1`, `fire-v1`, `2026-10-03-j4-projectiles-v2` | 5,0 | 4,8 | 4,8 | 4,6 | 5,2 | 4,8 | **Première revue du siège (J4), moyennes par thème : ouvrages 4,5, engins 5,5, sape 4,2, feu 5,7, projectiles 4,4.** Quatre questions de lisibilité sur neuf ont une réponse négative : fissures, pont levé, douve, sape. |
| J4-v2 | 03/10 | `2026-10-03-j4-siege-v6`, `works-v3`, `tower-v2`, `fire-v2`, `projectiles-v3` | — | — | — | — | — | — | Les 8 corrections J4-r1, plus le pont levé à planches presque jointives (97 %). **Douve** : reflet du ciel ramené à 0,03 + fresnel 0,35, plafond 0,25, lentilles d’eau #6E7A4A sur les bords. **Gravats** : éclats chanfreinés d’environ 44 triangles, blocs de 0,9 × 0,85 m, moitié de fragments, ton par instance 0,82 à 1,08, lit de gravats #8E8272 fusionné à la maçonnerie, poussière #9E927E à pied fondu et plafonnée à 20 bouffées par vague. **Fissures** : #2B2326 de 0,5 m avec lèvre éclairée #C2B59C, pierres manquantes à partir de 50 % de dégâts, éclats au pied à partir de 70 %. **Pont levé** : contre-planche #4E3322 et deux bandes de fer. **Engins** : rim 0,18, un matériau par type (un seul programme), anneaux de 3,2 à 3,8, peaux #8A6444 et toit du bélier en bois chaud. **Feu** : rampe orange à cœur jaune, 3 flammes par case, fumée qui pâlit en vieillissant, monte à 2,2 m/s et dérive avec le vent de la bataille, qui pilote aussi `uWindDir` ; blé brûlé couché à 20 % et charbonneux, blé en feu teinté. **Sape** : déblais #9C7A52 plus hauts, six tas, abri couvert d’une peau, bouche de galerie au pied du mur, fagots évasés et irréguliers, chaussée finie en terre damée #A88A5C, étiquettes de chantier sur filet d’encre. **Projectiles** : traînée de 0,16 m en mélange normal avec tête chaude, boulet icosaèdre aplati #9A8D78, ombre teintée (0,20 ; 0,22 ; 0,36). |
| **J5b** | 09/10 | `2026-10-09-j5b-siege`, `j5b-works`, `j5b-weather` | — | — | — | — | — | — | **Revue du siège, de la météo et de l'interface après le ⛳ J5 : moyenne 5,4.** Par thème : siège 4,7, sape 4,5, nuit 5,7, pluie 4,8, brouillard 6,7, interface 5,8. Défauts relevés : ombres inversées sous la pluie, façade du château ardoise à l'ombre, cônes de garde envahissants, flaques bleues sous les engins, journal bavard, boutons hors palette. Le script de capture photographiait avant les chutes. |
| J5c | 09/10 | `2026-10-09-j5c-siege`, `j5c-weather`, `j5c-works` | — | — | — | — | — | — | Corrections J5b 1 à 5 et 7 à 10. **Pluie** : plus d'ombre portée ni de passe d'ombres, relèvement de l'ombre proportionnel au soleil (`uSunShare`), teinte d'ombre nulle sous la pluie et à 40 % dans le brouillard. **Gris à l'ombre** : chroma d'ombre 0,25 → 0,08, pierre enveloppée à 0,5, fer #45403C. **Engins** : anneaux 2,2 à 2,6 sans grandir avec le recul, bois éclairci ×1,25. **Cônes de garde** : ennemis seulement, visibles quand une unité est sélectionnée, opacité 0,09. **Fissures** en escalier le long des assises, #4A3A36, 0,3 m. **Effondrement** : blocs de 1,5 × 1,3 m, 35 % d'éclats, chute par colonnes, rideau de poussière de 24 bouffées. **Sape** : chaussée sur 55 % du créneau, fagots enfoncés, trois tas de déblais qui grossissent. **Nuit** : moins de rayures lunaires, disque de brume plus doux ; brouillard crème ; flammes des braseros posées au sol ; tuiles rondes désaturées. **Interface** : briefing d'ouverture, journal de 5 lignes qui replie les doublons, rappel effacé après la première sélection, boutons en bois. Captures déclenchées par l'événement joué (`__battle.playing`). |
| J7 | 10/10 | `2026-10-10-j7b`, `j7c`, `docs/captures/j7c-*` | — | — | — | — | — | — | **Passe de polish, sans revue notée (ADR-037).** Écus à talon aux armes des camps (chevron d’or sur azur, fasce de fer sur gueules) pour les soldats et gardes de rempart. Anneau des engins affiné (plus de flaque bleue sous le bélier). Écran-titre : rendu du jeu (Haute-Garde à 16 h 24, ombres longues des tours) au lieu du décor plat, menu sur feuille de parchemin au texte net. Sceau de cire pendant à la fleur de lys sur la carte de campagne. Plan d’ouverture : le château, puis l’armée. |
| Étape 3 | 15/10 | captures du scratchpad (lettre, briefing, héraut) | — | — | — | — | — | — | **Interface seule, sans revue notée (ADR-046 à 048).** Le gras d’Alegreya était simulé par le navigateur à partir de la graisse 500 : des lettres plus épaisses que d’autres dans un même mot, visibles même en rendu logiciel. La vraie graisse 700 la remplace, au même poids. Le fait d’armes d’un château s’ajoute à sa lettre (la tâche, puis le siège en italique, encre adoucie). Le bouton du héraut se place sous « Fin du tour », pour laisser libre le milieu du champ ; la leçon se range dessous, à la taille du texte choisie, ses boutons toujours visibles. |

Carte de bataille (J2 §12) : `docs/captures/2026-09-27-battle-v1…v3`, vues dérivées de la carte (`src/render/battle/views.ts`). Château complet (donjon, porterie, pont-levis) et pont de pierre à partir de battle-v2.

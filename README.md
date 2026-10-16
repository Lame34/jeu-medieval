# Siège

Un jeu de stratégie au tour par tour : à la tête de l’ost de la comtesse Isabeau, vous reprenez au Félon les cinq châteaux du Val d’Orle. Pont-levis, mouton, mangonneau, mines sous les murailles, beffroi : chaque château se prend à sa manière.

**Jouer :** https://jeu-medieval.vercel.app. Il faut un navigateur récent (Chrome, Edge ou Firefox) et un ordinateur capable d’afficher de la 3D (WebGL 2) ; rien à installer.

## Pour commencer
1. **Bataille d’essai.** Guillaume, le vieux chevalier, vous apprend le siège en quinze leçons, toujours sur le même fortin.
2. **Campagne.** La carte du Val d’Orle : choisissez un château, réunissez le conseil de guerre, scellez le plan d’un de vos trois compagnons (Aude, Bertrand ou Guillaume), puis donnez l’assaut. Votre rang règle la difficulté : **Écuyer** (une garnison clairsemée, plus de temps), **Chevalier**, ou **Baron** (une garnison au complet, moins de temps).
3. **Siège au hasard.** Un château tiré au sort, sans histoire.
4. **Lexique.** Les mots du siège, leur sens et leur âge. Tous sont attestés au XIIᵉ ou au XIIIᵉ siècle (Trésor de la langue française) : le mouton plutôt que le bélier, la coulisse plutôt que la herse. Dans le jeu, un mot souligné de pointillés donne son sens au survol.

Une garnison qui tombe à une poignée d’hommes debout se rend. Votre héraut peut la sommer de se rendre : plus elle a perdu d’hommes et de murs, plus elle est prête à traiter. Passé le délai, l’armée de secours lève le siège.

Chaque château donne quatre étendards : le château pris, pris vite, pris sans trop de pertes, et son **fait d’armes**, un exploit tiré d’un siège véritable (la mine de Château-Gaillard, le beffroi de Jérusalem…).

Entre deux sièges, **les tentes de l’ost** : chaque étendard y apporte dix marcs d’argent, de quoi payer l’ost, lier des fagots, fourbir les armes, engager deux sergents ou dresser un second mangonneau pour le siège suivant, ou faire venir le mire auprès d’un compagnon blessé. Et **la chronique** raconte la guerre château après château, d’après ce qui s’est vraiment passé dans chaque bataille, avec miniatures et lettrines dessinées par le jeu ; elle s’imprime.

## Commandes
| Touche | Effet |
|---|---|
| Clic gauche | Choisir un homme, le déplacer, attaquer |
| Deux doigts sur le pavé tactile | Déplacer la vue ; en pinçant, la rapprocher |
| Boutons sous la mini-carte | Pivoter, rapprocher, revenir sur vos hommes |
| Z Q S D ou flèches | Déplacer la vue (WASD sur un clavier QWERTY) |
| A et E, ou clic sur la molette | Faire pivoter la vue |
| Molette de la souris | Rapprocher ou éloigner la vue |
| Cadre tracé en glissant, ou Maj et clic | Choisir plusieurs hommes : ils marchent en rang et frappent ensemble |
| Tab | Homme suivant qui peut encore agir |
| C | Conseil de Guillaume : ce qu’il ferait à la place de l’homme choisi ; encore une fois pour le suivre |
| G · B · X · F | Garde · flèche enflammée · éteindre · travaux de siège |
| 1 · 2 | Capacités d’un héros |
| Entrée | Fin du tour |
| Échap, clic droit (toucher à deux doigts) | Annuler, désélectionner |
| M | Couper le son |

Un clic suffit : sur un ennemi (ou, pour un engin, sur une porte ou une muraille), l’homme choisi s’approche de lui-même s’il peut l’atteindre ce tour, puis frappe. Sur le sol, il marche jusqu’au point visé ; trop loin pour ce tour, il avance autant qu’il le peut. Au survol, l’aperçu annonce le chemin et la chance de toucher.

## Votre progression et vos données
- La progression (châteaux pris, étendards, options) et **la bataille en cours** sont enregistrées dans votre navigateur, après chaque ordre. Fermer la page ne fait rien perdre : au retour, le menu propose « Reprendre la bataille ».
- Le jeu n’envoie rien : pas de compte, pas de cookie, pas de mesure d’audience. Seul l’hébergeur (Vercel) voit, comme tout hébergeur, les connexions au site.
- Effacer les données du site dans le navigateur efface aussi la progression.

## Pour les développeurs
Three.js et React Three Fiber, TypeScript strict. La simulation (`src/core`) est déterministe : une bataille, c’est une graine, un scénario et la liste des ordres. Il faut Node 24.

```
npm ci
npm run dev          # serveur de développement sur http://localhost:5188
npm run typecheck    # typage
npm run lint         # règles du code, aucun avertissement toléré
npm test             # tests de la simulation (Vitest)
npm run e2e          # tests de bout en bout (Playwright, carte graphique réelle)
npm run build        # build de production dans dist/
```

- Architecture : `docs/ARCHITECTURE.md`.
- Décisions : `docs/DECISIONS.md`.
- Direction artistique : `docs/STYLE_BIBLE.md`.
- Consignes de travail : `CLAUDE.md`.

Chaque envoi sur `main` est vérifié par GitHub Actions (typage, règles du code, tests, build), puis déployé par Vercel.

## Crédits
Personnages, décors, sons et musiques sont sous licence libre CC0 (Quaternius, Kenney, OpenGameArt…) : la liste complète, avec les sources et les licences vérifiées, est dans `assets/CREDITS.md`. Les châteaux, le paysage, les engins et les écus sont produits par le code du jeu.

## Signaler un problème
Ouvrez une « issue » sur ce dépôt GitHub. Pour une faille de sécurité, décrivez-la sans la rendre publique en détail.

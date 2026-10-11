# Siège

Un jeu de stratégie au tour par tour : à la tête de l’ost de la comtesse Isabeau, vous reprenez au Félon les cinq châteaux du Val d’Orle. Pont-levis, bélier, mangonneau, mines sous les courtines, beffroi : chaque château se prend à sa manière.

**Jouer :** https://jeu-medieval.vercel.app. Il faut un navigateur récent (Chrome, Edge ou Firefox) et un ordinateur capable d’afficher de la 3D (WebGL 2) ; rien à installer.

## Pour commencer
1. **Bataille d’essai.** Guillaume, le vieux chevalier, vous apprend le siège en quinze leçons, toujours sur le même fortin.
2. **Campagne.** La carte du Val d’Orle : choisissez un château, réunissez le conseil de guerre, scellez le plan d’un de vos trois compagnons (Aude, Bertrand ou Guillaume), puis donnez l’assaut.
3. **Escarmouche.** Un château tiré au hasard, sans histoire.

Une garnison qui tombe à une poignée d’hommes debout se rend. Passé le délai, l’armée de secours lève le siège.

## Commandes
| Touche | Effet |
|---|---|
| Clic gauche | Choisir un homme, le déplacer, attaquer |
| Z Q S D ou flèches | Déplacer la vue (WASD sur un clavier QWERTY) |
| A et E, ou clic sur la molette | Faire pivoter la vue |
| Molette | Rapprocher ou éloigner la vue |
| Tab | Homme suivant qui peut encore agir |
| G · B · X · F | Garde · flèche enflammée · éteindre · travaux de siège |
| 1 · 2 | Capacités d’un héros |
| Entrée | Fin du tour |
| Échap | Annuler |
| M | Couper le son |

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

# Dix Balles

Les bons plans à 10 € maximum, partout en France. Site collaboratif sans compte et sans pub, projet étudiant (cours de Social selling, Paris School of Business). Instagram : [@10balle.s](https://www.instagram.com/10balle.s/).

## Comment c'est construit

- **Le site** est une page statique (`index.html`, `app.js`, `config.js`), hébergée gratuitement par GitHub Pages.
- **La base de données** est un projet Supabase gratuit : plans, notes, signalements et photos de preuve.
- **La carte** utilise OpenStreetMap ; la recherche d'adresse utilise la Géoplateforme de l'IGN.
- Si la base n'est pas joignable, le site affiche la base de départ (`data/plans.json`) en lecture seule.

## Mise en route (une seule fois)

### 1. Supabase

1. Dans le projet Supabase : **SQL Editor → New query**.
2. Colle le contenu de `supabase/schema.sql`, puis **Run**.
3. Nouvelle requête : colle `supabase/seed.sql` (les plans de départ), puis **Run**.
4. Nouvelle requête : colle `supabase/team.sql` après y avoir mis les e-mails de l'équipe, puis **Run**.
5. **Authentication → URL Configuration** : mets l'adresse du site dans *Site URL* (`https://10balles.github.io`) et ajoute-la dans *Redirect URLs*. Sans ça, le lien de connexion de l'équipe ne ramène pas sur le site.
6. **Project Settings → API** : copie la *Project URL* et la clé *publishable* (ou *anon*) dans `config.js`. Ne mets jamais la clé *secret* ou *service_role*.

### 2. GitHub Pages

1. Le code est sur la branche `main` du dépôt.
2. **Settings → Pages → Build and deployment** : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
3. Le site est en ligne au bout d'une ou deux minutes à l'adresse indiquée.

### 3. Garder la base active

Le plan gratuit de Supabase met en pause un projet sans activité pendant environ une semaine. La tâche `.github/workflows/garder-la-base-active.yml` interroge la base chaque jour. Vérifie dans l'onglet **Actions** qu'elle est activée. GitHub désactive les tâches planifiées d'un dépôt sans activité pendant 60 jours : il suffit alors de la relancer.

## Au quotidien (équipe)

- **Accès équipe** (en bas de page) : tu reçois un lien de connexion par e-mail. Seuls les e-mails listés dans la table `team` ont accès au mode équipe.
- **Bouton Équipe** : ajouts à valider (avec la photo de preuve), signalements, corbeille, générateur de carrousel Instagram.
- Dans chaque fiche : *Valider et publier*, *Refuser*, *Modifier*, *Vérifié aujourd'hui*, *Supprimer*.
- Les ajouts du public n'apparaissent qu'après validation par l'équipe.

## Règles du produit

10 € maximum · une preuve pour chaque plan · aucun lieu ne paie pour apparaître · pas de compte obligatoire · collaboratif, partout en France.

## Données de départ

`data/plans.json` contient les plans de départ avec leurs sources (copie de secours affichée si la base ne répond pas). `supabase/seed.sql` contient les mêmes plans pour remplir la base. Une fois la base en service, tout se modifie depuis le mode équipe du site.

## Licences

Leaflet (BSD-2), Leaflet.markercluster (MIT), supabase-js (MIT), JSZip (MIT), polices Big Shoulders Display, Atkinson Hyperlegible et DM Mono (SIL Open Font License) : voir `vendor/`.

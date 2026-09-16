# Bibliothèque Edgard Petit

Plateforme SaaS de gestion pour la Bibliothèque Edgard Petit, projet de l'Organisation de l'Union Haïtienne (OUH).

## Structure actuelle

- `index.html`: page d'accueil publique.
- `institution.html`: présentation institutionnelle enrichie à partir de ouhhaiti.org, avec accent sur l'axe éducation et la Bibliothèque Edgard Petit.
- `catalogue.html`: vitrine publique filtrable limitée à 20 ouvrages aléatoires renouvelés toutes les 4 heures; catalogue complet après connexion.
- `agenda.html`: vitrine limitée à 3 événements publiés avec flyer obligatoire, soit le plus proche, le passé le plus proche et le futur le plus proche; tous les événements publiés après connexion.
- `blog.html`: blog scientifique public avec tous les articles publiés, couverture obligatoire, partage social et galerie liée de 20 photos maximum par article.
- `galerie.html`: galerie publique dynamique avec photos publiées par l'administration, titres modifiables, filtres par album, lightbox et partage social.
- `auth.html`: sas Connexion / Demande d'inscription, avec accès adhérent visible et accès équipe discret.
- `adherent.html`: tableau de bord adhérent avec réservations, paiements et historique, accessible après connexion.
- `admin.html`: tableau de bord administration avec capacité, pointage, import Excel, paiements, galerie, blog, RBAC et relances, accessible après connexion équipe.
- `css/styles.css`: charte graphique, composants et responsive.
- `js/app.js`: interactions publiques, catalogue, événements, blog et modal d'authentification.
- `js/i18n.js`: traduction dynamique Français, Créole haïtien et Anglais.
- `js/data/content.js`: données de démonstration remplaçables par Supabase.
- `assets/gallery/`: albums photo optimisés pour la vitrine publique, utilisés comme secours quand Supabase ne renvoie aucune photo.
- `js/supabaseClient.js`: emplacement des variables publiques Supabase.
- `supabase/schema.sql`: tables, enum, triggers, index et politiques RLS de base.
- `supabase/02_content_modules.sql`: migration complémentaire pour les modules Catalogue, Événements, Blog, Galerie et Storage.
- `supabase/13_gallery_folder_import.sql`: colonnes et index nécessaires pour importer un dossier complet de photos dans la Galerie.

## Lancement local

Les modules JavaScript nécessitent un serveur local.

```bash
python -m http.server 5173
```

Puis ouvrir `http://localhost:5173`.

## Connexion Supabase

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans l'éditeur SQL.
3. Créer les buckets Storage: `blog-gallery`, `blog-covers`, `gallery-photos`, `event-flyers`, `excel-archives` et `payment-proofs`.
4. Exécuter `supabase/02_content_modules.sql` dans l'éditeur SQL.
5. Renseigner `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `js/supabaseClient.js`.

## Import de dossiers Galerie

1. Exécuter `supabase/13_gallery_folder_import.sql` dans l'éditeur SQL Supabase.
2. Vérifier que le bucket Storage `gallery-photos` existe et que le compte connecté possède `gallery.manage` ou `gallery.publish`.
3. Dans `admin/galerie.html`, utiliser `Import dossier` pour sélectionner un dossier local. Les images JPG, PNG et WebP sont envoyées dans Storage puis liées à `gallery_photos`.
4. Si des photos importées restent invisibles sur le site public, exécuter `supabase/14_publish_gallery_photos.sql` pour publier les photos déjà importées en brouillon.
5. Si le bucket contient des images mais que le site public reste vide, exécuter `supabase/15_public_gallery_storage.sql` pour autoriser la lecture publique des photos de galerie.

-- Bibliothèque Edgard Petit - publier les photos déjà importées.
-- À exécuter après supabase/13_gallery_folder_import.sql si la galerie publique est vide.

update public.gallery_photos
set status = 'published'::public.gallery_status
where status = 'draft'::public.gallery_status
  and storage_path is not null
  and length(trim(storage_path)) > 0;

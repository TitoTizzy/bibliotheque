-- Bibliothèque Edgard Petit - import automatique des dossiers galerie.
-- À exécuter après supabase/12_library_capacity_settings.sql.

alter table public.gallery_photos
  add column if not exists source_album text,
  add column if not exists source_file_name text,
  add column if not exists source_relative_path text,
  add column if not exists file_size bigint,
  add column if not exists captured_at timestamptz,
  add column if not exists import_batch_id uuid;

create unique index if not exists gallery_photos_storage_path_unique
on public.gallery_photos (storage_path);

create index if not exists gallery_photos_album_status_idx
on public.gallery_photos (album, status, sort_order, created_at desc);

create index if not exists gallery_photos_import_batch_idx
on public.gallery_photos (import_batch_id);

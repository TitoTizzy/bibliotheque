-- Bibliothèque Edgard Petit - Migration 11
-- Compteur catalogue centralisé.
-- À exécuter après supabase/10_book_details_identity.sql.

create or replace function public.count_catalog_books()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.books
  where nullif(trim(coalesce(title, '')), '') is not null
$$;

grant execute on function public.count_catalog_books() to anon, authenticated;

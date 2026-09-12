-- Bibliothèque Edgard Petit - Migration 09
-- Champs de détail des ouvrages pour la fiche catalogue.
-- À exécuter après les migrations précédentes.

alter table public.books
  add column if not exists summary text,
  add column if not exists description text;

create index if not exists books_category_idx
on public.books (category);

create index if not exists books_title_category_idx
on public.books using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category, ''))
);

create or replace view public.public_book_showcase as
select
  id,
  number,
  location,
  category,
  title,
  author,
  edition,
  language,
  ownership,
  created_at,
  summary,
  description
from public.books
order by md5(id::text || floor(extract(epoch from now()) / 14400)::text)
limit 20;

grant select on public.public_book_showcase to anon, authenticated;

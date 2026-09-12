-- Bibliothèque Edgard Petit - Migration 10
-- Sépare la fiche stable du livre de son emplacement physique.
-- À exécuter après supabase/09_book_details.sql.

create extension if not exists pgcrypto;

create or replace function public.normalize_book_text(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '[^[:alnum:]]+', ' ', 'g')
$$;

create or replace function public.make_book_detail_key(
  book_title text,
  book_author text,
  book_edition text,
  book_language text,
  book_category text
)
returns text
language sql
immutable
as $$
  select md5(
    public.normalize_book_text(book_title) || '|' ||
    public.normalize_book_text(book_author) || '|' ||
    public.normalize_book_text(book_edition)
  )
$$;

create table if not exists public.book_details (
  id uuid primary key default gen_random_uuid(),
  detail_key text not null unique,
  title text not null,
  author text,
  edition text,
  language text,
  category text,
  summary text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books
  add column if not exists detail_id uuid references public.book_details(id) on delete set null,
  add column if not exists detail_key text;

insert into public.book_details (
  detail_key,
  title,
  author,
  edition,
  language,
  category,
  summary,
  description
)
select distinct on (public.make_book_detail_key(title, author, edition, language, category))
  public.make_book_detail_key(title, author, edition, language, category),
  title,
  author,
  edition,
  language,
  category,
  summary,
  description
from public.books
where title is not null
on conflict (detail_key) do update
set
  title = excluded.title,
  author = excluded.author,
  edition = excluded.edition,
  language = coalesce(public.book_details.language, excluded.language),
  category = coalesce(public.book_details.category, excluded.category),
  summary = coalesce(public.book_details.summary, excluded.summary),
  description = coalesce(public.book_details.description, excluded.description),
  updated_at = now();

update public.books b
set
  detail_key = public.make_book_detail_key(b.title, b.author, b.edition, b.language, b.category),
  detail_id = d.id
from public.book_details d
where d.detail_key = public.make_book_detail_key(b.title, b.author, b.edition, b.language, b.category);

drop trigger if exists book_details_touch_updated_at on public.book_details;
create trigger book_details_touch_updated_at
before update on public.book_details
for each row execute function public.touch_updated_at();

alter table public.book_details enable row level security;

drop policy if exists "Authenticated can read book details" on public.book_details;
drop policy if exists "Staff can manage book details" on public.book_details;

create policy "Authenticated can read book details" on public.book_details
for select to authenticated
using (true);

create policy "Staff can manage book details" on public.book_details
for all to authenticated
using (public.has_any_permission(array['books.import.excel']))
with check (public.has_any_permission(array['books.import.excel']));

grant select on public.book_details to anon, authenticated;
grant insert, update, delete on public.book_details to authenticated;
grant execute on function public.normalize_book_text(text) to anon, authenticated;
grant execute on function public.make_book_detail_key(text, text, text, text, text) to anon, authenticated;

create or replace function public.sync_catalog_import(import_books jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_key text;
  saved_detail_id uuid;
  imported_locations text[] := array[]::text[];
begin
  if not public.has_any_permission(array['books.import.excel']) then
    raise exception 'permission_denied';
  end if;

  for item in select * from jsonb_array_elements(import_books)
  loop
    if nullif(trim(item->>'location'), '') is null or nullif(trim(item->>'title'), '') is null then
      continue;
    end if;

    item_key := public.make_book_detail_key(
      item->>'title',
      item->>'author',
      item->>'edition',
      item->>'language',
      item->>'category'
    );

    insert into public.book_details (
      detail_key,
      title,
      author,
      edition,
      language,
      category
    )
    values (
      item_key,
      trim(item->>'title'),
      nullif(trim(coalesce(item->>'author', '')), ''),
      nullif(trim(coalesce(item->>'edition', '')), ''),
      nullif(trim(coalesce(item->>'language', '')), ''),
      nullif(trim(coalesce(item->>'category', '')), '')
    )
    on conflict (detail_key) do update
    set
      title = excluded.title,
      author = excluded.author,
      edition = excluded.edition,
      language = coalesce(public.book_details.language, excluded.language),
      category = coalesce(public.book_details.category, excluded.category),
      updated_at = now()
    returning id into saved_detail_id;

    insert into public.books (
      number,
      location,
      category,
      title,
      author,
      edition,
      language,
      ownership,
      detail_key,
      detail_id,
      summary,
      description
    )
    select
      nullif(trim(coalesce(item->>'number', '')), ''),
      trim(item->>'location'),
      coalesce(nullif(trim(coalesce(item->>'category', '')), ''), 'Catalogue'),
      trim(item->>'title'),
      nullif(trim(coalesce(item->>'author', '')), ''),
      nullif(trim(coalesce(item->>'edition', '')), ''),
      nullif(trim(coalesce(item->>'language', '')), ''),
      nullif(trim(coalesce(item->>'ownership', '')), ''),
      item_key,
      saved_detail_id,
      bd.summary,
      bd.description
    from public.book_details bd
    where bd.id = saved_detail_id
    on conflict (location) do update
    set
      number = excluded.number,
      category = excluded.category,
      title = excluded.title,
      author = excluded.author,
      edition = excluded.edition,
      language = excluded.language,
      ownership = excluded.ownership,
      detail_key = excluded.detail_key,
      detail_id = excluded.detail_id,
      summary = excluded.summary,
      description = excluded.description;

    imported_locations := array_append(imported_locations, trim(item->>'location'));
  end loop;

  delete from public.books
  where location is not null
    and not (location = any(imported_locations));

  return coalesce(array_length(imported_locations, 1), 0);
end;
$$;

grant execute on function public.sync_catalog_import(jsonb) to authenticated;

create or replace function public.update_book_detail(
  target_book_id uuid,
  target_title text,
  target_author text,
  target_edition text,
  target_language text,
  target_category text,
  target_summary text,
  target_description text
)
returns public.book_details
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_detail_id uuid;
  saved_detail public.book_details;
begin
  if not public.has_any_permission(array['books.import.excel']) then
    raise exception 'permission_denied';
  end if;

  select detail_id into selected_detail_id
  from public.books
  where id = target_book_id;

  if selected_detail_id is null then
    raise exception 'book_detail_not_found';
  end if;

  update public.book_details
  set
    title = trim(target_title),
    author = nullif(trim(coalesce(target_author, '')), ''),
    edition = nullif(trim(coalesce(target_edition, '')), ''),
    language = nullif(trim(coalesce(target_language, '')), ''),
    category = coalesce(nullif(trim(coalesce(target_category, '')), ''), 'Catalogue'),
    summary = nullif(trim(coalesce(target_summary, '')), ''),
    description = nullif(trim(coalesce(target_description, '')), '')
  where id = selected_detail_id
  returning * into saved_detail;

  update public.books
  set
    title = saved_detail.title,
    author = saved_detail.author,
    edition = saved_detail.edition,
    language = saved_detail.language,
    category = saved_detail.category,
    summary = saved_detail.summary,
    description = saved_detail.description
  where detail_id = saved_detail.id;

  return saved_detail;
end;
$$;

grant execute on function public.update_book_detail(uuid, text, text, text, text, text, text, text) to authenticated;

drop view if exists public.public_book_showcase;
create view public.public_book_showcase as
select
  b.id,
  b.number,
  b.location,
  coalesce(d.category, b.category) as category,
  coalesce(d.title, b.title) as title,
  coalesce(d.author, b.author) as author,
  coalesce(d.edition, b.edition) as edition,
  coalesce(d.language, b.language) as language,
  b.ownership,
  b.created_at,
  coalesce(d.summary, b.summary) as summary,
  coalesce(d.description, b.description) as description
from public.books b
left join public.book_details d on d.id = b.detail_id
order by md5(b.id::text || floor(extract(epoch from now()) / 14400)::text)
limit 20;

grant select on public.public_book_showcase to anon, authenticated;

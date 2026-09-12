-- Bibliothèque Edgard Petit - Migration 02
-- Modules dynamiques: catalogue vitrine, événements, blog, galeries et storage.
-- À exécuter après supabase/schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.event_status as enum ('draft', 'published', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.content_visibility as enum ('public', 'private');
exception
  when duplicate_object then null;
end $$;

create or replace function public.has_any_permission(required_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements_text(public.current_permissions()) as permission(value)
    where permission.value = any(required_permissions)
  )
$$;

grant execute on function public.has_any_permission(text[]) to authenticated;

alter table public.events
  add column if not exists event_type text not null default 'Conférence',
  add column if not exists status public.event_status not null default 'draft',
  add column if not exists visibility public.content_visibility not null default 'public',
  add column if not exists location text,
  add column if not exists flyer_path text,
  add column if not exists flyer_alt text,
  add column if not exists payment_required boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.events
    add constraint events_flyer_required_when_published
    check (status <> 'published' or (flyer_path is not null and length(trim(flyer_path)) > 0));
exception
  when duplicate_object then null;
end $$;

alter table public.blog_posts
  add column if not exists slug text,
  add column if not exists excerpt text,
  add column if not exists category text not null default 'Éducation',
  add column if not exists cover_path text,
  add column if not exists cover_alt text,
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.blog_posts
    add constraint blog_cover_required_when_published
    check (status <> 'published' or (cover_path is not null and length(trim(cover_path)) > 0));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.blog_post_photos (
  id uuid primary key default gen_random_uuid(),
  blog_post_id uuid not null references public.blog_posts(id) on delete cascade,
  title text not null default 'Photo',
  storage_path text not null,
  alt_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gallery_photos
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

drop trigger if exists blog_posts_touch_updated_at on public.blog_posts;
create trigger blog_posts_touch_updated_at
before update on public.blog_posts
for each row execute function public.touch_updated_at();

drop trigger if exists blog_post_photos_touch_updated_at on public.blog_post_photos;
create trigger blog_post_photos_touch_updated_at
before update on public.blog_post_photos
for each row execute function public.touch_updated_at();

drop trigger if exists gallery_photos_touch_updated_at on public.gallery_photos;
create trigger gallery_photos_touch_updated_at
before update on public.gallery_photos
for each row execute function public.touch_updated_at();

create or replace function public.enforce_blog_photo_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.blog_post_photos
    where blog_post_id = new.blog_post_id
      and id <> new.id
  ) >= 20 then
    raise exception 'Un article de blog ne peut pas avoir plus de 20 photos.';
  end if;

  return new;
end;
$$;

drop trigger if exists blog_photo_limit_guard on public.blog_post_photos;
create trigger blog_photo_limit_guard
before insert or update on public.blog_post_photos
for each row execute function public.enforce_blog_photo_limit();

update public.roles_permissions
set permissions_json = (
  select jsonb_agg(distinct permission)
  from jsonb_array_elements_text(
    permissions_json || '[
      "events.manage",
      "blog.manage",
      "gallery.manage",
      "media.upload"
    ]'::jsonb
  ) as permission(permission)
)
where role_name = 'SuperAdmin';

update public.roles_permissions
set permissions_json = (
  select jsonb_agg(distinct permission)
  from jsonb_array_elements_text(
    permissions_json || '[
      "events.manage",
      "blog.manage",
      "gallery.manage",
      "media.upload"
    ]'::jsonb
  ) as permission(permission)
)
where role_name = 'Modérateur';

drop policy if exists "Public can read active catalog" on public.books;
drop policy if exists "Authenticated can read full catalog" on public.books;
drop policy if exists "Public can read events" on public.events;
drop policy if exists "Public can read published public events" on public.events;
drop policy if exists "Authenticated can read published events" on public.events;
drop policy if exists "Moderators can manage events" on public.events;
drop policy if exists "Public can read published blog posts" on public.blog_posts;
drop policy if exists "Public can read published gallery photos" on public.gallery_photos;
drop policy if exists "Moderators can manage blog posts" on public.blog_posts;
drop policy if exists "Moderators can manage gallery photos" on public.gallery_photos;

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
  created_at
from public.books
order by md5(id::text || floor(extract(epoch from now()) / 14400)::text)
limit 20;

grant select on public.public_book_showcase to anon, authenticated;

create policy "Authenticated can read full catalog" on public.books
for select to authenticated using (true);

create policy "Public can read published public events" on public.events
for select using (status = 'published' and visibility = 'public');

create policy "Authenticated can read published events" on public.events
for select to authenticated using (status = 'published');

create policy "Moderators can manage events" on public.events
for all to authenticated
using (public.has_any_permission(array['events.manage', 'events.payments.validate']))
with check (public.has_any_permission(array['events.manage', 'events.payments.validate']));

create policy "Public can read published blog posts" on public.blog_posts
for select using (status = 'published');

create policy "Moderators can manage blog posts" on public.blog_posts
for all to authenticated
using (public.has_any_permission(array['blog.manage', 'blog.publish']))
with check (public.has_any_permission(array['blog.manage', 'blog.publish']));

alter table public.blog_post_photos enable row level security;

drop policy if exists "Public can read published blog post photos" on public.blog_post_photos;
drop policy if exists "Moderators can manage blog post photos" on public.blog_post_photos;

create policy "Public can read published blog post photos" on public.blog_post_photos
for select using (
  exists (
    select 1
    from public.blog_posts bp
    where bp.id = blog_post_id
      and bp.status = 'published'
  )
);

create policy "Moderators can manage blog post photos" on public.blog_post_photos
for all to authenticated
using (public.has_any_permission(array['blog.manage', 'blog.publish']))
with check (public.has_any_permission(array['blog.manage', 'blog.publish']));

create policy "Public can read published gallery photos" on public.gallery_photos
for select using (status = 'published');

create policy "Moderators can manage gallery photos" on public.gallery_photos
for all to authenticated
using (public.has_any_permission(array['gallery.manage', 'gallery.publish']))
with check (public.has_any_permission(array['gallery.manage', 'gallery.publish']));

drop policy if exists "Public can read public media buckets" on storage.objects;
drop policy if exists "Staff can upload public media" on storage.objects;
drop policy if exists "Staff can update public media" on storage.objects;
drop policy if exists "Staff can delete public media" on storage.objects;
drop policy if exists "Authenticated users can upload payment proofs" on storage.objects;
drop policy if exists "Staff can read payment proofs and archives" on storage.objects;
drop policy if exists "Staff can manage private files" on storage.objects;

create policy "Public can read public media buckets" on storage.objects
for select using (
  bucket_id in ('blog-gallery', 'blog-covers', 'gallery-photos', 'event-flyers')
);

create policy "Staff can upload public media" on storage.objects
for insert to authenticated with check (
  bucket_id in ('blog-gallery', 'blog-covers', 'gallery-photos', 'event-flyers')
  and public.has_any_permission(array['media.upload', 'events.manage', 'blog.manage', 'blog.publish', 'gallery.manage', 'gallery.publish'])
);

create policy "Staff can update public media" on storage.objects
for update to authenticated
using (
  bucket_id in ('blog-gallery', 'blog-covers', 'gallery-photos', 'event-flyers')
  and public.has_any_permission(array['media.upload', 'events.manage', 'blog.manage', 'blog.publish', 'gallery.manage', 'gallery.publish'])
)
with check (
  bucket_id in ('blog-gallery', 'blog-covers', 'gallery-photos', 'event-flyers')
  and public.has_any_permission(array['media.upload', 'events.manage', 'blog.manage', 'blog.publish', 'gallery.manage', 'gallery.publish'])
);

create policy "Staff can delete public media" on storage.objects
for delete to authenticated
using (
  bucket_id in ('blog-gallery', 'blog-covers', 'gallery-photos', 'event-flyers')
  and public.has_any_permission(array['media.upload', 'events.manage', 'blog.manage', 'blog.publish', 'gallery.manage', 'gallery.publish'])
);

create policy "Authenticated users can upload payment proofs" on storage.objects
for insert to authenticated with check (bucket_id = 'payment-proofs');

create policy "Staff can read payment proofs and archives" on storage.objects
for select to authenticated using (
  bucket_id in ('payment-proofs', 'excel-archives')
  and public.has_any_permission(array['events.payments.validate', 'books.import.excel'])
);

create policy "Staff can manage private files" on storage.objects
for all to authenticated
using (
  bucket_id in ('payment-proofs', 'excel-archives')
  and public.has_any_permission(array['events.payments.validate', 'books.import.excel'])
)
with check (
  bucket_id in ('payment-proofs', 'excel-archives')
  and public.has_any_permission(array['events.payments.validate', 'books.import.excel'])
);

create unique index if not exists blog_posts_slug_key
on public.blog_posts (slug)
where slug is not null;

create index if not exists events_public_date_idx
on public.events (status, visibility, event_date);

create index if not exists blog_post_photos_post_sort_idx
on public.blog_post_photos (blog_post_id, sort_order, created_at);

create index if not exists gallery_photos_status_sort_idx
on public.gallery_photos (status, sort_order, created_at desc);

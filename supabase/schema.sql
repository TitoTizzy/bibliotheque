-- Bibliothèque Edgard Petit - Supabase schema, triggers and RLS policies
-- Run this file in the Supabase SQL editor after creating the project.

create extension if not exists pgcrypto;

create type public.profile_status as enum ('pending', 'active', 'suspended', 'archived');
create type public.appointment_type as enum ('workspace_only', 'books_only', 'workspace_and_books');
create type public.appointment_status as enum ('pending', 'confirmed', 'clocked_in', 'completed', 'expired', 'cancelled');
create type public.payment_status as enum ('pending', 'submitted', 'validated', 'rejected', 'cancelled');
create type public.blog_status as enum ('draft', 'published', 'archived');
create type public.gallery_status as enum ('draft', 'published', 'archived');

create table public.roles_permissions (
  id uuid primary key default gen_random_uuid(),
  role_name text not null unique,
  permissions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  member_code text unique,
  member_type text not null default 'VISITOR',
  role_id uuid references public.roles_permissions(id) on delete set null,
  status public.profile_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  number text,
  location text not null unique,
  category text not null,
  title text not null,
  author text,
  edition text,
  language text,
  ownership text,
  created_at timestamptz not null default now()
);

create table public.excel_archives (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.appointment_type not null,
  reservation_date date not null,
  start_time time not null,
  duration_hours numeric(4,2) not null check (duration_hours > 0 and duration_hours <= 12),
  clock_in timestamptz,
  clock_out timestamptz,
  consulted_books uuid[] not null default '{}',
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date timestamptz not null,
  capacity integer not null check (capacity > 0),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  created_at timestamptz not null default now()
);

create table public.event_discounts (
  id uuid primary key default gen_random_uuid(),
  member_type_prefix text not null unique,
  discount_percentage numeric(5,2) not null check (discount_percentage >= 0 and discount_percentage <= 100)
);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  discount_applied numeric(5,2) not null default 0 check (discount_applied >= 0 and discount_applied <= 100),
  final_price numeric(12,2) not null default 0 check (final_price >= 0),
  payment_proof_url text,
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  author_name text not null,
  auditor_name text not null,
  published_by uuid references public.profiles(id) on delete set null,
  status public.blog_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  album text not null default 'Vie de la bibliothèque',
  storage_path text not null,
  alt_text text not null,
  published_by uuid references public.profiles(id) on delete set null,
  status public.gallery_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.roles_permissions (role_name, permissions_json)
values
  ('SuperAdmin', '["system.settings.edit","appointments.clockin_out","books.import.excel","blog.publish","gallery.publish","events.payments.validate","roles.permissions.manage"]'),
  ('Modérateur', '["blog.publish","gallery.publish","events.payments.validate"]'),
  ('Bibliothécaire', '["appointments.clockin_out","books.import.excel"]')
on conflict (role_name) do nothing;

insert into public.event_discounts (member_type_prefix, discount_percentage)
values
  ('OUH', 100),
  ('ET-FMP', 50),
  ('ET', 25),
  ('PRO', 10)
on conflict (member_type_prefix) do nothing;

insert into public.system_settings (key, value)
values ('library_capacity', '{"max_places": 20}'::jsonb)
on conflict (key) do nothing;

create or replace function public.current_permissions()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(rp.permissions_json, '[]'::jsonb)
  from public.profiles p
  left join public.roles_permissions rp on rp.id = p.role_id
  where p.id = auth.uid()
$$;

create or replace function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_permissions() ? permission, false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.expire_late_appointments()
returns trigger
language plpgsql
as $$
declare
  reservation_start timestamptz;
  reservation_end timestamptz;
begin
  reservation_start := (new.reservation_date::text || ' ' || new.start_time::text)::timestamptz;
  reservation_end := reservation_start + (new.duration_hours * interval '1 hour');

  if new.clock_in is not null and new.clock_in >= reservation_end - interval '30 minutes' then
    new.status := 'expired';
  end if;

  return new;
end;
$$;

create trigger appointments_late_arrival_guard
before insert or update of clock_in on public.appointments
for each row execute function public.expire_late_appointments();

create or replace function public.submit_payment_proof(registration_id uuid, proof_url text)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_registration public.event_registrations;
begin
  update public.event_registrations
  set payment_proof_url = proof_url,
      status = 'submitted'
  where id = registration_id
    and user_id = auth.uid()
    and status in ('pending', 'rejected')
  returning * into updated_registration;

  if updated_registration.id is null then
    raise exception 'registration_not_found_or_not_editable';
  end if;

  return updated_registration;
end;
$$;

alter table public.roles_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.excel_archives enable row level security;
alter table public.appointments enable row level security;
alter table public.events enable row level security;
alter table public.event_discounts enable row level security;
alter table public.event_registrations enable row level security;
alter table public.blog_posts enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.system_settings enable row level security;

create policy "Public can read active catalog" on public.books
for select using (true);

create policy "Public can read events" on public.events
for select using (true);

create policy "Public can read discounts" on public.event_discounts
for select using (true);

create policy "Public can read published blog posts" on public.blog_posts
for select using (status = 'published');

create policy "Public can read published gallery photos" on public.gallery_photos
for select using (status = 'published');

create policy "Users can read own profile" on public.profiles
for select using (auth.uid() = id or public.has_permission('roles.permissions.manage'));

create policy "Users can update own basic profile" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Admins can manage roles" on public.roles_permissions
for all using (public.has_permission('roles.permissions.manage')) with check (public.has_permission('roles.permissions.manage'));

create policy "Librarians can manage books" on public.books
for all using (public.has_permission('books.import.excel')) with check (public.has_permission('books.import.excel'));

create policy "Librarians can read excel archives" on public.excel_archives
for select using (public.has_permission('books.import.excel'));

create policy "Librarians can insert excel archives" on public.excel_archives
for insert with check (public.has_permission('books.import.excel'));

create policy "Users can manage own appointments" on public.appointments
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Staff can manage all appointments" on public.appointments
for all using (public.has_permission('appointments.clockin_out')) with check (public.has_permission('appointments.clockin_out'));

create policy "Users can read own registrations" on public.event_registrations
for select using (auth.uid() = user_id or public.has_permission('events.payments.validate'));

create policy "Users can create own registrations" on public.event_registrations
for insert with check (auth.uid() = user_id);

create policy "Admins can validate payments" on public.event_registrations
for update using (public.has_permission('events.payments.validate')) with check (public.has_permission('events.payments.validate'));

create policy "Moderators can manage blog posts" on public.blog_posts
for all using (public.has_permission('blog.publish')) with check (public.has_permission('blog.publish'));

create policy "Moderators can manage gallery photos" on public.gallery_photos
for all using (public.has_permission('gallery.publish')) with check (public.has_permission('gallery.publish'));

create policy "SuperAdmin can manage settings" on public.system_settings
for all using (public.has_permission('system.settings.edit')) with check (public.has_permission('system.settings.edit'));

create policy "Authenticated can read settings" on public.system_settings
for select using (auth.role() = 'authenticated');

create index appointments_date_time_idx on public.appointments (reservation_date, start_time, status);
create index books_search_idx on public.books using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(author, '') || ' ' || coalesce(category, '')));
create index events_date_idx on public.events (event_date);
create index blog_posts_status_created_idx on public.blog_posts (status, created_at desc);
create index gallery_photos_status_created_idx on public.gallery_photos (status, created_at desc);

grant execute on function public.submit_payment_proof(uuid, text) to authenticated;

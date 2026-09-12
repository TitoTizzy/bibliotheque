-- Bibliothèque Edgard Petit - Migration 08
-- Réparation des permissions d'import Excel du catalogue.
-- À exécuter si l'interface affiche un refus Supabase pendant l'import catalogue.

create extension if not exists pgcrypto;

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

insert into public.roles_permissions (role_name, permissions_json)
values
  ('SuperAdmin', '[
    "system.settings.edit",
    "appointments.clockin_out",
    "books.import.excel",
    "blog.publish",
    "gallery.publish",
    "events.payments.validate",
    "roles.permissions.manage",
    "events.manage",
    "blog.manage",
    "gallery.manage",
    "media.upload",
    "profiles.approve",
    "profiles.create",
    "profiles.access.manage",
    "admin.accounts.manage"
  ]'::jsonb),
  ('Bibliothécaire', '[
    "appointments.clockin_out",
    "books.import.excel"
  ]'::jsonb)
on conflict (role_name) do update
set permissions_json = excluded.permissions_json;

insert into public.profiles (
  id,
  full_name,
  email,
  member_type,
  role_id,
  status
)
select
  au.id,
  coalesce(au.raw_user_meta_data->>'full_name', 'Administrateur OUH'),
  lower(au.email),
  'OUH-SUPERADMIN',
  rp.id,
  'active'::public.profile_status
from auth.users au
cross join public.roles_permissions rp
where lower(au.email) = 'ouhhaiti@gmail.com'
  and rp.role_name = 'SuperAdmin'
on conflict (id) do update
set
  full_name = excluded.full_name,
  email = excluded.email,
  member_type = excluded.member_type,
  role_id = excluded.role_id,
  status = excluded.status;

grant select, insert, update, delete on public.books to authenticated;
grant select, insert on public.excel_archives to authenticated;

drop policy if exists "Librarians can manage books" on public.books;
drop policy if exists "Staff can manage books import" on public.books;
create policy "Staff can manage books import" on public.books
for all to authenticated
using (public.has_any_permission(array['books.import.excel']))
with check (public.has_any_permission(array['books.import.excel']));

drop policy if exists "Librarians can read excel archives" on public.excel_archives;
drop policy if exists "Librarians can insert excel archives" on public.excel_archives;
drop policy if exists "Staff can read excel archives" on public.excel_archives;
drop policy if exists "Staff can insert excel archives" on public.excel_archives;
create policy "Staff can read excel archives" on public.excel_archives
for select to authenticated
using (public.has_any_permission(array['books.import.excel']));

create policy "Staff can insert excel archives" on public.excel_archives
for insert to authenticated
with check (public.has_any_permission(array['books.import.excel']));

drop policy if exists "Staff can read payment proofs and archives" on storage.objects;
drop policy if exists "Staff can manage private files" on storage.objects;
drop policy if exists "Staff can read excel archive files" on storage.objects;
drop policy if exists "Staff can upload excel archive files" on storage.objects;
drop policy if exists "Staff can update excel archive files" on storage.objects;
drop policy if exists "Staff can delete excel archive files" on storage.objects;

create policy "Staff can read excel archive files" on storage.objects
for select to authenticated
using (
  bucket_id = 'excel-archives'
  and public.has_any_permission(array['books.import.excel'])
);

create policy "Staff can upload excel archive files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'excel-archives'
  and public.has_any_permission(array['books.import.excel'])
);

create policy "Staff can update excel archive files" on storage.objects
for update to authenticated
using (
  bucket_id = 'excel-archives'
  and public.has_any_permission(array['books.import.excel'])
)
with check (
  bucket_id = 'excel-archives'
  and public.has_any_permission(array['books.import.excel'])
);

create policy "Staff can delete excel archive files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'excel-archives'
  and public.has_any_permission(array['books.import.excel'])
);

create policy "Staff can read payment proofs and archives" on storage.objects
for select to authenticated
using (
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

select
  p.email,
  p.status,
  p.member_type,
  rp.role_name,
  rp.permissions_json ? 'books.import.excel' as can_import_excel,
  rp.permissions_json ? 'admin.accounts.manage' as can_manage_admin_accounts
from public.profiles p
left join public.roles_permissions rp on rp.id = p.role_id
where lower(p.email) = 'ouhhaiti@gmail.com';

-- Bibliothèque Edgard Petit - Migration 03
-- Activation fiable du premier SuperAdmin.
-- À exécuter après avoir créé le compte Auth ouhhaiti@gmail.com.

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
  au.email,
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

drop policy if exists "Authenticated can read role names" on public.roles_permissions;
create policy "Authenticated can read role names" on public.roles_permissions
for select to authenticated
using (true);

select
  p.id,
  p.email,
  p.full_name,
  p.status,
  p.member_type,
  r.role_name
from public.profiles p
left join public.roles_permissions r on r.id = p.role_id
where p.email = 'ouhhaiti@gmail.com';

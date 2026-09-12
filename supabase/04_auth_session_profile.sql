-- Bibliothèque Edgard Petit - Migration 04
-- Lecture fiable du profil connecté pour le front.
-- À exécuter si le login fonctionne mais que le site affiche encore "compte pas activé".

create or replace function public.get_my_session_profile()
returns table (
  id uuid,
  full_name text,
  email text,
  member_type text,
  status public.profile_status,
  role_name text,
  permissions_json jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.email,
    p.member_type,
    p.status,
    rp.role_name,
    coalesce(rp.permissions_json, '[]'::jsonb) as permissions_json
  from public.profiles p
  left join public.roles_permissions rp on rp.id = p.role_id
  where p.id = auth.uid()
$$;

grant execute on function public.get_my_session_profile() to authenticated;

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

select *
from public.get_my_session_profile();

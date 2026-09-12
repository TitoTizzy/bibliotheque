-- Bibliothèque Edgard Petit - Migration 06
-- Pouvoirs SuperAdmin: validation des comptes, création de profils et modification des accès.
-- À exécuter après supabase/05_adherent_space.sql.

update public.roles_permissions
set permissions_json = '[
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
  "profiles.access.manage"
]'::jsonb
where role_name = 'SuperAdmin';

drop policy if exists "SuperAdmin can manage profiles" on public.profiles;
create policy "SuperAdmin can manage profiles" on public.profiles
for all to authenticated
using (public.has_permission('profiles.access.manage') or public.has_permission('roles.permissions.manage'))
with check (public.has_permission('profiles.access.manage') or public.has_permission('roles.permissions.manage'));

create or replace function public.admin_create_profile_for_auth_user(
  target_email text,
  target_full_name text,
  target_member_code text default null,
  target_member_type text default 'VISITOR',
  target_role_name text default null,
  target_status public.profile_status default 'active'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
  selected_role_id uuid;
  saved_profile public.profiles;
begin
  if not (public.has_permission('profiles.create') or public.has_permission('roles.permissions.manage')) then
    raise exception 'permission_denied';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'auth_user_not_found';
  end if;

  if target_role_name is not null and length(trim(target_role_name)) > 0 then
    select id into selected_role_id
    from public.roles_permissions
    where role_name = target_role_name
    limit 1;
  end if;

  insert into public.profiles (
    id,
    full_name,
    email,
    member_code,
    member_type,
    role_id,
    status
  )
  values (
    target_user_id,
    trim(target_full_name),
    lower(trim(target_email)),
    nullif(trim(target_member_code), ''),
    coalesce(nullif(trim(target_member_type), ''), 'VISITOR'),
    selected_role_id,
    target_status
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    member_code = excluded.member_code,
    member_type = excluded.member_type,
    role_id = excluded.role_id,
    status = excluded.status
  returning * into saved_profile;

  return saved_profile;
end;
$$;

create or replace function public.admin_update_profile_access(
  target_profile_id uuid,
  target_full_name text,
  target_member_code text,
  target_member_type text,
  target_role_name text,
  target_status public.profile_status
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_role_id uuid;
  saved_profile public.profiles;
begin
  if not (public.has_permission('profiles.access.manage') or public.has_permission('roles.permissions.manage')) then
    raise exception 'permission_denied';
  end if;

  if target_role_name is not null and length(trim(target_role_name)) > 0 then
    select id into selected_role_id
    from public.roles_permissions
    where role_name = target_role_name
    limit 1;
  end if;

  update public.profiles
  set
    full_name = trim(target_full_name),
    member_code = nullif(trim(target_member_code), ''),
    member_type = coalesce(nullif(trim(target_member_type), ''), 'VISITOR'),
    role_id = selected_role_id,
    status = target_status
  where id = target_profile_id
  returning * into saved_profile;

  if saved_profile.id is null then
    raise exception 'profile_not_found';
  end if;

  return saved_profile;
end;
$$;

grant execute on function public.admin_create_profile_for_auth_user(text, text, text, text, text, public.profile_status) to authenticated;
grant execute on function public.admin_update_profile_access(uuid, text, text, text, text, public.profile_status) to authenticated;

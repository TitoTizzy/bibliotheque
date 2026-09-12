-- Bibliothèque Edgard Petit - Migration 05
-- Espace adhérent: capacité globale consultable sans exposer les rendez-vous des autres membres.
-- À exécuter après supabase/04_auth_session_profile.sql.

create or replace function public.get_library_capacity_status()
returns table (
  max_places integer,
  occupied_places integer,
  available_places integer
)
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select coalesce((value->>'max_places')::integer, 20) as max_places
    from public.system_settings
    where key = 'library_capacity'
  ),
  capacity as (
    select coalesce((select max_places from settings), 20) as max_places
  ),
  occupancy as (
    select count(*)::integer as occupied_places
    from public.appointments
    where reservation_date = current_date
      and status in ('confirmed', 'clocked_in')
  )
  select
    capacity.max_places,
    occupancy.occupied_places,
    greatest(capacity.max_places - occupancy.occupied_places, 0) as available_places
  from capacity, occupancy;
$$;

grant execute on function public.get_library_capacity_status() to anon, authenticated;

-- Bibliothèque Edgard Petit - Migration 12
-- Capacité de pointage modifiable par le SuperAdmin.
-- À exécuter après supabase/11_catalog_count_and_alpha.sql.

create or replace function public.update_library_capacity(new_max_places integer)
returns table (
  max_places integer,
  occupied_places integer,
  available_places integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'superadmin_required';
  end if;

  if new_max_places is null or new_max_places < 1 then
    raise exception 'invalid_capacity';
  end if;

  insert into public.system_settings (key, value, updated_by)
  values (
    'library_capacity',
    jsonb_build_object('max_places', new_max_places),
    auth.uid()
  )
  on conflict (key) do update
  set
    value = excluded.value,
    updated_by = auth.uid(),
    updated_at = now();

  return query
  select *
  from public.get_library_capacity_status();
end;
$$;

grant execute on function public.update_library_capacity(integer) to authenticated;

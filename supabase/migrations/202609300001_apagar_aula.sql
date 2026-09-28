-- Apagar aula: professor ou dono pode apagar qualquer aula da equipe
-- (antiga, nova ou futura). Presenças e fotos são removidas junto
-- (cascade). Retorna os caminhos das fotos no Storage para o app limpar.
create function public.delete_session(p_session uuid) returns text[] language plpgsql
security definer set search_path='' as $$
declare
  v public.class_sessions := public.session_for_staff(p_session);
  v_paths text[];
begin
  select array_agg(path) into v_paths from public.session_photos where session_id = p_session;
  delete from public.class_sessions where id = p_session;
  return coalesce(v_paths, '{}');
end $$;
revoke all on function public.delete_session(uuid) from public, anon;
grant execute on function public.delete_session(uuid) to authenticated;

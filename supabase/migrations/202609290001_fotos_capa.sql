-- Fotos podem ser adicionadas a qualquer aula não cancelada (inclusive futura),
-- e list_sessions informa a foto de capa (a primeira) de cada aula.
create or replace function public.add_session_photo(p_session uuid, p_path text, p_caption text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_id uuid;
begin
 if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
 if p_path is null or p_path !~ ('^' || v.team_id::text || '/' || v.id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|webp)$') then
  raise exception 'Local da foto inválido.'; end if;
 if (select count(*) from public.session_photos where session_id = v.id) >= 20 then raise exception 'Limite de 20 fotos por aula.'; end if;
 if length(p_caption) > 200 then raise exception 'A legenda pode ter até 200 caracteres.'; end if;
 insert into public.session_photos(team_id, session_id, path, caption, created_by)
  values (v.team_id, v.id, p_path, nullif(trim(p_caption), ''), auth.uid()) returning id into v_id;
 return v_id;
end $$;

create or replace function public.list_sessions(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.require_member(); v_staff boolean := public.is_teacher();
begin
 if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'Período inválido.'; end if;
 perform public.generate_sessions(v_team, least(p_to, public.today_sp() + 56));
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', s.id, 'title', s.title, 'startsAt', s.starts_at, 'durationMin', s.duration_min, 'status', s.status,
   'cancelReason', s.cancel_reason, 'description', s.description, 'scheduleId', s.schedule_id,
   'photos', (select count(*) from public.session_photos p where p.session_id = s.id),
   'cover', (select p.path from public.session_photos p where p.session_id = s.id order by p.created_at, p.id limit 1),
   'checkins', (select count(*) from public.attendances a where a.session_id = s.id and a.status <> 'rejeitada'),
   'pending', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'pendente') end,
   'confirmed', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'confirmada') end,
   'mine', (select a.status from public.attendances a where a.session_id = s.id and a.student_id = auth.uid()))
   order by s.starts_at)
  from public.class_sessions s
  where s.team_id = v_team and (s.starts_at at time zone 'America/Sao_Paulo')::date between p_from and p_to), '[]'::jsonb);
end $$;

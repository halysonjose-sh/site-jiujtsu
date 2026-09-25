-- Diário de treinos: descrição e fotos de cada aula, visíveis para toda a equipe.
-- Os arquivos ficam no Storage (bucket privado session-photos, pasta {equipe}/{aula}/);
-- o banco guarda só o caminho, a legenda e quem enviou.

create table public.session_photos (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.teams(id) on delete cascade,
 session_id uuid not null references public.class_sessions(id) on delete cascade,
 path text not null unique,
 caption text check (length(caption) <= 200),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index session_photos_session on public.session_photos(session_id, created_at);
alter table public.session_photos enable row level security;
revoke all on public.session_photos from anon, authenticated;

create function public.update_session_description(p_session uuid, p_description text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.session_for_staff(p_session);
 if length(p_description) > 2000 then raise exception 'A descrição pode ter até 2000 caracteres.'; end if;
 update public.class_sessions set description = nullif(trim(p_description), '') where id = p_session;
end $$;

create function public.add_session_photo(p_session uuid, p_path text, p_caption text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_id uuid;
begin
 if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
 if v.starts_at > now() then raise exception 'Fotos só podem ser adicionadas depois do início da aula.'; end if;
 if p_path is null or p_path !~ ('^' || v.team_id::text || '/' || v.id::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|webp)$') then
  raise exception 'Local da foto inválido.'; end if;
 if (select count(*) from public.session_photos where session_id = v.id) >= 20 then raise exception 'Limite de 20 fotos por aula.'; end if;
 if length(p_caption) > 200 then raise exception 'A legenda pode ter até 200 caracteres.'; end if;
 insert into public.session_photos(team_id, session_id, path, caption, created_by)
  values (v.team_id, v.id, p_path, nullif(trim(p_caption), ''), auth.uid()) returning id into v_id;
 return v_id;
end $$;

-- Apaga o registro e devolve o caminho; o aplicativo remove o arquivo do Storage em seguida.
create function public.delete_session_photo(p_photo uuid) returns text language plpgsql security definer set search_path='' as $$
declare v_path text;
begin
 perform public.require_teacher();
 delete from public.session_photos where id = p_photo and team_id = public.my_team() returning path into v_path;
 if v_path is null then raise exception 'Foto não encontrada.'; end if;
 return v_path;
end $$;

-- Diário de uma aula para qualquer membro ativo da equipe.
create function public.session_journal(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member();
begin
 select * into v from public.class_sessions where id = p_session and team_id = v_team;
 if not found then raise exception 'Aula não encontrada.'; end if;
 return jsonb_build_object('id', v.id, 'teamId', v.team_id, 'title', v.title, 'startsAt', v.starts_at, 'durationMin', v.duration_min,
  'status', v.status, 'cancelReason', v.cancel_reason, 'description', v.description,
  'mine', (select a.status from public.attendances a where a.session_id = v.id and a.student_id = auth.uid()),
  'present', (select count(*) from public.attendances a where a.session_id = v.id and a.status = 'confirmada'),
  'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.path, 'caption', p.caption) order by p.created_at)
   from public.session_photos p where p.session_id = v.id), '[]'::jsonb));
end $$;

-- list_sessions passa a informar quantas fotos cada aula tem e se tem descrição.
create or replace function public.list_sessions(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.require_member(); v_staff boolean := public.is_teacher();
begin
 if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'Período inválido.'; end if;
 perform public.generate_sessions(v_team, least(p_to, public.today_sp() + 56));
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', s.id, 'title', s.title, 'startsAt', s.starts_at, 'durationMin', s.duration_min, 'status', s.status,
   'cancelReason', s.cancel_reason, 'description', s.description, 'scheduleId', s.schedule_id,
   'photos', (select count(*) from public.session_photos p where p.session_id = s.id),
   'checkins', (select count(*) from public.attendances a where a.session_id = s.id and a.status <> 'rejeitada'),
   'pending', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'pendente') end,
   'confirmed', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'confirmada') end,
   'mine', (select a.status from public.attendances a where a.session_id = s.id and a.student_id = auth.uid()))
   order by s.starts_at)
  from public.class_sessions s
  where s.team_id = v_team and (s.starts_at at time zone 'America/Sao_Paulo')::date between p_from and p_to), '[]'::jsonb);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
 public.today_sp(), public.is_teacher(), public.get_settings(), public.update_settings(integer, text), public.update_team(text, text, text),
 public.approve_member(uuid, boolean), public.set_member_role(uuid, text),
 public.student_detail(uuid), public.list_students(), public.set_initial(uuid, text, integer, integer),
 public.graduate_student(uuid, text, uuid, integer), public.undo_graduation(uuid, uuid, integer),
 public.create_schedule(text, smallint[], time, integer, date), public.update_schedule(uuid, text, smallint[], time, integer, date),
 public.end_schedule(uuid, date), public.list_schedules(),
 public.create_session(text, timestamptz, integer, text), public.cancel_session(uuid, text),
 public.list_sessions(date, date), public.session_detail(uuid),
 public.checkin(uuid), public.cancel_checkin(uuid), public.review_presence(uuid, uuid, text),
 public.teacher_add_presence(uuid, uuid), public.teacher_remove_presence(uuid, uuid),
 public.update_session_description(uuid, text), public.add_session_photo(uuid, text, text),
 public.delete_session_photo(uuid), public.session_journal(uuid),
 public.my_team(), public.shares_team(uuid)
to authenticated;

-- Storage: só existe no Supabase (os testes locais em PGlite pulam este bloco).
do $storage$
begin
 if to_regclass('storage.buckets') is null then return; end if;
 insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('session-photos', 'session-photos', false, 3145728, array['image/jpeg','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/webp'];
 execute $p$create policy "fotos do treino: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'session-photos' and (storage.foldername(name))[1] = public.my_team()::text)$p$;
 execute $p$create policy "fotos do treino: professor envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'session-photos' and public.is_teacher() and (storage.foldername(name))[1] = public.my_team()::text)$p$;
 execute $p$create policy "fotos do treino: professor apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'session-photos' and public.is_teacher() and (storage.foldername(name))[1] = public.my_team()::text)$p$;
end
$storage$;

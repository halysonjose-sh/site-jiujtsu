-- Perfil do aluno: foto, contato, data de nascimento, data de entrada visível,
-- status "inativo" (parou de treinar; distinto de bloqueado), observação na
-- graduação e contagem de aulas realizadas desde a entrada (para frequência).
-- Decisão registrada: aluno "inativo" perde o acesso ao app (my_team() segue
-- exigindo 'ativo'); o professor mantém o histórico e pode reativar.

alter table public.profiles
 add column avatar_path text,
 add column contact text check (length(trim(contact)) <= 120),
 add column birth_date date check (birth_date <= public.today_sp());

alter table public.graduations
 add column note text check (length(trim(note)) <= 300);

alter table public.team_members drop constraint team_members_status_check;
alter table public.team_members
 add constraint team_members_status_check check (status in ('pendente','ativo','inativo','bloqueado'));

-- ---------------------------------------------------------------- graduação com observação
create or replace function public.set_initial(p_student uuid, p_belt text, p_degrees integer, p_revision integer, p_note text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_student(p_student, p_revision);
 if exists(select 1 from public.graduations where student_id = p_student) then raise exception 'A situação inicial já foi definida ou existe uma graduação.'; end if;
 insert into public.graduations(student_id, actor_id, kind, belt, degrees, team_id, note)
  values (p_student, auth.uid(), 'initial', p_belt, p_degrees, public.my_team(), nullif(trim(coalesce(p_note, '')), ''));
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;
create or replace function public.graduate_student(p_student uuid, p_kind text, p_key uuid, p_revision integer, p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_belt text := 'branca'; v_degrees integer := 0; v_belts text[] := array['branca','azul','roxa','marrom','preta']; v_existing public.graduations;
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_student(p_student);
 if p_key is null then raise exception 'Identificador obrigatório.'; end if;
 select * into v_existing from public.graduations where id = p_key;
 if found then
  if v_existing.student_id <> p_student or v_existing.kind <> p_kind then raise exception 'Operação inválida.'; end if;
  return;
 end if;
 perform public.lock_student(p_student, p_revision);
 select belt, degrees into v_belt, v_degrees from public.graduations where student_id = p_student and cancelled_at is null order by sequence desc limit 1;
 v_belt := coalesce(v_belt, 'branca'); v_degrees := coalesce(v_degrees, 0);
 if p_kind = 'grau' then
  if v_belt = 'preta' or v_degrees >= 4 then raise exception 'Não é possível conceder outro grau nesta faixa.'; end if;
  v_degrees := v_degrees + 1;
 elsif p_kind = 'faixa' then
  if v_belt = 'preta' then raise exception 'A faixa preta encerra as promoções nesta versão.'; end if;
  v_belt := v_belts[array_position(v_belts, v_belt) + 1]; v_degrees := 0;
 else raise exception 'Graduação inválida.'; end if;
 insert into public.graduations(id, student_id, actor_id, kind, belt, degrees, team_id, note)
  values (p_key, p_student, auth.uid(), p_kind, v_belt, v_degrees, public.my_team(), nullif(trim(coalesce(p_note, '')), ''));
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;

-- ---------------------------------------------------------------- resumo do aluno com perfil
create or replace function public.student_detail(p_student uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_profile public.profiles; v_member public.team_members; v_belt text; v_degrees integer; v_cutoff date; v_total bigint; v_cycle bigint; v_team uuid;
begin
 v_team := public.my_team();
 if v_team is null or not (auth.uid() = p_student or (public.is_teacher() and public.shares_team(p_student))) then raise exception 'Acesso não permitido.'; end if;
 select * into v_profile from public.profiles where id = p_student;
 select * into v_member from public.team_members where user_id = p_student and team_id = v_team;
 select belt, degrees into v_belt, v_degrees from public.graduations where student_id = p_student and cancelled_at is null order by sequence desc limit 1;
 select event_date into v_cutoff from public.graduations where student_id = p_student and kind <> 'initial' and cancelled_at is null order by sequence desc limit 1;
 select count(*), count(*) filter (where v_cutoff is null or training_date > v_cutoff) into v_total, v_cycle
  from public.attendances where student_id = p_student and status = 'confirmada';
 return jsonb_build_object('id', p_student, 'name', v_profile.name, 'role', v_member.role, 'memberStatus', v_member.status,
  'revision', v_profile.revision, 'belt', coalesce(v_belt, 'branca'), 'degrees', coalesce(v_degrees, 0), 'total', v_total, 'cycle', v_cycle,
  'today', public.today_sp(), 'initialSet', exists(select 1 from public.graduations where student_id = p_student),
  'avatarPath', v_profile.avatar_path, 'contact', v_profile.contact, 'birthDate', v_profile.birth_date,
  'joinedAt', v_member.joined_at,
  -- Aulas que aconteceram (iniciadas, não canceladas) desde a entrada do aluno:
  -- denominador do percentual de frequência.
  'held', (select count(*) from public.class_sessions s2
   where s2.team_id = v_team and s2.status <> 'cancelada' and s2.starts_at <= now()
    and (s2.starts_at at time zone 'America/Sao_Paulo')::date >= (v_member.joined_at at time zone 'America/Sao_Paulo')::date),
  'attendances', coalesce((select jsonb_agg(jsonb_build_object('sessionId', a.session_id, 'date', a.training_date, 'title', s.title,
     'startsAt', s.starts_at, 'status', a.status, 'source', a.source) order by s.starts_at desc)
   from public.attendances a join public.class_sessions s on s.id = a.session_id where a.student_id = p_student), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'belt', belt, 'degrees', degrees, 'date', event_date,
     'note', note, 'cancelled', cancelled_at is not null) order by sequence desc) from public.graduations where student_id = p_student), '[]'::jsonb));
end $$;
create or replace function public.list_students() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return coalesce((select jsonb_agg(public.student_detail(p.id) order by m.status desc, p.name)
  from public.team_members m join public.profiles p on p.id = m.user_id
  where m.team_id = public.my_team() and m.role = 'aluno' and m.status in ('pendente','ativo','inativo')), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- perfil próprio
create function public.update_my_profile(p_contact text, p_birth_date date) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_member();
 if p_contact is not null and length(trim(p_contact)) > 120 then raise exception 'O contato deve ter até 120 caracteres.'; end if;
 if p_birth_date is not null and p_birth_date > public.today_sp() then raise exception 'Data de nascimento inválida.'; end if;
 update public.profiles set contact = nullif(trim(coalesce(p_contact, '')), ''), birth_date = p_birth_date where id = auth.uid();
end $$;
create function public.set_avatar(p_path text) returns text language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
 perform public.require_member();
 if p_path is null or p_path !~ ('^avatars/' || public.my_team()::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
  raise exception 'Local da foto inválido.'; end if;
 select avatar_path into v_old from public.profiles where id = auth.uid() for update;
 update public.profiles set avatar_path = p_path where id = auth.uid();
 return v_old;
end $$;

-- ---------------------------------------------------------------- status do aluno pelo professor
create function public.set_student_status(p_user uuid, p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_teacher();
 if p_status not in ('ativo','inativo') then raise exception 'Status inválido.'; end if;
 update public.team_members set status = p_status
  where team_id = public.my_team() and user_id = p_user and role = 'aluno' and status in ('ativo','inativo');
 if not found then raise exception 'Aluno não encontrado.'; end if;
end $$;

revoke all on function public.update_my_profile(text, date), public.set_avatar(text), public.set_student_status(uuid, text) from public, anon;
grant execute on function
 public.set_initial(uuid, text, integer, integer, text), public.graduate_student(uuid, text, uuid, integer, text),
 public.student_detail(uuid), public.list_students(),
 public.update_my_profile(text, date), public.set_avatar(text), public.set_student_status(uuid, text)
to authenticated;

-- ---------------------------------------------------------------- bucket de avatares (privado)
do $storage$
begin
 if to_regclass('storage.buckets') is null then return; end if;
 insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', false, 1048576, array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/png','image/jpeg','image/webp'];
 execute $p$create policy "avatar: membro envia o seu" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars'
   and (storage.foldername(name))[2] = public.my_team()::text and (storage.foldername(name))[3] = auth.uid()::text)$p$;
 execute $p$create policy "avatar: equipe lê" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars' and (storage.foldername(name))[2] = public.my_team()::text)$p$;
 execute $p$create policy "avatar: dono apaga da equipe" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars'
   and (storage.foldername(name))[2] = public.my_team()::text and public.is_owner())$p$;
end
$storage$;

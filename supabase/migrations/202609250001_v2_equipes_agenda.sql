-- Tatame v2: equipes, vários professores, aprovação de alunos, aulas padrão,
-- check-in por aula e presença confirmada pelo professor.
-- Os dados da v1 são migrados: a turma vira a primeira equipe, o professor vira dono,
-- e cada data de presença antiga vira uma aula avulsa "realizada".

-- ---------------------------------------------------------------- equipes
create table public.teams (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
 name text not null check (length(trim(name)) between 2 and 80),
 logo_path text,
 primary_color text not null default '#203c32' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
 accent_color text not null default '#c9a227' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
 goal integer check (goal > 0),
 code_salt text not null default gen_random_uuid()::text,
 code_hash text not null default '',
 photo_retention_days integer not null default 90 check (photo_retention_days between 1 and 3650),
 created_at timestamptz not null default now()
);
insert into public.teams(slug, name, goal, code_salt, code_hash)
 select 'minha-turma', 'Minha turma', goal, code_salt, code_hash from public.class_settings where id = true;

create table public.team_members (
 team_id uuid not null references public.teams(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null default 'aluno' check (role in ('aluno','professor','dono')),
 status text not null default 'pendente' check (status in ('pendente','ativo','bloqueado')),
 joined_at timestamptz not null default now(),
 primary key (team_id, user_id)
);
create index team_members_user on public.team_members(user_id);
insert into public.team_members(team_id, user_id, role, status)
 select t.id, p.id, case when p.role = 'professor' then 'dono' else 'aluno' end, 'ativo'
 from public.profiles p cross join public.teams t;
drop index public.one_teacher;
comment on column public.profiles.role is 'Obsoleto desde a v2: o papel fica em team_members.';

-- ---------------------------------------------------------------- aulas
create table public.class_schedules (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.teams(id) on delete cascade,
 title text not null check (length(trim(title)) between 2 and 80),
 weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
 start_time time not null,
 duration_min integer not null check (duration_min between 15 and 300),
 valid_from date not null,
 valid_until date check (valid_until is null or valid_until >= valid_from),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.class_sessions (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.teams(id) on delete cascade,
 schedule_id uuid references public.class_schedules(id) on delete set null,
 title text not null check (length(trim(title)) between 2 and 80),
 starts_at timestamptz not null,
 duration_min integer not null check (duration_min between 15 and 300),
 status text not null default 'prevista' check (status in ('prevista','cancelada','realizada')),
 description text check (length(description) <= 2000),
 cancel_reason text check (length(cancel_reason) <= 200),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 unique (schedule_id, starts_at)
);
create index class_sessions_team_time on public.class_sessions(team_id, starts_at);

-- ---------------------------------------------------------------- presenças por aula
insert into public.class_sessions(team_id, title, starts_at, duration_min, status)
 select t.id, 'Treino', (d.training_date + time '12:00') at time zone 'America/Sao_Paulo', 60, 'realizada'
 from (select distinct training_date from public.attendances) d cross join public.teams t;

alter table public.attendances
 add column id uuid not null default gen_random_uuid(),
 add column team_id uuid references public.teams(id) on delete cascade,
 add column session_id uuid references public.class_sessions(id) on delete cascade,
 add column status text not null default 'confirmada' check (status in ('pendente','confirmada','rejeitada')),
 add column source text not null default 'professor' check (source in ('checkin','professor')),
 add column photo_path text,
 add column reviewed_by uuid references public.profiles(id),
 add column reviewed_at timestamptz;
update public.attendances a set
 team_id = s.team_id, session_id = s.id,
 source = case when a.actor_id = a.student_id then 'checkin' else 'professor' end,
 reviewed_by = a.actor_id, reviewed_at = a.created_at
 from public.class_sessions s
 where s.schedule_id is null and (s.starts_at at time zone 'America/Sao_Paulo')::date = a.training_date;
alter table public.attendances
 alter column team_id set not null,
 alter column session_id set not null,
 drop constraint attendances_pkey,
 add primary key (id),
 add constraint attendance_once unique (session_id, student_id);
create index attendances_student on public.attendances(student_id);

alter table public.graduations add column team_id uuid references public.teams(id) on delete cascade;
update public.graduations set team_id = (select id from public.teams order by created_at limit 1);
alter table public.graduations alter column team_id set not null;

-- ---------------------------------------------------------------- remove API da v1
drop function public.mark_attendance();
drop function public.correct_attendance(uuid, date, text);
drop function public.get_settings();
drop function public.list_students();
drop function public.student_detail(uuid);
drop table public.class_settings;

-- ---------------------------------------------------------------- auxiliares
create function public.my_team() returns uuid language sql stable security definer set search_path='' as $$
 select team_id from public.team_members where user_id = auth.uid() and status = 'ativo' order by joined_at, team_id limit 1
$$;
create function public.my_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.team_members where user_id = auth.uid() and team_id = public.my_team()
$$;
create or replace function public.is_teacher() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.my_role() in ('professor','dono'), false)
$$;
create function public.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.my_role() = 'dono', false)
$$;
create function public.require_owner() returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_owner() then raise exception 'Somente o dono da equipe pode fazer isso.'; end if; end $$;
create function public.require_member() returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid := public.my_team();
begin if v is null then raise exception 'Acesso à equipe ainda não liberado.'; end if; return v; end $$;
create function public.shares_team(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_members where user_id = p_user and team_id = public.my_team())
$$;
create or replace function public.lock_student(p_student uuid, p_revision integer default null) returns void language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 perform public.require_teacher();
 select p.revision into v_revision from public.profiles p
  join public.team_members m on m.user_id = p.id and m.team_id = public.my_team() and m.role = 'aluno'
  where p.id = p_student for update of p;
 if not found then raise exception 'Aluno não encontrado.'; end if;
 if p_revision is not null and p_revision <> v_revision then raise exception 'Dados atualizados por outra operação. Atualize a tela e tente novamente.'; end if;
end $$;
create function public.session_for_staff(p_session uuid) returns public.class_sessions language plpgsql security definer set search_path='' as $$
declare v public.class_sessions;
begin
 perform public.require_teacher();
 select * into v from public.class_sessions where id = p_session and team_id = public.my_team() for update;
 if not found then raise exception 'Aula não encontrada.'; end if;
 return v;
end $$;

-- ---------------------------------------------------------------- cadastro com código da equipe
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid;
begin
 v_code := trim(coalesce(p_metadata->>'class_code', ''));
 if length(v_code) between 8 and 128 then
  select id into v_team from public.teams
   where code_hash <> '' and code_hash = encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex') limit 1;
 end if;
 if v_team is null then raise exception 'Código da turma inválido.'; end if;
 v_name := trim(coalesce(p_metadata->>'name', ''));
 if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe seu nome completo.'; end if;
 insert into public.profiles(id, name, role) values (p_id, v_name, 'aluno');
 insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'aluno', 'pendente');
end $$;

-- ---------------------------------------------------------------- graduação com equipe
create or replace function public.set_initial(p_student uuid, p_belt text, p_degrees integer, p_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_student(p_student, p_revision);
 if exists(select 1 from public.graduations where student_id = p_student) then raise exception 'A situação inicial já foi definida ou existe uma graduação.'; end if;
 insert into public.graduations(student_id, actor_id, kind, belt, degrees, team_id) values (p_student, auth.uid(), 'initial', p_belt, p_degrees, public.my_team());
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;
create or replace function public.graduate_student(p_student uuid, p_kind text, p_key uuid, p_revision integer) returns void language plpgsql security definer set search_path='' as $$
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
 insert into public.graduations(id, student_id, actor_id, kind, belt, degrees, team_id) values (p_key, p_student, auth.uid(), p_kind, v_belt, v_degrees, public.my_team());
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;

-- ---------------------------------------------------------------- equipe e configurações
create function public.get_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'goal', case when m.status = 'ativo' then t.goal end,
  'role', m.role, 'status', m.status,
  'team', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'primaryColor', t.primary_color, 'accentColor', t.accent_color, 'logoPath', t.logo_path))
 from public.team_members m join public.teams t on t.id = m.team_id
 where m.user_id = auth.uid()
 order by (m.status = 'ativo') desc, m.joined_at limit 1
$$;
create or replace function public.update_settings(p_goal integer, p_code text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text;
begin
 perform public.require_teacher();
 if p_goal is not null and p_goal <= 0 then raise exception 'Informe uma meta inteira maior que zero.'; end if;
 update public.teams set goal = p_goal where id = public.my_team();
 if p_code is not null then
  perform public.require_owner();
  if length(trim(p_code)) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
  if exists(select 1 from public.teams where id <> public.my_team() and code_hash = encode(sha256(convert_to(code_salt || trim(p_code), 'UTF8')), 'hex')) then
   raise exception 'Escolha outro código.'; end if;
  update public.teams set code_salt = v_salt, code_hash = encode(sha256(convert_to(v_salt || trim(p_code), 'UTF8')), 'hex') where id = public.my_team();
 end if;
end $$;
create function public.update_team(p_name text, p_primary text, p_accent text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_owner();
 update public.teams set name = trim(p_name), primary_color = p_primary, accent_color = p_accent where id = public.my_team();
end $$;
create function public.approve_member(p_user uuid, p_approve boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_teacher();
 update public.team_members set status = case when p_approve then 'ativo' else 'bloqueado' end
  where team_id = public.my_team() and user_id = p_user and role = 'aluno' and status <> case when p_approve then 'ativo' else 'bloqueado' end;
 if not found and not exists(select 1 from public.team_members where team_id = public.my_team() and user_id = p_user and role = 'aluno') then
  raise exception 'Aluno não encontrado.'; end if;
end $$;
create function public.set_member_role(p_user uuid, p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_owner();
 if p_role not in ('aluno','professor') then raise exception 'Papel inválido.'; end if;
 if p_user = auth.uid() then raise exception 'Você não pode alterar o próprio papel.'; end if;
 update public.team_members set role = p_role, status = 'ativo' where team_id = public.my_team() and user_id = p_user and role <> 'dono';
 if not found then raise exception 'Membro não encontrado.'; end if;
end $$;

-- ---------------------------------------------------------------- aulas padrão
create function public.generate_sessions(p_team uuid, p_until date) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.class_sessions(team_id, schedule_id, title, starts_at, duration_min, status, created_by)
 select s.team_id, s.id, s.title, (d::date + s.start_time) at time zone 'America/Sao_Paulo', s.duration_min, 'prevista', s.created_by
 from public.class_schedules s
 cross join lateral generate_series(greatest(s.valid_from, public.today_sp()), least(coalesce(s.valid_until, p_until), p_until), interval '1 day') d
 where s.team_id = p_team and extract(dow from d)::smallint = any(s.weekdays)
 on conflict (schedule_id, starts_at) do nothing;
end $$;
create function public.validate_schedule(p_title text, p_weekdays smallint[], p_duration integer) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_title is null or length(trim(p_title)) not between 2 and 80 then raise exception 'Informe o nome da aula.'; end if;
 if p_weekdays is null or cardinality(p_weekdays) = 0 or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
  or (select count(distinct x) from unnest(p_weekdays) x) <> cardinality(p_weekdays) then raise exception 'Escolha os dias da semana.'; end if;
 if p_duration is null or p_duration not between 15 and 300 then raise exception 'A duração deve ficar entre 15 e 300 minutos.'; end if;
end $$;
create function public.drop_future_sessions(p_schedule uuid, p_from date) returns void language sql security definer set search_path='' as $$
 delete from public.class_sessions s where s.schedule_id = p_schedule and s.status = 'prevista'
  and (s.starts_at at time zone 'America/Sao_Paulo')::date >= p_from
  and not exists(select 1 from public.attendances a where a.session_id = s.id)
$$;
create function public.create_schedule(p_title text, p_weekdays smallint[], p_start time, p_duration integer, p_valid_from date) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 perform public.require_teacher();
 perform public.validate_schedule(p_title, p_weekdays, p_duration);
 if p_start is null then raise exception 'Horário inválido.'; end if;
 if p_valid_from is null or p_valid_from < public.today_sp() then raise exception 'O início deve ser hoje ou depois.'; end if;
 insert into public.class_schedules(team_id, title, weekdays, start_time, duration_min, valid_from, created_by)
  values (public.my_team(), trim(p_title), p_weekdays, p_start, p_duration, p_valid_from, auth.uid()) returning id into v;
 perform public.generate_sessions(public.my_team(), public.today_sp() + 28);
 return v;
end $$;
create function public.update_schedule(p_id uuid, p_title text, p_weekdays smallint[], p_start time, p_duration integer, p_effective date) returns uuid language plpgsql security definer set search_path='' as $$
declare v_old public.class_schedules; v_new uuid;
begin
 perform public.require_teacher();
 perform public.validate_schedule(p_title, p_weekdays, p_duration);
 if p_start is null then raise exception 'Horário inválido.'; end if;
 if p_effective is null or p_effective <= public.today_sp() then raise exception 'A mudança só pode valer a partir de amanhã.'; end if;
 select * into v_old from public.class_schedules where id = p_id and team_id = public.my_team() for update;
 if not found then raise exception 'Horário não encontrado.'; end if;
 if v_old.valid_until is not null and v_old.valid_until < p_effective then raise exception 'Este horário já foi encerrado.'; end if;
 perform public.drop_future_sessions(p_id, p_effective);
 if v_old.valid_from >= p_effective then
  update public.class_schedules set title = trim(p_title), weekdays = p_weekdays, start_time = p_start, duration_min = p_duration, valid_from = p_effective where id = p_id;
  v_new := p_id;
 else
  update public.class_schedules set valid_until = p_effective - 1 where id = p_id;
  insert into public.class_schedules(team_id, title, weekdays, start_time, duration_min, valid_from, valid_until, created_by)
   values (v_old.team_id, trim(p_title), p_weekdays, p_start, p_duration, p_effective, v_old.valid_until, auth.uid()) returning id into v_new;
 end if;
 perform public.generate_sessions(public.my_team(), public.today_sp() + 28);
 return v_new;
end $$;
create function public.end_schedule(p_id uuid, p_last_day date) returns void language plpgsql security definer set search_path='' as $$
declare v_old public.class_schedules;
begin
 perform public.require_teacher();
 if p_last_day is null or p_last_day < public.today_sp() then raise exception 'Escolha hoje ou uma data futura.'; end if;
 select * into v_old from public.class_schedules where id = p_id and team_id = public.my_team() for update;
 if not found then raise exception 'Horário não encontrado.'; end if;
 perform public.drop_future_sessions(p_id, p_last_day + 1);
 if p_last_day < v_old.valid_from then delete from public.class_schedules where id = p_id; -- aulas antigas ficam com schedule_id nulo
 else update public.class_schedules set valid_until = p_last_day where id = p_id; end if;
end $$;
create function public.list_schedules() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_team uuid := public.require_member();
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'weekdays', weekdays, 'startTime', to_char(start_time, 'HH24:MI'),
  'durationMin', duration_min, 'validFrom', valid_from, 'validUntil', valid_until) order by start_time, title)
  from public.class_schedules where team_id = v_team and (valid_until is null or valid_until >= public.today_sp())), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- aulas
create function public.create_session(p_title text, p_starts_at timestamptz, p_duration integer, p_description text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 perform public.require_teacher();
 if p_title is null or length(trim(p_title)) not between 2 and 80 then raise exception 'Informe o nome da aula.'; end if;
 if p_starts_at is null then raise exception 'Informe data e horário.'; end if;
 if p_duration is null or p_duration not between 15 and 300 then raise exception 'A duração deve ficar entre 15 e 300 minutos.'; end if;
 insert into public.class_sessions(team_id, title, starts_at, duration_min, status, description, created_by)
  values (public.my_team(), trim(p_title), p_starts_at, p_duration, case when p_starts_at <= now() then 'realizada' else 'prevista' end, nullif(trim(p_description), ''), auth.uid())
  returning id into v;
 return v;
end $$;
create function public.cancel_session(p_session uuid, p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session);
begin
 if v.status <> 'prevista' then raise exception 'Esta aula não pode ser cancelada.'; end if;
 if v.starts_at <= now() then raise exception 'Não é possível cancelar uma aula que já começou.'; end if;
 update public.class_sessions set status = 'cancelada', cancel_reason = nullif(trim(p_reason), '') where id = p_session;
 delete from public.attendances where session_id = p_session and status = 'pendente';
end $$;
create function public.list_sessions(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.require_member(); v_staff boolean := public.is_teacher();
begin
 if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'Período inválido.'; end if;
 perform public.generate_sessions(v_team, least(p_to, public.today_sp() + 56));
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', s.id, 'title', s.title, 'startsAt', s.starts_at, 'durationMin', s.duration_min, 'status', s.status,
   'cancelReason', s.cancel_reason, 'description', s.description, 'scheduleId', s.schedule_id,
   'checkins', (select count(*) from public.attendances a where a.session_id = s.id and a.status <> 'rejeitada'),
   'pending', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'pendente') end,
   'confirmed', case when v_staff then (select count(*) from public.attendances a where a.session_id = s.id and a.status = 'confirmada') end,
   'mine', (select a.status from public.attendances a where a.session_id = s.id and a.student_id = auth.uid()))
   order by s.starts_at)
  from public.class_sessions s
  where s.team_id = v_team and (s.starts_at at time zone 'America/Sao_Paulo')::date between p_from and p_to), '[]'::jsonb);
end $$;
create function public.session_detail(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.class_sessions;
begin
 perform public.require_teacher();
 select * into v from public.class_sessions where id = p_session and team_id = public.my_team();
 if not found then raise exception 'Aula não encontrada.'; end if;
 return jsonb_build_object('id', v.id, 'title', v.title, 'startsAt', v.starts_at, 'durationMin', v.duration_min, 'status', v.status,
  'cancelReason', v.cancel_reason, 'description', v.description,
  'students', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', a.status, 'source', a.source, 'photoPath', a.photo_path)
    order by (a.status is null), p.name)
   from public.team_members m join public.profiles p on p.id = m.user_id
   left join public.attendances a on a.session_id = v.id and a.student_id = p.id
   where m.team_id = v.team_id and m.role = 'aluno' and (m.status = 'ativo' or a.id is not null)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- check-in e presença
create function public.checkin(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member();
begin
 if public.my_role() <> 'aluno' then raise exception 'Check-in é para alunos.'; end if;
 select * into v from public.class_sessions where id = p_session and team_id = v_team;
 if not found then raise exception 'Aula não encontrada.'; end if;
 if v.status <> 'prevista' then raise exception 'Esta aula não está aberta para check-in.'; end if;
 if now() > v.starts_at - interval '1 hour' then raise exception 'O check-in fecha 1 hora antes do treino.'; end if;
 insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source)
  values (v_team, v.id, auth.uid(), (v.starts_at at time zone 'America/Sao_Paulo')::date, auth.uid(), 'pendente', 'checkin')
  on conflict (session_id, student_id) do nothing;
end $$;
create function public.cancel_checkin(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member();
begin
 select * into v from public.class_sessions where id = p_session and team_id = v_team;
 if not found then raise exception 'Aula não encontrada.'; end if;
 if now() > v.starts_at - interval '1 hour' then raise exception 'O check-in fecha 1 hora antes do treino.'; end if;
 delete from public.attendances where session_id = p_session and student_id = auth.uid() and status = 'pendente';
end $$;
create function public.review_presence(p_session uuid, p_student uuid, p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session);
begin
 if p_decision not in ('confirmada','rejeitada') then raise exception 'Decisão inválida.'; end if;
 if v.starts_at > now() then raise exception 'A presença só pode ser revisada depois do início da aula.'; end if;
 update public.attendances set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now() where session_id = p_session and student_id = p_student;
 if not found then raise exception 'O aluno não tem check-in nesta aula.'; end if;
 if p_decision = 'confirmada' and v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
end $$;
create function public.teacher_add_presence(p_session uuid, p_student uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session);
begin
 perform public.lock_student(p_student);
 if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
 if v.starts_at > now() then raise exception 'Só é possível lançar presença depois do início da aula.'; end if;
 insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source, reviewed_by, reviewed_at)
  values (v.team_id, v.id, p_student, (v.starts_at at time zone 'America/Sao_Paulo')::date, auth.uid(), 'confirmada', 'professor', auth.uid(), now())
  on conflict (session_id, student_id) do update set status = 'confirmada', reviewed_by = auth.uid(), reviewed_at = now();
 if v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
end $$;
create function public.teacher_remove_presence(p_session uuid, p_student uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.session_for_staff(p_session);
 delete from public.attendances where session_id = p_session and student_id = p_student;
end $$;

-- ---------------------------------------------------------------- resumo do aluno
create function public.student_detail(p_student uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_profile public.profiles; v_member public.team_members; v_belt text; v_degrees integer; v_cutoff date; v_total bigint; v_cycle bigint;
begin
 if public.my_team() is null or not (auth.uid() = p_student or (public.is_teacher() and public.shares_team(p_student))) then raise exception 'Acesso não permitido.'; end if;
 select * into v_profile from public.profiles where id = p_student;
 select * into v_member from public.team_members where user_id = p_student and team_id = public.my_team();
 select belt, degrees into v_belt, v_degrees from public.graduations where student_id = p_student and cancelled_at is null order by sequence desc limit 1;
 select event_date into v_cutoff from public.graduations where student_id = p_student and kind <> 'initial' and cancelled_at is null order by sequence desc limit 1;
 select count(*), count(*) filter (where v_cutoff is null or training_date > v_cutoff) into v_total, v_cycle
  from public.attendances where student_id = p_student and status = 'confirmada';
 return jsonb_build_object('id', p_student, 'name', v_profile.name, 'role', v_member.role, 'memberStatus', v_member.status,
  'revision', v_profile.revision, 'belt', coalesce(v_belt, 'branca'), 'degrees', coalesce(v_degrees, 0), 'total', v_total, 'cycle', v_cycle,
  'today', public.today_sp(), 'initialSet', exists(select 1 from public.graduations where student_id = p_student),
  'attendances', coalesce((select jsonb_agg(jsonb_build_object('sessionId', a.session_id, 'date', a.training_date, 'title', s.title,
     'startsAt', s.starts_at, 'status', a.status, 'source', a.source) order by s.starts_at desc)
   from public.attendances a join public.class_sessions s on s.id = a.session_id where a.student_id = p_student), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'belt', belt, 'degrees', degrees, 'date', event_date,
     'cancelled', cancelled_at is not null) order by sequence desc) from public.graduations where student_id = p_student), '[]'::jsonb));
end $$;
create function public.list_students() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return coalesce((select jsonb_agg(public.student_detail(p.id) order by m.status desc, p.name)
  from public.team_members m join public.profiles p on p.id = m.user_id
  where m.team_id = public.my_team() and m.role = 'aluno' and m.status in ('pendente','ativo')), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.class_schedules enable row level security;
alter table public.class_sessions enable row level security;
drop policy read_profile on public.profiles;
drop policy read_attendance on public.attendances;
drop policy read_graduation on public.graduations;
create policy read_profile on public.profiles for select to authenticated using (id = auth.uid() or (public.is_teacher() and public.shares_team(id)));
create policy read_attendance on public.attendances for select to authenticated using (student_id = auth.uid() or (public.is_teacher() and team_id = public.my_team()));
create policy read_graduation on public.graduations for select to authenticated using (student_id = auth.uid() or (public.is_teacher() and team_id = public.my_team()));
create policy read_sessions on public.class_sessions for select to authenticated using (team_id = public.my_team());
create policy read_schedules on public.class_schedules for select to authenticated using (team_id = public.my_team());
revoke all on public.teams, public.team_members, public.class_schedules, public.class_sessions from anon, authenticated;
grant select on public.class_sessions, public.class_schedules to authenticated;

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
 public.teacher_add_presence(uuid, uuid), public.teacher_remove_presence(uuid, uuid)
to authenticated;
-- RLS usa estas auxiliares; o papel autenticado precisa executá-las.
grant execute on function public.my_team(), public.shares_team(uuid) to authenticated;

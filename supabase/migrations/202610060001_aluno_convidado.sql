-- Professor cria aluno sem conta: convite com nome e aulas anteriores.
-- O aluno depois se cadastra com o e-mail que passou ao professor + código da
-- equipe e entra direto ativo, sem aprovação.
create table public.invited_students (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  initial_total integer not null default 0 check (initial_total >= 0),
  claim_email text check (claim_email is null or claim_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
-- Um e-mail só pode estar esperando vínculo uma vez por equipe.
create unique index invited_students_email_open
  on public.invited_students(team_id, lower(claim_email))
  where claim_email is not null and claimed_at is null;
create index invited_students_team on public.invited_students(team_id);

alter table public.invited_students enable row level security;
create policy read_invited on public.invited_students for select to authenticated
  using (team_id = public.my_team());
create policy write_invited on public.invited_students for all to authenticated
  using (public.is_teacher() and team_id = public.my_team())
  with check (public.is_teacher() and team_id = public.my_team());
revoke all on public.invited_students from anon, authenticated;

-- Aulas anteriores informadas pelo professor (contam no total e na frequência).
alter table public.team_members add column initial_total integer not null default 0
  check (initial_total >= 0);

-- ---------------------------------------------------------------- RPCs
create function public.create_invited_student(p_name text, p_initial_total integer)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.my_team(); v_id uuid;
begin
 perform public.require_teacher();
 if p_name is null or length(trim(p_name)) < 2 or length(trim(p_name)) > 100 then
  raise exception 'Informe o nome completo do aluno.';
 end if;
 if p_initial_total is null or p_initial_total < 0 or p_initial_total > 10000 then
  raise exception 'Informe quantas aulas ele já fez.';
 end if;
 insert into public.invited_students(team_id, name, initial_total, created_by)
  values (v_team, trim(p_name), p_initial_total, auth.uid()) returning id into v_id;
 return jsonb_build_object('id', v_id, 'name', trim(p_name), 'initialTotal', p_initial_total,
  'claimEmail', null, 'createdAt', now());
end $$;

create function public.set_invited_email(p_invite uuid, p_email text) returns void
 language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
 perform public.require_teacher();
 if p_email is null or btrim(p_email) = '' then
  update public.invited_students set claim_email = null
   where id = p_invite and team_id = public.my_team() and claimed_at is null;
  return;
 end if;
 v_email := lower(btrim(p_email));
 if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
  raise exception 'E-mail inválido.';
 end if;
 update public.invited_students set claim_email = v_email
  where id = p_invite and team_id = public.my_team() and claimed_at is null;
 if not found then raise exception 'Convite não encontrado ou já usado.'; end if;
end $$;

create function public.delete_invited_student(p_invite uuid) returns void
 language plpgsql security definer set search_path='' as $$
begin
 perform public.require_teacher();
 delete from public.invited_students
  where id = p_invite and team_id = public.my_team() and claimed_at is null;
 if not found then raise exception 'Convite não encontrado ou já usado.'; end if;
end $$;

create function public.list_invited_students() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return coalesce((select jsonb_agg(jsonb_build_object(
   'id', i.id, 'name', i.name, 'initialTotal', i.initial_total, 'claimEmail', i.claim_email,
   'createdAt', i.created_at) order by i.created_at, i.name)
  from public.invited_students i
  where i.team_id = public.my_team() and i.claimed_at is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- signup vincula por e-mail
-- Trigger passa o e-mail do cadastro; se bate com convite aberto da equipe,
-- o aluno entra ativo com as aulas anteriores do convite.
-- Base: versão de 202610040001 (new_team + código de professor) + p_email.
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb, p_email text default null)
 returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid; v_new text; v_slug text; v_base text; v_i integer := 0; v_salt text;
 v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_join text := ''; i integer; v_prof boolean := false;
 v_invite public.invited_students;
begin
 v_name := trim(coalesce(p_metadata->>'name', ''));
 if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe seu nome completo.'; end if;
 v_new := trim(coalesce(p_metadata->>'new_team', ''));
 if v_new <> '' then
  -- cria a equipe: criador vira dono ativo e já sai com código de entrada
  if length(v_new) < 2 or length(v_new) > 80 then raise exception 'O nome da turma deve ter entre 2 e 80 caracteres.'; end if;
  v_base := lower(regexp_replace(v_new, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'turma'; end if;
  if length(v_base) > 38 then v_base := substr(v_base, 1, 38); end if;
  v_slug := v_base;
  while exists(select 1 from public.teams where slug = v_slug) loop
   v_i := v_i + 1; v_slug := v_base || '-' || v_i::text;
  end loop;
  insert into public.teams(slug, name) values (v_slug, v_new) returning id into v_team;
  loop
   v_hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
   v_join := '';
   for i in 0..7 loop
    v_join := v_join || substr(v_alphabet, 1 + (('x' || substr(v_hex, i * 2 + 1, 2))::bit(8)::int % 32), 1);
   end loop;
   v_join := substr(v_join, 1, 4) || '-' || substr(v_join, 5, 4);
   exit when not exists(select 1 from public.teams t where t.join_code = v_join or t.prof_code = v_join);
  end loop;
  v_salt := gen_random_uuid()::text;
  update public.teams set join_code = v_join, code_salt = v_salt,
   code_hash = encode(sha256(convert_to(v_salt || v_join, 'UTF8')), 'hex') where id = v_team;
  insert into public.profiles(id, name, role) values (p_id, v_name, 'aluno');
  insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'dono', 'ativo');
  return;
 end if;
 v_code := trim(coalesce(p_metadata->>'class_code', ''));
 if length(v_code) between 8 and 128 then
  select id, true into v_team, v_prof from public.teams
   where prof_code_hash <> '' and prof_code_hash in (
    encode(sha256(convert_to(prof_code_salt || v_code, 'UTF8')), 'hex'),
    encode(sha256(convert_to(prof_code_salt || upper(v_code), 'UTF8')), 'hex'))
   limit 1;
  if v_team is null then
   select id into v_team from public.teams
    where code_hash <> '' and code_hash in (
     encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex'),
     encode(sha256(convert_to(code_salt || upper(v_code), 'UTF8')), 'hex'))
    limit 1;
  end if;
 end if;
 if v_team is null then raise exception 'Código da turma inválido.'; end if;
 insert into public.profiles(id, name, role) values (p_id, v_name, 'aluno');
 if v_prof then
  -- Professor não é aluno: convite de aluno não se aplica.
  insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'professor', 'ativo');
  return;
 end if;
 select * into v_invite from public.invited_students
  where team_id = v_team and claimed_at is null
   and p_email is not null and lower(btrim(p_email)) = lower(btrim(claim_email))
  limit 1 for update;
 if found then
  insert into public.team_members(team_id, user_id, role, status, initial_total)
   values (v_team, p_id, 'aluno', 'ativo', v_invite.initial_total);
  update public.invited_students set claimed_at = now() where id = v_invite.id;
 else
  insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'aluno', 'pendente');
 end if;
end $$;

create or replace function public.signup_after() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.handle_signup_internal(new.id, new.raw_user_meta_data, new.email);
 update auth.users set raw_user_meta_data=raw_user_meta_data-'class_code'-'role' where id=new.id;
 return new;
end $$;

revoke execute on function
 public.create_invited_student(text, integer), public.set_invited_email(uuid, text),
 public.delete_invited_student(uuid), public.list_invited_students(),
 public.handle_signup_internal(uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function
 public.create_invited_student(text, integer), public.set_invited_email(uuid, text),
 public.delete_invited_student(uuid), public.list_invited_students()
to authenticated;

-- ---------------------------------------------------------------- total e frequência
-- total = presenças confirmadas + aulas anteriores informadas pelo professor.
-- held (denominador da frequência) = aulas desde a entrada + aulas anteriores.
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
 v_total := v_total + v_member.initial_total;
 return jsonb_build_object('id', p_student, 'name', v_profile.name, 'role', v_member.role, 'memberStatus', v_member.status,
  'revision', v_profile.revision, 'belt', coalesce(v_belt, 'branca'), 'degrees', coalesce(v_degrees, 0), 'total', v_total, 'cycle', v_cycle,
  'today', public.today_sp(), 'initialSet', exists(select 1 from public.graduations where student_id = p_student),
  'avatarPath', v_profile.avatar_path, 'contact', v_profile.contact, 'birthDate', v_profile.birth_date,
  'joinedAt', v_member.joined_at,
  -- Aulas que aconteceram (iniciadas, não canceladas) desde a entrada do aluno,
  -- mais as aulas anteriores que o professor informou ao criar o aluno:
  -- denominador do percentual de frequência.
  'held', v_member.initial_total + (select count(*) from public.class_sessions s2
   where s2.team_id = v_team and s2.status <> 'cancelada' and s2.starts_at <= now()
    and (s2.starts_at at time zone 'America/Sao_Paulo')::date >= (v_member.joined_at at time zone 'America/Sao_Paulo')::date),
  'attendances', coalesce((select jsonb_agg(jsonb_build_object('sessionId', a.session_id, 'date', a.training_date, 'title', s.title,
     'startsAt', s.starts_at, 'status', a.status, 'source', a.source) order by s.starts_at desc)
   from public.attendances a join public.class_sessions s on s.id = a.session_id where a.student_id = p_student), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'belt', belt, 'degrees', degrees, 'date', event_date,
     'note', note, 'cancelled', cancelled_at is not null) order by sequence desc) from public.graduations where student_id = p_student), '[]'::jsonb));
end $$;

-- Equipe técnica completa: perfil e graduação de professores, código de professor
-- (cadastro direto como professor), eleger um professor como dono e excluir a
-- própria conta com sucessor.
-- Decisões registradas:
--  - Graduar professor ou dono (faixa, grau, situação inicial, desfazer) é decisão
--    do dono; alunos continuam sendo graduados por qualquer professor.
--  - O dono edita o perfil da equipe técnica; qualquer professor edita o perfil
--    dos alunos (nome, contato, nascimento). Foto continua sendo enviada pelo
--    próprio membro (política do Storage).
--  - O dono atual, ao eleger um sucessor, volta a ser professor — a equipe nunca
--    fica sem dono nem sem professor.
--  - Excluir a conta exige que o dono escolha um professor para assumir; o que
--    ele registrou como professor (presenças, avisos, aulas) passa para o
--    sucessor; o histórico dele como aluno é apagado junto com a conta.

-- ---------------------------------------------------------------- 1. graduação da equipe técnica
-- lock_member trava qualquer membro da equipe (aluno, professor ou dono).
create or replace function public.lock_member(p_member uuid, p_revision integer default null) returns void language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 perform public.require_teacher();
 select p.revision into v_revision from public.profiles p
  join public.team_members m on m.user_id = p.id and m.team_id = public.my_team()
  where p.id = p_member for update of p;
 if not found then raise exception 'Membro não encontrado.'; end if;
 if p_revision is not null and p_revision <> v_revision then raise exception 'Dados atualizados por outra operação. Atualize a tela e tente novamente.'; end if;
end $$;

-- Graduar professor ou dono é decisão do dono; aluno continua com qualquer professor.
create or replace function public.set_initial(p_student uuid, p_belt text, p_degrees integer, p_revision integer, p_note text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_member(p_student);
 if exists(select 1 from public.team_members where user_id = p_student and team_id = public.my_team() and role <> 'aluno')
  and not public.is_owner() then raise exception 'Somente o dono define a situação inicial da equipe técnica.'; end if;
 if exists(select 1 from public.graduations where student_id = p_student) then raise exception 'A situação inicial já foi definida ou existe uma graduação.'; end if;
 perform public.lock_member(p_student, p_revision);
 insert into public.graduations(student_id, actor_id, kind, belt, degrees, team_id, note)
  values (p_student, auth.uid(), 'initial', p_belt, p_degrees, public.my_team(), nullif(trim(coalesce(p_note, '')), ''));
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;
create or replace function public.graduate_student(p_student uuid, p_kind text, p_key uuid, p_revision integer, p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_belt text := 'branca'; v_degrees integer := 0; v_belts text[] := array['branca','azul','roxa','marrom','preta']; v_existing public.graduations;
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_member(p_student);
 if exists(select 1 from public.team_members where user_id = p_student and team_id = public.my_team() and role <> 'aluno')
  and not public.is_owner() then raise exception 'Somente o dono gradua a equipe técnica.'; end if;
 if p_key is null then raise exception 'Identificador obrigatório.'; end if;
 select * into v_existing from public.graduations where id = p_key;
 if found then
  if v_existing.student_id <> p_student or v_existing.kind <> p_kind then raise exception 'Operação inválida.'; end if;
  return;
 end if;
 perform public.lock_member(p_student, p_revision);
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
create or replace function public.undo_graduation(p_student uuid, p_event uuid, p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare v_latest uuid;
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
 perform public.lock_member(p_student);
 if exists(select 1 from public.team_members where user_id = p_student and team_id = public.my_team() and role <> 'aluno')
  and not public.is_owner() then raise exception 'Somente o dono desfaz graduação da equipe técnica.'; end if;
 if exists(select 1 from public.graduations where id = p_event and student_id = p_student and cancelled_at is not null) then return; end if;
 perform public.lock_member(p_student, p_revision);
 select id into v_latest from public.graduations where student_id = p_student and kind <> 'initial' and cancelled_at is null order by sequence desc limit 1;
 if v_latest is null or v_latest <> p_event then raise exception 'Somente a última graduação pode ser desfeita. Atualize a tela.'; end if;
 update public.graduations set cancelled_at = now(), cancelled_by = auth.uid() where id = v_latest;
 update public.profiles set revision = revision + 1 where id = p_student;
end $$;

-- ---------------------------------------------------------------- 2. perfil editável pelo dono
-- O dono edita o perfil da equipe técnica; qualquer professor edita o perfil dos alunos.
create function public.update_member_profile(p_user uuid, p_name text, p_contact text, p_birth_date date) returns void language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
 perform public.require_teacher();
 select m.role into v_role from public.team_members m
  where m.user_id = p_user and m.team_id = public.my_team();
 if not found then raise exception 'Membro não encontrado.'; end if;
 if v_role <> 'aluno' and p_user <> auth.uid() and not public.is_owner() then
  raise exception 'Somente o dono edita o perfil da equipe técnica.';
 end if;
 if p_name is not null and length(trim(p_name)) not between 2 and 80 then raise exception 'O nome deve ter entre 2 e 80 caracteres.'; end if;
 if p_contact is not null and length(trim(p_contact)) > 120 then raise exception 'O contato deve ter até 120 caracteres.'; end if;
 if p_birth_date is not null and p_birth_date > public.today_sp() then raise exception 'Data de nascimento inválida.'; end if;
 update public.profiles
  set name = coalesce(nullif(trim(p_name), ''), name),
      contact = nullif(trim(coalesce(p_contact, '')), ''),
      birth_date = p_birth_date
  where id = p_user;
end $$;

-- Equipe técnica com o mesmo resumo dos alunos (faixa, graus, perfil, histórico).
drop function public.list_staff();
create function public.list_staff() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return coalesce((
  select jsonb_agg(public.student_detail(m.user_id) order by (m.role = 'dono') desc, p.name)
  from public.team_members m join public.profiles p on p.id = m.user_id
  where m.team_id = public.my_team() and m.role in ('professor','dono') and m.status = 'ativo'
 ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 3. código de professor
-- Quem se cadastra com o código de professor entra direto como professor ativo,
-- sem passar pela aprovação de aluno.
alter table public.teams
 add column prof_code text check (length(prof_code) between 8 and 128),
 add column prof_code_salt text not null default gen_random_uuid()::text,
 add column prof_code_hash text not null default '';

create function public.get_prof_code() returns text language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_owner();
 return (select prof_code from public.teams where id = public.my_team());
end $$;

create function public.generate_prof_code() returns text language plpgsql security definer set search_path='' as $$
declare v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_code text := ''; v_salt text := gen_random_uuid()::text; i integer;
begin
 perform public.require_owner();
 loop
  v_hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_code := '';
  for i in 0..7 loop
   v_code := v_code || substr(v_alphabet, 1 + (('x' || substr(v_hex, i * 2 + 1, 2))::bit(8)::int % 32), 1);
  end loop;
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
  exit when not exists(
   select 1 from public.teams t where (t.id <> public.my_team() or t.join_code = v_code)
    and (t.join_code = v_code or t.prof_code = v_code
     or t.code_hash = encode(sha256(convert_to(t.code_salt || v_code, 'UTF8')), 'hex')
     or t.prof_code_hash = encode(sha256(convert_to(t.prof_code_salt || v_code, 'UTF8')), 'hex')));
 end loop;
 update public.teams set prof_code = v_code, prof_code_salt = v_salt,
  prof_code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
 return v_code;
end $$;

create function public.set_prof_code(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text; v_code text := trim(p_code);
begin
 perform public.require_owner();
 if v_code is null or length(v_code) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
 if exists(select 1 from public.teams where id <> public.my_team() and (join_code = v_code or prof_code = v_code
   or code_hash = encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex')
   or prof_code_hash = encode(sha256(convert_to(prof_code_salt || v_code, 'UTF8')), 'hex')))
  or exists(select 1 from public.teams where id = public.my_team() and join_code = v_code) then
  raise exception 'Escolha outro código.'; end if;
 update public.teams set prof_code = v_code, prof_code_salt = v_salt,
  prof_code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
end $$;

-- O código de aluno também não pode colidir com código de professor (de nenhuma equipe).
create or replace function public.generate_join_code() returns text language plpgsql security definer set search_path='' as $$
declare v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_code text := ''; v_salt text := gen_random_uuid()::text; i integer;
begin
 perform public.require_owner();
 loop
  v_hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_code := '';
  for i in 0..7 loop
   v_code := v_code || substr(v_alphabet, 1 + (('x' || substr(v_hex, i * 2 + 1, 2))::bit(8)::int % 32), 1);
  end loop;
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);
  exit when not exists(select 1 from public.teams t where t.join_code = v_code or t.prof_code = v_code);
 end loop;
 update public.teams set join_code = v_code, code_salt = v_salt,
  code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
 return v_code;
end $$;

create or replace function public.set_join_code(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text; v_code text := trim(p_code);
begin
 perform public.require_owner();
 if v_code is null or length(v_code) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
 if exists(select 1 from public.teams where id <> public.my_team() and (join_code = v_code or prof_code = v_code
   or code_hash = encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex')
   or prof_code_hash = encode(sha256(convert_to(prof_code_salt || v_code, 'UTF8')), 'hex')))
  or exists(select 1 from public.teams where id = public.my_team() and prof_code = v_code) then
  raise exception 'Escolha outro código.'; end if;
 update public.teams set join_code = v_code, code_salt = v_salt,
  code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
end $$;

create or replace function public.update_settings(p_goal integer, p_code text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text;
begin
 perform public.require_teacher();
 if p_goal is not null and p_goal <= 0 then raise exception 'Informe uma meta inteira maior que zero.'; end if;
 update public.teams set goal = p_goal where id = public.my_team();
 if p_code is not null then
  perform public.require_owner();
  if length(trim(p_code)) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
  if exists(select 1 from public.teams where id <> public.my_team() and (join_code = trim(p_code) or prof_code = trim(p_code)
   or code_hash = encode(sha256(convert_to(code_salt || trim(p_code), 'UTF8')), 'hex')
   or prof_code_hash = encode(sha256(convert_to(prof_code_salt || trim(p_code), 'UTF8')), 'hex')))
   or exists(select 1 from public.teams where id = public.my_team() and prof_code = trim(p_code)) then
   raise exception 'Escolha outro código.'; end if;
  update public.teams set join_code = trim(p_code), code_salt = v_salt,
   code_hash = encode(sha256(convert_to(v_salt || trim(p_code), 'UTF8')), 'hex') where id = public.my_team();
 end if;
end $$;

-- Cadastro: código de professor entra como professor ativo; código de equipe,
-- como aluno pendente (comportamento de hoje).
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid; v_new text; v_slug text; v_base text; v_i integer := 0; v_salt text;
 v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_join text := ''; i integer; v_prof boolean := false;
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
 insert into public.team_members(team_id, user_id, role, status)
  values (v_team, p_id, case when v_prof then 'professor' else 'aluno' end,
   case when v_prof then 'ativo' else 'pendente' end);
end $$;

-- ---------------------------------------------------------------- 4. eleger dono e excluir conta
-- O dono elege um professor ativo como sucessor; ele mesmo volta a ser professor.
create function public.transfer_ownership(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_owner();
 if p_user = auth.uid() then raise exception 'Você já é o dono da equipe.'; end if;
 if not exists(select 1 from public.team_members
   where team_id = public.my_team() and user_id = p_user and role = 'professor' and status = 'ativo') then
  raise exception 'Escolha um professor ativo da equipe.'; end if;
 update public.team_members set role = case when user_id = p_user then 'dono' else 'professor' end
  where team_id = public.my_team() and user_id in (p_user, auth.uid());
end $$;

-- Excluir a própria conta. O dono escolhe um professor para assumir a equipe;
-- aluno ou professor comum sai sem sucessor (o dono continua responsável).
create function public.delete_my_account(p_successor uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.my_team(); v_heir uuid;
begin
 if v_team is null then raise exception 'Acesso à equipe ainda não liberado.'; end if;
 if public.my_role() = 'dono' then
  if p_successor is null then raise exception 'Escolha um professor para assumir a equipe antes de excluir sua conta.'; end if;
  perform public.transfer_ownership(p_successor);
  v_heir := p_successor;
 else
  v_heir := (select user_id from public.team_members where team_id = v_team and role = 'dono' limit 1);
 end if;
 if v_heir is null then raise exception 'Não foi possível definir quem assume seus registros.'; end if;
 -- O histórico do próprio treino some com a conta; o que registrei como
 -- professor (presenças, graduações, aulas, avisos) passa para quem fica.
 delete from public.attendances where student_id = auth.uid();
 delete from public.graduations where student_id = auth.uid();
 update public.attendances set actor_id = v_heir where actor_id = auth.uid();
 update public.attendances set reviewed_by = null where reviewed_by = auth.uid();
 update public.graduations set actor_id = v_heir where actor_id = auth.uid();
 update public.graduations set cancelled_by = null where cancelled_by = auth.uid();
 update public.class_schedules set created_by = v_heir where created_by = auth.uid();
 update public.class_sessions set created_by = v_heir where created_by = auth.uid();
 update public.session_photos set created_by = v_heir where created_by = auth.uid();
 update public.announcements set author_id = v_heir where author_id = auth.uid();
 delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- permissões
revoke execute on function public.lock_member(uuid, integer) from public, anon, authenticated;
revoke execute on function
 public.update_member_profile(uuid, text, text, date), public.list_staff(),
 public.get_prof_code(), public.generate_prof_code(), public.set_prof_code(text),
 public.transfer_ownership(uuid), public.delete_my_account(uuid)
from public, anon, authenticated;
grant execute on function
 public.update_member_profile(uuid, text, text, date), public.list_staff(),
 public.get_prof_code(), public.generate_prof_code(), public.set_prof_code(text),
 public.transfer_ownership(uuid), public.delete_my_account(uuid)
to authenticated;

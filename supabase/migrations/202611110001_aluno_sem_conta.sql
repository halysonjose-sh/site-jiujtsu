-- Aluno sem conta: o professor cadastra o aluno direto no aplicativo (nome,
-- foto, e-mail e quantas aulas ele já fez). O aluno nasce como membro normal
-- da equipe — aparece na lista, recebe presença, é graduado — mas ainda não
-- tem login. Quando ele se cadastrar com o e-mail informado, o perfil é o
-- mesmo: entra no app com todo o histórico já registrado.
--
-- Decisões registradas:
--  - A identidade do aluno (profiles.id) deixa de ser a conta de login. A conta
--    passa a morar em profiles.auth_id, que fica vazio para o aluno criado pelo
--    professor. Quem já tinha conta continua com id = auth_id: nada muda.
--  - O e-mail informado pelo professor fica em profiles.email. Quando o aluno se
--    cadastra com esse e-mail, o cadastro encontra o perfil existente e vincula
--    a conta a ele (em vez de criar outro aluno). Se ele nunca entrar, o
--    professor segue registrando tudo normalmente.
--  - O e-mail repetido na equipe é recusado: um aluno só (por e-mail) na equipe.
--  - Aluno sem conta pode ser removido pelo professor (erro de digitação, aluno
--    que desistiu). Aluno com conta fica "inativo", como antes.

-- ---------------------------------------------------------------- identidade
-- profiles.id deixa de exigir uma linha em auth.users; a conta entra em auth_id.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
 add column auth_id uuid unique references auth.users(id) on delete cascade,
 add column email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 add column created_by uuid references public.profiles(id) on delete set null;
update public.profiles set auth_id = id;

-- O perfil de quem está logado agora. Vazio para quem não tem conta.
create or replace function public.my_profile_id() returns uuid language sql stable security definer set search_path='' as $$
  select id from public.profiles where auth_id = auth.uid() limit 1
$$;

create or replace function public.my_team() returns uuid language sql stable security definer set search_path='' as $$
  select team_id from public.team_members
   where user_id = public.my_profile_id() and status = 'ativo'
   order by joined_at, team_id limit 1
$$;
create or replace function public.my_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.team_members where user_id = public.my_profile_id() and team_id = public.my_team()
$$;

-- ---------------------------------------------------------------- cadastro
-- O cadastro encontra o aluno criado pelo professor (mesmo e-mail, sem conta) e
-- vincula a conta a ele: o aluno entra ativo, com as aulas anteriores, a foto
-- e o histórico que o professor já registrou.
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb, p_email text default null)
 returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid; v_new text; v_slug text; v_base text; v_i integer := 0; v_salt text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_join text := ''; i integer; v_prof boolean := false;
  v_aluno public.profiles;
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
   insert into public.profiles(id, name, role, auth_id) values (p_id, v_name, 'aluno', p_id);
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
  if v_prof then
   -- Professor não é aluno.
   insert into public.profiles(id, name, role, auth_id) values (p_id, v_name, 'aluno', p_id);
   insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'professor', 'ativo');
   return;
  end if;
  -- Aluno já cadastrado pelo professor (sem conta) com o mesmo e-mail: a conta
  -- nova entra no perfil dele, com o histórico que o professor já registrou.
  select p.* into v_aluno from public.profiles p
   join public.team_members m on m.user_id = p.id and m.team_id = v_team
   where p.auth_id is null and m.role = 'aluno'
    and p.email is not null and lower(btrim(p.email)) = lower(btrim(coalesce(p_email, '')))
   limit 1 for update of p;
  if found then
   update public.profiles set auth_id = p_id where id = v_aluno.id;
   return;
  end if;
  insert into public.profiles(id, name, role, auth_id) values (p_id, v_name, 'aluno', p_id);
  insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'aluno', 'pendente');
end $$;

-- ---------------------------------------------------------------- criar alunos
-- O professor cadastra vários alunos de uma vez. Cada item:
--   { id, name, email, initialTotal, avatarPath }
-- Tudo ou nada: um item inválido derruba o lote inteiro.
create function public.create_students(p_students jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.my_team(); v_me uuid := public.my_profile_id();
  v_item jsonb; v_id uuid; v_nome text; v_email text; v_total integer; v_foto text; v_result jsonb := '[]'::jsonb;
begin
  perform public.require_teacher();
  if p_students is null or jsonb_typeof(p_students) <> 'array' then raise exception 'Lista de alunos inválida.'; end if;
  if jsonb_array_length(p_students) = 0 then raise exception 'Adicione ao menos um aluno.'; end if;
  if jsonb_array_length(p_students) > 100 then raise exception 'Adicione até 100 alunos por vez.'; end if;
  for v_item in select * from jsonb_array_elements(p_students) loop
   if (v_item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificador do aluno inválido.'; end if;
   v_id := (v_item->>'id')::uuid;
   if exists(select 1 from public.profiles where id = v_id) then raise exception 'Este aluno já está cadastrado.'; end if;
   v_nome := trim(coalesce(v_item->>'name', ''));
   if length(v_nome) < 2 or length(v_nome) > 100 then raise exception 'Informe o nome completo do aluno.'; end if;
   if (v_item ? 'initialTotal') and (v_item->>'initialTotal') !~ '^[0-9]{1,5}$' then
    raise exception 'Informe quantas aulas ele já fez.'; end if;
   v_total := coalesce((v_item->>'initialTotal')::integer, 0);
   if v_total > 10000 then raise exception 'Informe quantas aulas ele já fez.'; end if;
   v_email := nullif(lower(btrim(coalesce(v_item->>'email', ''))), '');
   if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido.'; end if;
   if v_email is not null and exists(
     select 1 from public.profiles p join public.team_members m on m.user_id = p.id
      where m.team_id = v_team and p.email is not null and lower(p.email) = v_email) then
    raise exception 'Este e-mail já está cadastrado na equipe.'; end if;
   if v_email is not null and exists(select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Este e-mail já tem conta no aplicativo.'; end if;
   v_foto := nullif(trim(coalesce(v_item->>'avatarPath', '')), '');
   if v_foto is not null and v_foto !~ ('^avatars/' || v_team::text || '/' || v_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Local da foto inválido.'; end if;
   insert into public.profiles(id, name, role, auth_id, email, avatar_path, created_by)
    values (v_id, v_nome, 'aluno', null, v_email, v_foto, v_me);
   insert into public.team_members(team_id, user_id, role, status, initial_total)
    values (v_team, v_id, 'aluno', 'ativo', v_total);
   v_result := v_result || jsonb_build_object('id', v_id, 'name', v_nome, 'email', v_email,
    'initialTotal', v_total, 'avatarPath', v_foto, 'hasAccount', false);
  end loop;
  return v_result;
end $$;

-- O professor informa (ou troca) o e-mail do aluno que ainda não tem conta.
create function public.set_student_email(p_user uuid, p_email text) returns void language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
  perform public.require_teacher();
  if not exists(select 1 from public.team_members
    where user_id = p_user and team_id = public.my_team() and role = 'aluno') then
   raise exception 'Aluno não encontrado.'; end if;
  if exists(select 1 from public.profiles where id = p_user and auth_id is not null) then
   raise exception 'Este aluno já tem conta no aplicativo.'; end if;
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
   raise exception 'E-mail inválido.'; end if;
  if v_email is not null and exists(
    select 1 from public.profiles p join public.team_members m on m.user_id = p.id
     where m.team_id = public.my_team() and p.id <> p_user and p.email is not null and lower(p.email) = v_email) then
   raise exception 'Este e-mail já está cadastrado na equipe.'; end if;
  if v_email is not null and exists(select 1 from auth.users where lower(email) = v_email) then
   raise exception 'Este e-mail já tem conta no aplicativo.'; end if;
  update public.profiles set email = v_email where id = p_user;
end $$;

-- Remove o aluno que o professor criou e que nunca entrou no aplicativo.
-- Aluno com conta continua no histórico: o caminho dele é ficar inativo.
create function public.remove_student(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_teacher();
  if not exists(select 1 from public.team_members
    where user_id = p_user and team_id = public.my_team() and role = 'aluno') then
   raise exception 'Aluno não encontrado.'; end if;
  if exists(select 1 from public.profiles where id = p_user and auth_id is not null) then
   raise exception 'Este aluno já tem conta no aplicativo. Marque-o como inativo.'; end if;
  delete from public.attendances where student_id = p_user;
  delete from public.graduations where student_id = p_user;
  delete from public.profiles where id = p_user;
end $$;

-- ---------------------------------------------------------------- resumo do aluno
create or replace function public.student_detail(p_student uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_profile public.profiles; v_member public.team_members; v_belt text; v_degrees integer; v_cutoff date; v_total bigint; v_cycle bigint; v_team uuid;
begin
  v_team := public.my_team();
  if v_team is null or not (public.my_profile_id() = p_student or (public.is_teacher() and public.shares_team(p_student))) then raise exception 'Acesso não permitido.'; end if;
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
   -- E-mail informado pelo professor e se o aluno já tem conta no aplicativo.
   'email', v_profile.email, 'hasAccount', v_profile.auth_id is not null,
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

-- ---------------------------------------------------------------- "quem sou eu"
-- As funções que escrevem em nome de quem está logado passam a usar o perfil
-- (o id do perfil pode ser diferente do id da conta: aluno sem conta).
create or replace function public.get_settings() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
   'goal', case when m.status = 'ativo' then t.goal end,
   'role', m.role, 'status', m.status,
   'team', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'primaryColor', t.primary_color, 'accentColor', t.accent_color, 'logoPath', t.logo_path))
  from public.team_members m join public.teams t on t.id = m.team_id
  where m.user_id = public.my_profile_id()
  order by (m.status = 'ativo') desc, m.joined_at limit 1
$$;
create or replace function public.checkin(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member(); v_me uuid := public.my_profile_id();
begin
  if public.my_role() <> 'aluno' then raise exception 'Check-in é para alunos.'; end if;
  select * into v from public.class_sessions where id = p_session and team_id = v_team;
  if not found then raise exception 'Aula não encontrada.'; end if;
  if v.status <> 'prevista' then raise exception 'Esta aula não está aberta para check-in.'; end if;
  if now() > v.starts_at - interval '1 hour' then raise exception 'O check-in fecha 1 hora antes do treino.'; end if;
  insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source)
   values (v_team, v.id, v_me, (v.starts_at at time zone 'America/Sao_Paulo')::date, v_me, 'pendente', 'checkin')
   on conflict (session_id, student_id) do nothing;
end $$;
create or replace function public.cancel_checkin(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member();
begin
  select * into v from public.class_sessions where id = p_session and team_id = v_team;
  if not found then raise exception 'Aula não encontrada.'; end if;
  if now() > v.starts_at - interval '1 hour' then raise exception 'O check-in fecha 1 hora antes do treino.'; end if;
  delete from public.attendances where session_id = p_session and student_id = public.my_profile_id() and status = 'pendente';
end $$;
create or replace function public.set_avatar(p_path text) returns text language plpgsql security definer set search_path='' as $$
declare v_old text; v_me uuid := public.my_profile_id();
begin
  perform public.require_member();
  if p_path is null or p_path !~ ('^avatars/' || public.my_team()::text || '/(' || v_me::text || '/)?[0-9a-f-]{36}\.(jpg|png|webp)$') then
   raise exception 'Local da foto inválido.'; end if;
  select avatar_path into v_old from public.profiles where id = v_me for update;
  update public.profiles set avatar_path = p_path where id = v_me;
  return v_old;
end $$;
create or replace function public.update_my_profile(p_name text, p_contact text, p_birth_date date)
 returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_member();
  if p_name is not null and length(trim(p_name)) not between 2 and 80 then
   raise exception 'O nome deve ter entre 2 e 80 caracteres.';
  end if;
  if p_contact is not null and length(trim(p_contact)) > 120 then raise exception 'O contato deve ter até 120 caracteres.'; end if;
  if p_birth_date is not null and p_birth_date > public.today_sp() then raise exception 'Data de nascimento inválida.'; end if;
  update public.profiles
   set name = coalesce(trim(p_name), name),
       contact = nullif(trim(coalesce(p_contact, '')), ''),
       birth_date = p_birth_date
   where id = public.my_profile_id();
end $$;
create or replace function public.create_announcement(p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_team uuid; v_id uuid;
begin
  perform public.require_teacher();
  v_team := public.my_team();
  if p_body is null or length(trim(p_body)) not between 2 and 500 then raise exception 'O aviso deve ter entre 2 e 500 caracteres.'; end if;
  insert into public.announcements(team_id, author_id, body) values (v_team, public.my_profile_id(), trim(p_body)) returning id into v_id;
  return v_id;
end $$;
create or replace function public.delete_announcement(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  -- security definer bypassa a RLS: a guarda de autor ou staff precisa estar aqui.
  delete from public.announcements
   where id = p_id and team_id = public.my_team()
     and (author_id = public.my_profile_id() or public.is_teacher());
  if not found then raise exception 'Aviso não encontrado.'; end if;
end $$;
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_teacher();
  insert into public.push_subscriptions(endpoint, user_id, team_id, p256dh, auth)
   values (p_endpoint, public.my_profile_id(), public.my_team(), p_p256dh, p_auth)
   on conflict (endpoint) do update set user_id = excluded.user_id, team_id = excluded.team_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.delete_push_subscription(p_endpoint text) returns void language sql security definer set search_path='' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = public.my_profile_id()
$$;
create or replace function public.review_presence(p_session uuid, p_student uuid, p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_me uuid := public.my_profile_id();
begin
  if p_decision not in ('confirmada','rejeitada') then raise exception 'Decisão inválida.'; end if;
  if v.starts_at > now() then raise exception 'A presença só pode ser revisada depois do início da aula.'; end if;
  update public.attendances set status = p_decision, reviewed_by = v_me, reviewed_at = now(),
   training_date = case when p_decision = 'confirmada' then (v.starts_at at time zone 'America/Sao_Paulo')::date else training_date end
   where session_id = p_session and student_id = p_student;
  if not found then raise exception 'O aluno não tem check-in nesta aula.'; end if;
  if p_decision = 'confirmada' and v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
end $$;
create or replace function public.teacher_add_presence(p_session uuid, p_student uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_me uuid := public.my_profile_id();
begin
  perform public.lock_student(p_student);
  if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
  if v.starts_at > now() then raise exception 'Só é possível lançar presença depois do início da aula.'; end if;
  insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source, reviewed_by, reviewed_at)
   values (v.team_id, v.id, p_student, (v.starts_at at time zone 'America/Sao_Paulo')::date, v_me, 'confirmada', 'professor', v_me, now())
   on conflict (session_id, student_id) do update set status = 'confirmada', reviewed_by = v_me, reviewed_at = now();
  if v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = v_session; end if;
end $$;
create or replace function public.confirm_presences(p_session uuid, p_students uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_student uuid; v_count integer := 0; v_me uuid := public.my_profile_id();
begin
  if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
  if v.starts_at > now() then raise exception 'Só é possível lançar presença depois do início da aula.'; end if;
  if p_students is null or cardinality(p_students) = 0 then raise exception 'Selecione ao menos um aluno.'; end if;
  if cardinality(p_students) > 200 then raise exception 'Seleção grande demais.'; end if;
  foreach v_student in array (select array_agg(distinct x) from unnest(p_students) x) loop
   perform public.lock_student(v_student);
   insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source, reviewed_by, reviewed_at)
    values (v.team_id, v.id, v_student, (v.starts_at at time zone 'America/Sao_Paulo')::date, v_me, 'confirmada', 'professor', v_me, now())
    on conflict (session_id, student_id) do update set status = 'confirmada', reviewed_by = v_me, reviewed_at = now();
   v_count := v_count + 1;
  end loop;
  if v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
  return v_count;
end $$;
create or replace function public.set_initial(p_student uuid, p_belt text, p_degrees integer, p_revision integer, p_note text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_revision is null then raise exception 'Atualize a tela antes de continuar.'; end if;
  perform public.lock_member(p_student);
  if exists(select 1 from public.team_members where user_id = p_student and team_id = public.my_team() and role <> 'aluno')
   and not public.is_owner() then raise exception 'Somente o dono define a situação inicial da equipe técnica.'; end if;
  if exists(select 1 from public.graduations where student_id = p_student) then raise exception 'A situação inicial já foi definida ou existe uma graduação.'; end if;
  perform public.lock_member(p_student, p_revision);
  insert into public.graduations(student_id, actor_id, kind, belt, degrees, team_id, note)
   values (p_student, public.my_profile_id(), 'initial', p_belt, p_degrees, public.my_team(), nullif(trim(coalesce(p_note, '')), ''));
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
   values (p_key, p_student, public.my_profile_id(), p_kind, v_belt, v_degrees, public.my_team(), nullif(trim(coalesce(p_note, '')), ''));
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
  update public.graduations set cancelled_at = now(), cancelled_by = public.my_profile_id() where id = v_latest;
  update public.profiles set revision = revision + 1 where id = p_student;
end $$;
create or replace function public.update_member_profile(p_user uuid, p_name text, p_contact text, p_birth_date date) returns void language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  perform public.require_teacher();
  select m.role into v_role from public.team_members m
   where m.user_id = p_user and m.team_id = public.my_team();
  if not found then raise exception 'Membro não encontrado.'; end if;
  if v_role <> 'aluno' and p_user <> public.my_profile_id() and not public.is_owner() then
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
create or replace function public.set_member_role(p_user uuid, p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_owner();
  if p_role not in ('aluno','professor') then raise exception 'Papel inválido.'; end if;
  if p_user = public.my_profile_id() then raise exception 'Você não pode alterar o próprio papel.'; end if;
  update public.team_members set role = p_role, status = 'ativo'
   where team_id = public.my_team() and user_id = p_user and role <> 'dono';
  if not found then raise exception 'Membro não encontrado.'; end if;
end $$;
create or replace function public.transfer_ownership(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_owner();
  if p_user = public.my_profile_id() then raise exception 'Você já é o dono da equipe.'; end if;
  if not exists(select 1 from public.team_members
    where team_id = public.my_team() and user_id = p_user and role = 'professor' and status = 'ativo') then
   raise exception 'Escolha um professor ativo da equipe.'; end if;
  update public.team_members set role = case when user_id = p_user then 'dono' else 'professor' end
   where team_id = public.my_team() and user_id in (p_user, public.my_profile_id());
end $$;
create or replace function public.delete_my_account(p_successor uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.my_team(); v_heir uuid; v_me uuid := public.my_profile_id();
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
  delete from public.attendances where student_id = v_me;
  delete from public.graduations where student_id = v_me;
  update public.attendances set actor_id = v_heir where actor_id = v_me;
  update public.attendances set reviewed_by = null where reviewed_by = v_me;
  update public.graduations set actor_id = v_heir where actor_id = v_me;
  update public.graduations set cancelled_by = null where cancelled_by = v_me;
  update public.class_schedules set created_by = v_heir where created_by = v_me;
  update public.class_sessions set created_by = v_heir where created_by = v_me;
  update public.session_photos set created_by = v_heir where created_by = v_me;
  update public.announcements set author_id = v_heir where author_id = v_me;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- listagens e "minha" presença
create or replace function public.list_sessions(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.require_member(); v_staff boolean := public.is_teacher(); v_me uuid := public.my_profile_id();
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
   'mine', (select a.status from public.attendances a where a.session_id = s.id and a.student_id = v_me))
   order by s.starts_at)
  from public.class_sessions s
  where s.team_id = v_team and (s.starts_at at time zone 'America/Sao_Paulo')::date between p_from and p_to), '[]'::jsonb);
end $$;
create or replace function public.session_journal(p_session uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.class_sessions; v_team uuid := public.require_member();
begin
  select * into v from public.class_sessions where id = p_session and team_id = v_team;
  if not found then raise exception 'Aula não encontrada.'; end if;
  return jsonb_build_object('id', v.id, 'teamId', v.team_id, 'title', v.title, 'startsAt', v.starts_at, 'durationMin', v.duration_min,
   'status', v.status, 'cancelReason', v.cancel_reason, 'description', v.description,
   'mine', (select a.status from public.attendances a where a.session_id = v.id and a.student_id = public.my_profile_id()),
   'present', (select count(*) from public.attendances a where a.session_id = v.id and a.status = 'confirmada'),
   'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'path', p.path, 'caption', p.caption) order by p.created_at)
    from public.session_photos p where p.session_id = v.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- RLS
-- "Eu" agora é o perfil: o id do perfil pode não ser o id da conta de login.
drop policy read_profile on public.profiles;
drop policy read_attendance on public.attendances;
drop policy read_graduation on public.graduations;
drop policy "avisos: staff publica" on public.announcements;
drop policy "avisos: autor apaga" on public.announcements;
create policy read_profile on public.profiles for select to authenticated using (id = public.my_profile_id() or (public.is_teacher() and public.shares_team(id)));
create policy read_attendance on public.attendances for select to authenticated using (student_id = public.my_profile_id() or (public.is_teacher() and team_id = public.my_team()));
create policy read_graduation on public.graduations for select to authenticated using (student_id = public.my_profile_id() or (public.is_teacher() and team_id = public.my_team()));
create policy "avisos: staff publica" on public.announcements for insert to authenticated
 with check (team_id = public.my_team() and author_id = public.my_profile_id() and public.is_teacher());
create policy "avisos: autor apaga" on public.announcements for delete to authenticated
 using (team_id = public.my_team() and (author_id = public.my_profile_id() or public.is_owner()));

-- ---------------------------------------------------------------- permissões
revoke execute on function
  public.my_profile_id(), public.create_students(jsonb), public.set_student_email(uuid, text),
  public.remove_student(uuid), public.handle_signup_internal(uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.my_profile_id(), public.create_students(jsonb), public.set_student_email(uuid, text),
  public.remove_student(uuid)
to authenticated;

-- ---------------------------------------------------------------- aposenta o convite antigo
-- O aluno criado pelo professor é um aluno da equipe: a tabela de convites e
-- suas funções saem de cena (o e-mail passou a morar no perfil).
drop function if exists public.create_invited_student(text, integer);
drop function if exists public.set_invited_email(uuid, text);
drop function if exists public.delete_invited_student(uuid);
drop function if exists public.list_invited_students();
drop table if exists public.invited_students;

-- ---------------------------------------------------------------- Storage dos avatares
-- O professor envia a foto do aluno que cadastrou; o aluno apaga a própria.
do $storage$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  execute $p$drop policy if exists "avatar: membro envia o seu" on storage.objects$p$;
  execute $p$drop policy if exists "avatar: dono apaga da equipe" on storage.objects$p$;
  execute $p$create policy "avatar: membro envia o seu" on storage.objects for insert to authenticated
   with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = public.my_team()::text and (storage.foldername(name))[3] = public.my_profile_id()::text)$p$;
  execute $p$create policy "avatar: professor envia a foto do aluno" on storage.objects for insert to authenticated
   with check (bucket_id = 'avatars' and public.is_teacher() and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = public.my_team()::text)$p$;
  execute $p$create policy "avatar: membro apaga a sua foto" on storage.objects for delete to authenticated
   using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = public.my_team()::text and (storage.foldername(name))[3] = public.my_profile_id()::text)$p$;
  execute $p$create policy "avatar: professor apaga a foto do aluno" on storage.objects for delete to authenticated
   using (bucket_id = 'avatars' and public.is_teacher() and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = public.my_team()::text)$p$;
end
$storage$;

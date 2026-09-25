-- O código de entrada passa a ser visível (e compartilhável) para os professores da equipe.
-- Continua valendo a verificação por hash no cadastro; o texto só é lido por RPC de professor.
-- Equipes antigas não têm o texto (só o hash): o dono gera um novo código na tela de Configurações.
alter table public.teams add column join_code text check (length(join_code) between 8 and 128);

create function public.get_join_code() returns text language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return (select join_code from public.teams where id = public.my_team());
end $$;

-- Código de 8 caracteres sem letras/números ambíguos (0, O, 1, I), no formato ABCD-EFGH.
create function public.generate_join_code() returns text language plpgsql security definer set search_path='' as $$
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
  exit when not exists(select 1 from public.teams where join_code = v_code);
 end loop;
 update public.teams set join_code = v_code, code_salt = v_salt,
  code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
 return v_code;
end $$;

-- Código definido manualmente também passa a ser guardado para exibição.
create or replace function public.update_settings(p_goal integer, p_code text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text;
begin
 perform public.require_teacher();
 if p_goal is not null and p_goal <= 0 then raise exception 'Informe uma meta inteira maior que zero.'; end if;
 update public.teams set goal = p_goal where id = public.my_team();
 if p_code is not null then
  perform public.require_owner();
  if length(trim(p_code)) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
  if exists(select 1 from public.teams where id <> public.my_team() and (join_code = trim(p_code)
   or code_hash = encode(sha256(convert_to(code_salt || trim(p_code), 'UTF8')), 'hex'))) then
   raise exception 'Escolha outro código.'; end if;
  update public.teams set join_code = trim(p_code), code_salt = v_salt,
   code_hash = encode(sha256(convert_to(v_salt || trim(p_code), 'UTF8')), 'hex') where id = public.my_team();
 end if;
end $$;

-- Dono define um código próprio sem mexer na meta.
create function public.set_join_code(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text := gen_random_uuid()::text; v_code text := trim(p_code);
begin
 perform public.require_owner();
 if v_code is null or length(v_code) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.'; end if;
 if exists(select 1 from public.teams where id <> public.my_team() and (join_code = v_code
  or code_hash = encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex'))) then
  raise exception 'Escolha outro código.'; end if;
 update public.teams set join_code = v_code, code_salt = v_salt,
  code_hash = encode(sha256(convert_to(v_salt || v_code, 'UTF8')), 'hex') where id = public.my_team();
end $$;

-- Cadastro aceita o código com espaços extras e em minúsculas.
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid;
begin
 v_code := trim(coalesce(p_metadata->>'class_code', ''));
 if length(v_code) between 8 and 128 then
  select id into v_team from public.teams
   where code_hash <> '' and code_hash in (
    encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex'),
    encode(sha256(convert_to(code_salt || upper(v_code), 'UTF8')), 'hex'))
   limit 1;
 end if;
 if v_team is null then raise exception 'Código da turma inválido.'; end if;
 v_name := trim(coalesce(p_metadata->>'name', ''));
 if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Informe seu nome completo.'; end if;
 insert into public.profiles(id, name, role) values (p_id, v_name, 'aluno');
 insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'aluno', 'pendente');
end $$;

revoke execute on function public.get_join_code(), public.generate_join_code(), public.set_join_code(text), public.handle_signup_internal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_join_code(), public.generate_join_code(), public.set_join_code(text) to authenticated;

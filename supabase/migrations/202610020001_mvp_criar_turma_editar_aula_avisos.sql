-- MVP redondo: criar turma no cadastro, edição de aula criada e avisos da equipe.

-- ---------------------------------------------------------------- criar turma no cadastro
-- O cadastro passa a aceitar metadata new_team (nome da turma): quem cria vira dono
-- e recebe um código de entrada gerado na hora. Sem new_team, vale o código existente.
create or replace function public.handle_signup_internal(p_id uuid, p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_code text; v_name text; v_team uuid; v_new text; v_slug text; v_base text; v_i integer := 0; v_salt text;
 v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_hex text; v_join text := ''; i integer;
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
   exit when not exists(select 1 from public.teams where join_code = v_join);
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
  select id into v_team from public.teams
   where code_hash <> '' and code_hash in (
    encode(sha256(convert_to(code_salt || v_code, 'UTF8')), 'hex'),
    encode(sha256(convert_to(code_salt || upper(v_code), 'UTF8')), 'hex'))
   limit 1;
 end if;
 if v_team is null then raise exception 'Código da turma inválido.'; end if;
 insert into public.profiles(id, name, role) values (p_id, v_name, 'aluno');
 insert into public.team_members(team_id, user_id, role, status) values (v_team, p_id, 'aluno', 'pendente');
end $$;

-- ---------------------------------------------------------------- editar aula criada
-- Professor ajusta título, início e duração de aula ainda prevista.
create function public.update_session(p_id uuid, p_title text, p_starts_at timestamptz, p_duration_min integer) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_id);
begin
 if v.status <> 'prevista' then raise exception 'Só é possível editar aula prevista.'; end if;
 if p_title is null or length(trim(p_title)) not between 2 and 80 then raise exception 'O título deve ter entre 2 e 80 caracteres.'; end if;
 if p_duration_min is null or p_duration_min not between 15 and 300 then raise exception 'A duração deve ficar entre 15 e 300 minutos.'; end if;
 if p_starts_at is null then raise exception 'Informe a data e o horário da aula.'; end if;
 update public.class_sessions set title = trim(p_title), starts_at = p_starts_at, duration_min = p_duration_min
  where id = p_id;
end $$;

-- ---------------------------------------------------------------- avisos da equipe
create table public.announcements (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.teams(id) on delete cascade,
 author_id uuid not null references public.profiles(id),
 body text not null check (length(trim(body)) between 2 and 500),
 created_at timestamptz not null default now()
);
create index announcements_team_time on public.announcements(team_id, created_at desc);
alter table public.announcements enable row level security;
create policy "avisos: equipe lê" on public.announcements for select to authenticated
 using (team_id = public.my_team());
create policy "avisos: staff publica" on public.announcements for insert to authenticated
 with check (team_id = public.my_team() and author_id = auth.uid() and public.is_teacher());
create policy "avisos: autor apaga" on public.announcements for delete to authenticated
 using (team_id = public.my_team() and (author_id = auth.uid() or public.is_owner()));

create function public.create_announcement(p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_team uuid; v_id uuid;
begin
 perform public.require_teacher();
 v_team := public.my_team();
 if p_body is null or length(trim(p_body)) not between 2 and 500 then raise exception 'O aviso deve ter entre 2 e 500 caracteres.'; end if;
 insert into public.announcements(team_id, author_id, body) values (v_team, auth.uid(), trim(p_body)) returning id into v_id;
 return v_id;
end $$;

create function public.delete_announcement(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- security definer bypassa a RLS: a guarda de autor ou staff precisa estar aqui.
 delete from public.announcements
  where id = p_id and team_id = public.my_team()
    and (author_id = auth.uid() or public.is_teacher());
 if not found then raise exception 'Aviso não encontrado.'; end if;
end $$;

create function public.list_announcements() returns table (
 id uuid, author_id uuid, author_name text, body text, created_at timestamptz
) language sql stable security definer set search_path='' as $$
 select n.id, n.author_id, p.name, n.body, n.created_at
 from public.announcements n join public.profiles p on p.id = n.author_id
 where n.team_id = public.my_team()
 order by n.created_at desc limit 30
$$;

grant select on public.announcements to authenticated;
revoke execute on function public.handle_signup_internal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_session(uuid, text, timestamptz, integer),
 public.create_announcement(text), public.delete_announcement(uuid), public.list_announcements() to authenticated;

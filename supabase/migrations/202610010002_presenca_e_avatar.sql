-- Presença revisada e local do avatar: ajustes finos do perfil do aluno.

-- ---------------------------------------------------------------- presença revisada acompanha o dia da aula
-- Se a aula mudar de dia depois do check-in (hoje só por ajuste manual no banco),
-- a presença CONFIRMADA conta no dia em que a aula aconteceu, não no dia do check-in.
-- Presença rejeitada mantém a data original: ela não entra em nenhuma contagem.
create or replace function public.review_presence(p_session uuid, p_student uuid, p_decision text) returns void language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session);
begin
 if p_decision not in ('confirmada','rejeitada') then raise exception 'Decisão inválida.'; end if;
 if v.starts_at > now() then raise exception 'A presença só pode ser revisada depois do início da aula.'; end if;
 update public.attendances set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
  training_date = case when p_decision = 'confirmada' then (v.starts_at at time zone 'America/Sao_Paulo')::date else training_date end
  where session_id = p_session and student_id = p_student;
 if not found then raise exception 'O aluno não tem check-in nesta aula.'; end if;
 if p_decision = 'confirmada' and v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
end $$;

-- ---------------------------------------------------------------- avatar: subpasta só do próprio aluno
-- O caminho pode ter a subpasta do usuário, mas ela precisa ser a do próprio auth.uid().
create or replace function public.set_avatar(p_path text) returns text language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
 perform public.require_member();
 if p_path is null or p_path !~ ('^avatars/' || public.my_team()::text || '/(' || auth.uid()::text || '/)?[0-9a-f-]{36}\.(jpg|png|webp)$') then
  raise exception 'Local da foto inválido.'; end if;
 select avatar_path into v_old from public.profiles where id = auth.uid() for update;
 update public.profiles set avatar_path = p_path where id = auth.uid();
 return v_old;
end $$;

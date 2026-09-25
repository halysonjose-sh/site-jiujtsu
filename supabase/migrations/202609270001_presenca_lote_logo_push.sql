-- 1) Professor marca vários alunos presentes de uma vez (ao registrar o treino).
-- 2) Logo da equipe (bucket público team-branding).
-- 3) Inscrições de notificação (web push) dos professores.

create function public.confirm_presences(p_session uuid, p_students uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare v public.class_sessions := public.session_for_staff(p_session); v_student uuid; v_count integer := 0;
begin
 if v.status = 'cancelada' then raise exception 'Aula cancelada.'; end if;
 if v.starts_at > now() then raise exception 'Só é possível lançar presença depois do início da aula.'; end if;
 if p_students is null or cardinality(p_students) = 0 then raise exception 'Selecione ao menos um aluno.'; end if;
 if cardinality(p_students) > 200 then raise exception 'Seleção grande demais.'; end if;
 foreach v_student in array (select array_agg(distinct x) from unnest(p_students) x) loop
  perform public.lock_student(v_student);
  insert into public.attendances(team_id, session_id, student_id, training_date, actor_id, status, source, reviewed_by, reviewed_at)
   values (v.team_id, v.id, v_student, (v.starts_at at time zone 'America/Sao_Paulo')::date, auth.uid(), 'confirmada', 'professor', auth.uid(), now())
   on conflict (session_id, student_id) do update set status = 'confirmada', reviewed_by = auth.uid(), reviewed_at = now();
  v_count := v_count + 1;
 end loop;
 if v.status = 'prevista' then update public.class_sessions set status = 'realizada' where id = p_session; end if;
 return v_count;
end $$;

create function public.set_team_logo(p_path text) returns text language plpgsql security definer set search_path='' as $$
declare v_team uuid := public.my_team(); v_old text;
begin
 perform public.require_owner();
 if p_path is not null and p_path !~ ('^' || v_team::text || '/logo-[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp)$') then
  raise exception 'Local da logo inválido.'; end if;
 select logo_path into v_old from public.teams where id = v_team for update;
 update public.teams set logo_path = p_path where id = v_team;
 return v_old;
end $$;

create table public.push_subscriptions (
 endpoint text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
 user_id uuid not null references public.profiles(id) on delete cascade,
 team_id uuid not null references public.teams(id) on delete cascade,
 p256dh text not null check (length(p256dh) <= 200),
 auth text not null check (length(auth) <= 100),
 created_at timestamptz not null default now()
);
create index push_subscriptions_team on public.push_subscriptions(team_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_teacher();
 insert into public.push_subscriptions(endpoint, user_id, team_id, p256dh, auth)
  values (p_endpoint, auth.uid(), public.my_team(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, team_id = excluded.team_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create function public.delete_push_subscription(p_endpoint text) returns void language sql security definer set search_path='' as $$
 delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

grant execute on function public.confirm_presences(uuid, uuid[]), public.set_team_logo(text),
 public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

do $storage$
begin
 if to_regclass('storage.buckets') is null then return; end if;
 insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('team-branding', 'team-branding', true, 1048576, array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/png','image/jpeg','image/webp'];
 execute $p$create policy "logo: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-branding' and public.is_owner() and (storage.foldername(name))[1] = public.my_team()::text)$p$;
 execute $p$create policy "logo: equipe lê" on storage.objects for select to authenticated
  using (bucket_id = 'team-branding' and (storage.foldername(name))[1] = public.my_team()::text)$p$;
 execute $p$create policy "logo: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'team-branding' and public.is_owner() and (storage.foldername(name))[1] = public.my_team()::text)$p$;
end
$storage$;
-- is_owner é usado pela política acima com o papel autenticado.
grant execute on function public.is_owner() to authenticated;

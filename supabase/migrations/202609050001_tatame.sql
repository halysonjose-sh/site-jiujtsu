-- One classroom. All business mutations go through SECURITY DEFINER functions.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 2 and 100),
 role text not null default 'aluno' check(role in ('aluno','professor')),
 revision integer not null default 0,
 created_at timestamptz not null default now()
);
create unique index one_teacher on public.profiles(role) where role='professor';
create table public.attendances (
 student_id uuid not null references public.profiles(id),
 training_date date not null,
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 primary key(student_id,training_date)
);
create table public.graduations (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 student_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('initial','grau','faixa')),
 belt text not null check(belt in ('branca','azul','roxa','marrom','preta')),
 degrees integer not null check(degrees between 0 and 4 and (belt <> 'preta' or degrees=0)),
 event_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 cancelled_by uuid references public.profiles(id)
);
create unique index one_initial on public.graduations(student_id) where kind='initial';
create index graduation_history on public.graduations(student_id,sequence desc);
create table public.class_settings (
 id boolean primary key default true check(id),
 goal integer check(goal>0),
 code_salt text not null default gen_random_uuid()::text,
 code_hash text not null default ''
);
insert into public.class_settings(id) values(true);

create function public.today_sp() returns date language sql stable set search_path='' as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create function public.is_teacher() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='professor') $$;
create function public.require_teacher() returns void language plpgsql security definer set search_path='' as $$ begin if not public.is_teacher() then raise exception 'Somente o professor pode fazer isso.';end if;end $$;
create function public.lock_student(p_student uuid,p_revision integer default null) returns void language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 perform public.require_teacher();
 select revision into v_revision from public.profiles where id=p_student and role='aluno' for update;
 if not found then raise exception 'Aluno não encontrado.';end if;
 if p_revision is not null and p_revision<>v_revision then raise exception 'Dados atualizados por outra operação. Atualize a tela e tente novamente.';end if;
end $$;

-- AFTER is required because profiles references the new auth.users row.
create function public.signup_after() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.handle_signup_internal(new.id,new.raw_user_meta_data);
 update auth.users set raw_user_meta_data=raw_user_meta_data-'class_code'-'role' where id=new.id;
 return new;
end $$;
create function public.handle_signup_internal(p_id uuid,p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_hash text;v_salt text;v_code text;v_name text;
begin
 select code_hash,code_salt into v_hash,v_salt from public.class_settings where id=true;
 v_code:=trim(coalesce(p_metadata->>'class_code',''));
 if length(v_code)<8 or length(v_code)>128 or v_hash<>encode(sha256(convert_to(v_salt||v_code,'UTF8')),'hex') then raise exception 'Código da turma inválido.';end if;
 v_name:=trim(coalesce(p_metadata->>'name',''));
 if length(v_name)<2 or length(v_name)>100 then raise exception 'Informe seu nome completo.';end if;
 insert into public.profiles(id,name,role) values(p_id,v_name,'aluno');
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.signup_after();

alter table public.profiles enable row level security;
alter table public.attendances enable row level security;
alter table public.graduations enable row level security;
alter table public.class_settings enable row level security;
create policy read_profile on public.profiles for select to authenticated using(id=auth.uid() or public.is_teacher());
create policy read_attendance on public.attendances for select to authenticated using(student_id=auth.uid() or public.is_teacher());
create policy read_graduation on public.graduations for select to authenticated using(student_id=auth.uid() or public.is_teacher());
revoke all on public.profiles,public.attendances,public.graduations,public.class_settings from anon,authenticated;
grant select on public.profiles,public.attendances,public.graduations to authenticated;

create function public.get_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('goal',goal) from public.class_settings where id=true and exists(select 1 from public.profiles where id=auth.uid())
$$;
create function public.update_settings(p_goal integer,p_code text default null) returns void language plpgsql security definer set search_path='' as $$
declare v_salt text:=gen_random_uuid()::text;
begin
 perform public.require_teacher();
 if p_goal is not null and p_goal<=0 then raise exception 'Informe uma meta inteira maior que zero.';end if;
 if p_code is not null and length(trim(p_code)) not between 8 and 128 then raise exception 'O código deve ter entre 8 e 128 caracteres.';end if;
 update public.class_settings set goal=p_goal where id=true;
 if p_code is not null then update public.class_settings set code_salt=v_salt,code_hash=encode(sha256(convert_to(v_salt||trim(p_code),'UTF8')),'hex') where id=true;end if;
end $$;
create function public.mark_attendance() returns date language plpgsql security definer set search_path='' as $$
declare v_today date:=public.today_sp();
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='aluno') then raise exception 'Acesso de aluno necessário.';end if;
 insert into public.attendances(student_id,training_date,actor_id) values(auth.uid(),v_today,auth.uid()) on conflict do nothing;
 return v_today;
end $$;
create function public.correct_attendance(p_student uuid,p_date date,p_action text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.lock_student(p_student);
 if p_date is null or p_date>public.today_sp() then raise exception 'Escolha uma data de hoje ou do passado.';end if;
 if p_action='add' then insert into public.attendances(student_id,training_date,actor_id) values(p_student,p_date,auth.uid()) on conflict do nothing;
 elsif p_action='remove' then delete from public.attendances where student_id=p_student and training_date=p_date;
 else raise exception 'Correção inválida.';end if;
end $$;
create function public.set_initial(p_student uuid,p_belt text,p_degrees integer,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.';end if;
 perform public.lock_student(p_student,p_revision);
 if exists(select 1 from public.graduations where student_id=p_student) then raise exception 'A situação inicial já foi definida ou existe uma graduação.';end if;
 insert into public.graduations(student_id,actor_id,kind,belt,degrees) values(p_student,auth.uid(),'initial',p_belt,p_degrees);
 update public.profiles set revision=revision+1 where id=p_student;
end $$;
create function public.graduate_student(p_student uuid,p_kind text,p_key uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare v_belt text:='branca';v_degrees integer:=0;v_belts text[]:=array['branca','azul','roxa','marrom','preta'];v_existing public.graduations;
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.';end if;
 perform public.lock_student(p_student);
 if p_key is null then raise exception 'Identificador obrigatório.';end if;
 select * into v_existing from public.graduations where id=p_key;
 if found then
  if v_existing.student_id<>p_student or v_existing.kind<>p_kind then raise exception 'Operação inválida.';end if;
  return;
 end if;
 perform public.lock_student(p_student,p_revision);
 select belt,degrees into v_belt,v_degrees from public.graduations where student_id=p_student and cancelled_at is null order by sequence desc limit 1;
 v_belt:=coalesce(v_belt,'branca');v_degrees:=coalesce(v_degrees,0);
 if p_kind='grau' then
  if v_belt='preta' or v_degrees>=4 then raise exception 'Não é possível conceder outro grau nesta faixa.';end if;
  v_degrees:=v_degrees+1;
 elsif p_kind='faixa' then
  if v_belt='preta' then raise exception 'A faixa preta encerra as promoções nesta versão.';end if;
  v_belt:=v_belts[array_position(v_belts,v_belt)+1];v_degrees:=0;
 else raise exception 'Graduação inválida.';end if;
 insert into public.graduations(id,student_id,actor_id,kind,belt,degrees) values(p_key,p_student,auth.uid(),p_kind,v_belt,v_degrees);
 update public.profiles set revision=revision+1 where id=p_student;
end $$;
create function public.undo_graduation(p_student uuid,p_event uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare v_latest uuid;
begin
 if p_revision is null then raise exception 'Atualize a tela antes de continuar.';end if;
 perform public.lock_student(p_student);
 if exists(select 1 from public.graduations where id=p_event and student_id=p_student and cancelled_at is not null) then return;end if;
 perform public.lock_student(p_student,p_revision);
 select id into v_latest from public.graduations where student_id=p_student and kind<>'initial' and cancelled_at is null order by sequence desc limit 1;
 if v_latest is null or v_latest<>p_event then raise exception 'Somente a última graduação pode ser desfeita. Atualize a tela.';end if;
 update public.graduations set cancelled_at=now(),cancelled_by=auth.uid() where id=v_latest;
 update public.profiles set revision=revision+1 where id=p_student;
end $$;
create function public.student_detail(p_student uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_profile public.profiles;v_belt text;v_degrees integer;v_cutoff date;v_total bigint;v_cycle bigint;v_result jsonb;
begin
 if auth.uid() is null or (auth.uid()<>p_student and not public.is_teacher()) then raise exception 'Acesso não permitido.';end if;
 select * into v_profile from public.profiles where id=p_student;
 if not found then raise exception 'Aluno não encontrado.';end if;
 select belt,degrees into v_belt,v_degrees from public.graduations where student_id=p_student and cancelled_at is null order by sequence desc limit 1;
 select event_date into v_cutoff from public.graduations where student_id=p_student and kind<>'initial' and cancelled_at is null order by sequence desc limit 1;
 select count(*),count(*) filter(where v_cutoff is null or training_date>v_cutoff) into v_total,v_cycle from public.attendances where student_id=p_student;
 v_result:=jsonb_build_object('id',p_student,'name',v_profile.name,'role',v_profile.role,'revision',v_profile.revision,'belt',coalesce(v_belt,'branca'),'degrees',coalesce(v_degrees,0),'total',v_total,'cycle',v_cycle,'today',public.today_sp(),'initialSet',exists(select 1 from public.graduations where student_id=p_student),'attendances',coalesce((select jsonb_agg(training_date order by training_date desc) from public.attendances where student_id=p_student),'[]'::jsonb),'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'belt',belt,'degrees',degrees,'date',event_date,'cancelled',cancelled_at is not null) order by sequence desc) from public.graduations where student_id=p_student),'[]'::jsonb));
 return v_result;
end $$;
create function public.list_students() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_teacher();
 return coalesce((select jsonb_agg(public.student_detail(id) order by name) from public.profiles where role='aluno'),'[]'::jsonb);
end $$;

-- No default PUBLIC execution; internal helpers are never exposed as RPCs.
revoke execute on all functions in schema public from public,anon,authenticated;
grant usage on schema public to anon,authenticated;
grant execute on function public.today_sp(), public.is_teacher(),public.get_settings(),public.mark_attendance(),public.student_detail(uuid),public.list_students(),public.update_settings(integer,text),public.correct_attendance(uuid,date,text),public.set_initial(uuid,text,integer,integer),public.graduate_student(uuid,text,uuid,integer),public.undo_graduation(uuid,uuid,integer) to authenticated;

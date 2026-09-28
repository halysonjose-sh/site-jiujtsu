-- Editar perfil: o aluno passa a poder alterar também o próprio nome.
-- Email e senha são do Supabase Auth (updateUser no front) e não passam pelo banco.
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
  where id = auth.uid();
end $$;
revoke execute on function public.update_my_profile(text, text, date) from public, anon;
grant execute on function public.update_my_profile(text, text, date) to authenticated;
drop function public.update_my_profile(text, date);

-- Equipe técnica da turma (professores e dono), para o dono gerenciar papéis.
create function public.list_staff() returns table (
 id uuid, name text, role text
) language sql stable security definer set search_path='' as $$
 select m.user_id, p.name, m.role
  from public.team_members m join public.profiles p on p.id = m.user_id
  where m.team_id = public.my_team() and m.role in ('professor','dono')
  order by (m.role = 'dono') desc, p.name;
$$;
revoke execute on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

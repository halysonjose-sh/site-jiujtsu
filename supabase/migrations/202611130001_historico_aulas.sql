-- ---------------------------------------------------------------- histórico de aulas
-- Aulas que o aluno fez fora do aplicativo: o professor soma ao histórico dele
-- quando quiser, sem criar aula no calendário. Conta no total e na frequência
-- do mesmo jeito que as aulas anteriores informadas na criação do aluno —
-- é por isso que mora em team_members.initial_total.

create function public.add_student_history(p_user uuid, p_count integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_member public.team_members;
begin
  perform public.require_teacher();
  select * into v_member from public.team_members
   where user_id = p_user and team_id = public.my_team() and role = 'aluno';
  if not found then raise exception 'Aluno não encontrado.'; end if;
  -- Mesmo teto e mesma validação das aulas anteriores do cadastro.
  if p_count is null or p_count < 1 or p_count > 10000 then
   raise exception 'Informe quantas aulas ele fez.';
  end if;
  if v_member.initial_total + p_count > 10000 then
   raise exception 'O histórico não pode passar de 10.000 aulas.';
  end if;
  update public.team_members set initial_total = initial_total + p_count
   where team_id = v_member.team_id and user_id = v_member.user_id;
end $$;

revoke execute on function public.add_student_history(uuid, integer) from public, anon, authenticated;
grant execute on function public.add_student_history(uuid, integer) to authenticated;

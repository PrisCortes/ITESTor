-- Repara la policy de loan_requests sin modificar tablas, FKs ni datos.
-- La comprobación de propuestas se ejecuta sin RLS para evitar el ciclo
-- loan_requests -> loan_offers -> loan_requests durante los embeds de chats.
create or replace function public.current_user_offered_loan(p_loan_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.loan_offers o
    where o.loan_request_id = p_loan_request_id
      and o.lender_id = auth.uid()
  );
$$;

revoke all on function public.current_user_offered_loan(uuid) from public;
grant execute on function public.current_user_offered_loan(uuid) to authenticated;

drop policy if exists "loan requests visible to relevant users" on public.loan_requests;
create policy "loan requests visible to relevant users" on public.loan_requests
for select to authenticated
using (
  status = 'OPEN'
  or requester_id = auth.uid()
  or public.current_user_offered_loan(id)
  or exists (
    select 1
    from public.loans l
    where l.loan_request_id = public.loan_requests.id
      and auth.uid() in (l.requester_id, l.lender_id)
  )
);

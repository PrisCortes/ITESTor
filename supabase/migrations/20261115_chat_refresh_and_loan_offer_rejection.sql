-- Ajustes de actualización de chat: evita actualizaciones repetidas de recibos
-- y permite que quien solicitó un préstamo rechace una propuesta concreta.

create or replace function public.mark_chat_messages_seen(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.chats
    where id = p_chat_id and auth.uid() in (participant_a, participant_b)
  ) then
    raise exception 'No eres participante de este chat';
  end if;

  update public.message_receipts
  set delivered_at = coalesce(delivered_at, now()),
      read_at = coalesce(read_at, now())
  where recipient_id = auth.uid()
    and (delivered_at is null or read_at is null)
    and message_id in (select id from public.messages where chat_id = p_chat_id);
end;
$$;

create or replace function public.reject_loan_offer(p_offer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  offer public.loan_offers;
  request_row public.loan_requests;
begin
  select * into offer from public.loan_offers where id = p_offer_id for update;
  if not found or offer.status <> 'PENDING' then
    raise exception 'La propuesta ya no está disponible';
  end if;

  select * into request_row from public.loan_requests where id = offer.loan_request_id for update;
  if request_row.requester_id <> auth.uid() or request_row.status <> 'OPEN' then
    raise exception 'No puedes rechazar esta propuesta';
  end if;

  update public.loan_offers set status = 'REJECTED' where id = offer.id;
end;
$$;

revoke all on function public.reject_loan_offer(uuid) from public, anon;
grant execute on function public.reject_loan_offer(uuid) to authenticated;

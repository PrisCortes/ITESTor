-- ITEStore: módulo completo de préstamos. Ejecutar una vez sobre la base existente.
alter type public.loan_offer_status add value if not exists 'ACCEPTED';
alter type public.loan_offer_status add value if not exists 'CANCELLED';
alter table public.loans add column if not exists closed_at timestamptz;
create index if not exists loan_offers_request_status_idx on public.loan_offers(loan_request_id, status);

-- Expira solicitudes abiertas al consultarlas; no cierra préstamos ya seleccionados.
create or replace function public.expire_loan_requests() returns integer
language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  update public.loan_requests set status = 'EXPIRED'
  where status = 'OPEN' and deadline <= now();
  get diagnostics changed_count = row_count;
  return changed_count;
end; $$;

create or replace function public.create_loan_offer(p_loan_request_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare req public.loan_requests; chat_id uuid;
begin
  select * into req from public.loan_requests where id = p_loan_request_id for update;
  if not found or req.status <> 'OPEN' or req.deadline <= now() then raise exception 'La solicitud ya no acepta propuestas'; end if;
  if req.requester_id = auth.uid() then raise exception 'No puedes ofrecerte para tu propia solicitud'; end if;
  if char_length(coalesce(p_note,'')) > 1000 then raise exception 'El mensaje es demasiado largo'; end if;
  if exists (select 1 from public.loan_offers where loan_request_id = req.id and lender_id = auth.uid() and status = 'PENDING') then raise exception 'Ya enviaste una propuesta para esta solicitud'; end if;
  insert into public.loan_offers(loan_request_id,lender_id,note,status) values(req.id,auth.uid(),nullif(trim(p_note),''),'PENDING');
  select id into chat_id from public.chats where loan_request_id = req.id and ((participant_a = auth.uid() and participant_b = req.requester_id) or (participant_b = auth.uid() and participant_a = req.requester_id)) limit 1;
  if chat_id is null then insert into public.chats(loan_request_id,participant_a,participant_b) values(req.id,auth.uid(),req.requester_id) returning id into chat_id; end if;
  insert into public.internal_notifications(user_id,type,title,body,link) values(req.requester_id,'LOAN_OFFER','Nueva propuesta de préstamo','Un estudiante se ofreció a prestarte el artículo.', '/#loans');
  return chat_id;
end; $$;

create or replace function public.select_loan_lender(p_offer_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare offer public.loan_offers; req public.loan_requests; loan_id uuid;
begin
  select * into offer from public.loan_offers where id = p_offer_id for update;
  if not found or offer.status <> 'PENDING' then raise exception 'La propuesta ya no está disponible'; end if;
  select * into req from public.loan_requests where id = offer.loan_request_id for update;
  if req.requester_id <> auth.uid() or req.status <> 'OPEN' or req.deadline <= now() then raise exception 'No puedes seleccionar esta propuesta'; end if;
  update public.loan_offers set status = 'REJECTED' where loan_request_id = req.id and id <> offer.id and status = 'PENDING';
  update public.loan_offers set status = 'ACCEPTED' where id = offer.id;
  update public.loan_requests set status = 'SELECTED' where id = req.id;
  insert into public.loans(loan_request_id,loan_offer_id,requester_id,lender_id,status,expected_return_at) values(req.id,offer.id,req.requester_id,offer.lender_id,'SELECTED',req.estimated_return) returning id into loan_id;
  insert into public.internal_notifications(user_id,type,title,body,link) values(offer.lender_id,'LOAN_SELECTED','Fuiste seleccionado','Coordina la entrega del préstamo por el chat.', '/#chats');
  return loan_id;
end; $$;

create or replace function public.schedule_loan(p_loan_id uuid, p_meeting_point_id uuid, p_meeting_at timestamptz) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id = p_loan_id for update;
  if not found or auth.uid() not in (loan_row.requester_id,loan_row.lender_id) or loan_row.status not in ('SELECTED','SCHEDULED') then raise exception 'No puedes programar este préstamo'; end if;
  if p_meeting_at <= now() or not exists(select 1 from public.meeting_points where id = p_meeting_point_id and active) then raise exception 'Datos de encuentro no válidos'; end if;
  update public.loans set meeting_point_id=p_meeting_point_id,meeting_at=p_meeting_at,status='SCHEDULED' where id=loan_row.id returning * into loan_row;
  update public.loan_requests set status='SCHEDULED' where id=loan_row.loan_request_id;
  insert into public.internal_notifications(user_id,type,title,body,link) values(loan_row.requester_id,'LOAN_MEETING','Entrega programada','Tu encuentro de préstamo fue programado.', '/#chats'),(loan_row.lender_id,'LOAN_MEETING','Entrega programada','Tu encuentro de préstamo fue programado.', '/#chats');
  return loan_row;
end; $$;

create or replace function public.cancel_loan(p_loan_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id=p_loan_id for update;
  if not found or auth.uid() not in (loan_row.requester_id,loan_row.lender_id) or loan_row.status not in ('SELECTED','SCHEDULED') then raise exception 'No puedes cancelar este préstamo'; end if;
  update public.loans set status='CANCELLED',closed_at=now() where id=loan_row.id;
  update public.loan_requests set status='CANCELLED' where id=loan_row.loan_request_id;
  update public.loan_offers set status='CANCELLED' where id=loan_row.loan_offer_id;
end; $$;

create or replace function public.confirm_loan_delivery(p_loan_id uuid, p_action text) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id=p_loan_id for update;
  if not found or loan_row.status not in ('SCHEDULED') then raise exception 'El préstamo no está listo para confirmar'; end if;
  if p_action='DELIVERY' and loan_row.lender_id=auth.uid() then update public.loans set lender_delivered_at=coalesce(lender_delivered_at,now()) where id=loan_row.id returning * into loan_row;
  elsif p_action='RECEPTION' and loan_row.requester_id=auth.uid() then update public.loans set requester_received_at=coalesce(requester_received_at,now()) where id=loan_row.id returning * into loan_row;
  else raise exception 'Confirmación no autorizada'; end if;
  if loan_row.lender_delivered_at is not null and loan_row.requester_received_at is not null then update public.loans set status='ACTIVE' where id=loan_row.id returning * into loan_row; update public.loan_requests set status='ACTIVE' where id=loan_row.loan_request_id; insert into public.internal_notifications(user_id,type,title,body,link) values(loan_row.requester_id,'LOAN_RETURN','Recordatorio de devolución','El préstamo está activo; coordina la devolución antes de la fecha acordada.', '/#chats'),(loan_row.lender_id,'LOAN_RETURN','Recordatorio de devolución','El préstamo está activo; coordina la devolución antes de la fecha acordada.', '/#chats'); end if;
  return loan_row;
end; $$;

create or replace function public.start_loan_return(p_loan_id uuid) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id=p_loan_id for update;
  if not found or auth.uid() not in (loan_row.requester_id,loan_row.lender_id) or loan_row.status <> 'ACTIVE' then raise exception 'No puedes iniciar la devolución'; end if;
  update public.loans set status='RETURN_PENDING' where id=loan_row.id returning * into loan_row;
  update public.loan_requests set status='RETURN_PENDING' where id=loan_row.loan_request_id;
  return loan_row;
end; $$;

create or replace function public.confirm_loan_return(p_loan_id uuid, p_action text) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id=p_loan_id for update;
  if not found or loan_row.status <> 'RETURN_PENDING' then raise exception 'La devolución no está lista para confirmar'; end if;
  if p_action='RETURN' and loan_row.requester_id=auth.uid() then update public.loans set requester_returned_at=coalesce(requester_returned_at,now()) where id=loan_row.id returning * into loan_row;
  elsif p_action='RETURN_RECEPTION' and loan_row.lender_id=auth.uid() then update public.loans set lender_received_at=coalesce(lender_received_at,now()) where id=loan_row.id returning * into loan_row;
  else raise exception 'Confirmación no autorizada'; end if;
  if loan_row.requester_returned_at is not null and loan_row.lender_received_at is not null then update public.loans set status='CLOSED',closed_at=now() where id=loan_row.id returning * into loan_row; update public.loan_requests set status='CLOSED' where id=loan_row.loan_request_id; end if;
  return loan_row;
end; $$;

-- Las transiciones críticas se limitan a RPCs; no hay modificaciones directas desde el cliente.
drop policy if exists "requester updates loan request" on public.loan_requests;
drop policy if exists "lender creates offer" on public.loan_offers;
drop policy if exists "offer participant update" on public.loan_offers;
drop policy if exists "requester creates loan" on public.loans;
drop policy if exists "loan participants update" on public.loans;
drop policy if exists "open loans readable" on public.loan_requests;
create policy "loan requests visible to relevant users" on public.loan_requests for select using (status = 'OPEN' or requester_id = auth.uid() or exists(select 1 from public.loan_offers o where o.loan_request_id=public.loan_requests.id and o.lender_id=auth.uid()) or exists(select 1 from public.loans l where l.loan_request_id=public.loan_requests.id and auth.uid() in (l.requester_id,l.lender_id)));

revoke execute on function public.create_loan_offer(uuid,text), public.select_loan_lender(uuid), public.schedule_loan(uuid,uuid,timestamptz), public.cancel_loan(uuid), public.confirm_loan_delivery(uuid,text), public.start_loan_return(uuid), public.confirm_loan_return(uuid,text) from public;
grant execute on function public.create_loan_offer(uuid,text), public.select_loan_lender(uuid), public.schedule_loan(uuid,uuid,timestamptz), public.cancel_loan(uuid), public.confirm_loan_delivery(uuid,text), public.start_loan_return(uuid), public.confirm_loan_return(uuid,text) to authenticated;
grant execute on function public.expire_loan_requests() to anon, authenticated;

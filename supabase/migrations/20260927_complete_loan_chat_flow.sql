-- Completa el flujo de devolución sin alterar ni eliminar préstamos existentes.
alter table public.loans
  add column if not exists return_meeting_point_id uuid references public.meeting_points(id) on delete restrict,
  add column if not exists return_meeting_at timestamptz;

create or replace function public.schedule_loan_return(
  p_loan_id uuid,
  p_return_meeting_point_id uuid,
  p_return_meeting_at timestamptz
) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id = p_loan_id for update;
  if not found
    or auth.uid() not in (loan_row.requester_id, loan_row.lender_id)
    or loan_row.status not in ('ACTIVE', 'RETURN_PENDING') then
    raise exception 'No puedes programar la devolución de este préstamo';
  end if;
  if loan_row.requester_returned_at is not null or loan_row.lender_received_at is not null then
    raise exception 'La devolución ya tiene confirmaciones y no puede reprogramarse';
  end if;
  if p_return_meeting_at <= now()
    or not exists (
      select 1 from public.meeting_points
      where id = p_return_meeting_point_id and active
    ) then
    raise exception 'Datos de devolución no válidos';
  end if;

  update public.loans
  set return_meeting_point_id = p_return_meeting_point_id,
      return_meeting_at = p_return_meeting_at,
      status = 'RETURN_PENDING'
  where id = loan_row.id
  returning * into loan_row;

  update public.loan_requests
  set status = 'RETURN_PENDING'
  where id = loan_row.loan_request_id;

  insert into public.internal_notifications(user_id, type, title, body, link)
  values
    (loan_row.requester_id, 'LOAN_RETURN_MEETING', 'Devolución programada', 'El encuentro para devolver el artículo fue programado.', '/#chats'),
    (loan_row.lender_id, 'LOAN_RETURN_MEETING', 'Devolución programada', 'El encuentro para devolver el artículo fue programado.', '/#chats');

  return loan_row;
end;
$$;

-- No se puede alterar una entrega parcialmente confirmada.
create or replace function public.schedule_loan(
  p_loan_id uuid,
  p_meeting_point_id uuid,
  p_meeting_at timestamptz
) returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id = p_loan_id for update;
  if not found
    or auth.uid() not in (loan_row.requester_id, loan_row.lender_id)
    or loan_row.status not in ('SELECTED', 'SCHEDULED') then
    raise exception 'No puedes programar este préstamo';
  end if;
  if loan_row.lender_delivered_at is not null or loan_row.requester_received_at is not null then
    raise exception 'La entrega ya tiene confirmaciones y no puede reprogramarse';
  end if;
  if p_meeting_at <= now()
    or not exists (
      select 1 from public.meeting_points
      where id = p_meeting_point_id and active
    ) then
    raise exception 'Datos de encuentro no válidos';
  end if;

  update public.loans
  set meeting_point_id = p_meeting_point_id,
      meeting_at = p_meeting_at,
      status = 'SCHEDULED'
  where id = loan_row.id
  returning * into loan_row;

  update public.loan_requests
  set status = 'SCHEDULED'
  where id = loan_row.loan_request_id;

  insert into public.internal_notifications(user_id, type, title, body, link)
  values
    (loan_row.requester_id, 'LOAN_MEETING', 'Entrega programada', 'Tu encuentro de préstamo fue programado.', '/#chats'),
    (loan_row.lender_id, 'LOAN_MEETING', 'Entrega programada', 'Tu encuentro de préstamo fue programado.', '/#chats');

  return loan_row;
end;
$$;

-- La devolución requiere un encuentro registrado antes de aceptar confirmaciones.
create or replace function public.confirm_loan_return(p_loan_id uuid, p_action text)
returns public.loans
language plpgsql security definer set search_path = public as $$
declare loan_row public.loans;
begin
  select * into loan_row from public.loans where id = p_loan_id for update;
  if not found or loan_row.status <> 'RETURN_PENDING' then
    raise exception 'La devolución no está lista para confirmar';
  end if;
  if loan_row.return_meeting_point_id is null or loan_row.return_meeting_at is null then
    raise exception 'Primero programa el encuentro de devolución';
  end if;
  if p_action = 'RETURN' and loan_row.requester_id = auth.uid() then
    update public.loans
    set requester_returned_at = coalesce(requester_returned_at, now())
    where id = loan_row.id
    returning * into loan_row;
  elsif p_action = 'RETURN_RECEPTION' and loan_row.lender_id = auth.uid() then
    update public.loans
    set lender_received_at = coalesce(lender_received_at, now())
    where id = loan_row.id
    returning * into loan_row;
  else
    raise exception 'Confirmación no autorizada';
  end if;
  if loan_row.requester_returned_at is not null and loan_row.lender_received_at is not null then
    update public.loans
    set status = 'CLOSED', closed_at = now()
    where id = loan_row.id
    returning * into loan_row;
    update public.loan_requests set status = 'CLOSED' where id = loan_row.loan_request_id;
  end if;
  return loan_row;
end;
$$;

revoke execute on function public.schedule_loan_return(uuid, uuid, timestamptz) from public;
grant execute on function public.schedule_loan_return(uuid, uuid, timestamptz) to authenticated;

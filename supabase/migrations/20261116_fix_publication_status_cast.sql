-- Corrige instalaciones ya actualizadas: el CASE de la reserva debe devolver
-- publication_status explícitamente, no texto.
create or replace function public.respond_to_transaction(p_request_id uuid, p_accept boolean) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare req public.transaction_requests; pub public.publications; tx public.transactions;
begin
  select * into req from public.transaction_requests where id = p_request_id for update;
  if not found or req.seller_id <> auth.uid() or req.status <> 'PENDING' then raise exception 'Solicitud no disponible para responder'; end if;
  if not p_accept then
    update public.transaction_requests set status='REJECTED'::public.request_status where id=req.id;
    return null;
  end if;
  select * into pub from public.publications where id=req.publication_id for update;
  if pub.status <> 'AVAILABLE' or pub.stock < req.quantity then raise exception 'No hay stock suficiente'; end if;
  update public.transaction_requests set status='ACCEPTED'::public.request_status where id=req.id;
  update public.publications
  set stock=pub.stock-req.quantity,
      status=case when pub.stock-req.quantity=0 then 'PENDING'::public.publication_status else 'AVAILABLE'::public.publication_status end
  where id=pub.id;
  insert into public.transactions(request_id,publication_id,buyer_id,seller_id,quantity,stock_reserved_at)
  values(req.id,req.publication_id,req.buyer_id,req.seller_id,req.quantity,now()) returning * into tx;
  return tx;
end;
$$;

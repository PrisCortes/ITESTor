-- Reserva el inventario al aceptar una compra y lo devuelve solamente si esa
-- transacción se cancela. Las transacciones anteriores conservan su semántica.
alter table public.transactions add column if not exists stock_reserved_at timestamptz;

create or replace function public.respond_to_transaction(p_request_id uuid, p_accept boolean) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare req public.transaction_requests; pub public.publications; tx public.transactions;
begin
  select * into req from public.transaction_requests where id = p_request_id for update;
  if not found or req.seller_id <> auth.uid() or req.status <> 'PENDING' then raise exception 'Solicitud no disponible para responder'; end if;
  if not p_accept then update public.transaction_requests set status='REJECTED' where id=req.id; return null; end if;
  select * into pub from public.publications where id=req.publication_id for update;
  if pub.status <> 'AVAILABLE' or pub.stock < req.quantity then raise exception 'No hay stock suficiente'; end if;
  update public.transaction_requests set status='ACCEPTED' where id=req.id;
  update public.publications set stock=pub.stock-req.quantity, status=case when pub.stock-req.quantity=0 then 'PENDING'::public.publication_status else 'AVAILABLE'::public.publication_status end where id=pub.id;
  insert into public.transactions(request_id,publication_id,buyer_id,seller_id,quantity,stock_reserved_at)
  values(req.id,req.publication_id,req.buyer_id,req.seller_id,req.quantity,now()) returning * into tx;
  return tx;
end;
$$;

create or replace function public.confirm_transaction(p_transaction_id uuid, p_action text) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare tx public.transactions; pub public.publications; final_stock integer;
begin
  select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or tx.status not in ('SCHEDULED','DELIVERED','RECEIVED') then raise exception 'La operación no está lista para confirmar'; end if;
  if p_action='DELIVERY' and tx.seller_id=auth.uid() then
    update public.transactions set delivered_at=now(),status=case when received_at is not null then 'COMPLETED'::public.transaction_status else 'DELIVERED'::public.transaction_status end where id=tx.id returning * into tx;
  elsif p_action='RECEPTION' and tx.buyer_id=auth.uid() then
    update public.transactions set received_at=now(),status=case when delivered_at is not null then 'COMPLETED'::public.transaction_status else 'RECEIVED'::public.transaction_status end where id=tx.id returning * into tx;
  else raise exception 'Confirmación no autorizada'; end if;
  if tx.status='COMPLETED' then
    select * into pub from public.publications where id=tx.publication_id for update;
    final_stock := case when tx.stock_reserved_at is null then pub.stock-tx.quantity else pub.stock end;
    if final_stock < 0 then raise exception 'El inventario no puede ser negativo'; end if;
    update public.publications set stock=final_stock, status=case when final_stock=0 then 'COMPLETED' else 'AVAILABLE' end, completed_at=case when final_stock=0 then now() else null end where id=pub.id;
    update public.transaction_requests set status='COMPLETED' where id=tx.request_id;
    update public.transactions set completed_at=now() where id=tx.id returning * into tx;
  end if;
  return tx;
end;
$$;

create or replace function public.cancel_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tx public.transactions; pub public.publications;
begin
  select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or auth.uid() not in (tx.buyer_id,tx.seller_id) or tx.status in ('COMPLETED','CANCELLED') then raise exception 'No puedes cancelar esta operación'; end if;
  update public.transactions set status='CANCELLED',cancelled_at=now() where id=tx.id;
  update public.transaction_requests set status='CANCELLED' where id=tx.request_id;
  select * into pub from public.publications where id=tx.publication_id for update;
  update public.publications set stock=case when tx.stock_reserved_at is null then pub.stock else pub.stock+tx.quantity end,status='AVAILABLE',completed_at=null where id=pub.id;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='publications'
  ) then
    alter publication supabase_realtime add table public.publications;
  end if;
end $$;

-- Corrección para instalaciones que ya ejecutaron la migración de reserva.
-- CASE debe devolver explícitamente el enum transaction_status, no texto.
create or replace function public.confirm_transaction(p_transaction_id uuid, p_action text) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare tx public.transactions; pub public.publications; final_stock integer;
begin
  select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or tx.status not in ('SCHEDULED','DELIVERED','RECEIVED') then raise exception 'La operación no está lista para confirmar'; end if;
  if p_action='DELIVERY' and tx.seller_id=auth.uid() then
    update public.transactions
    set delivered_at=now(), status=case when received_at is not null then 'COMPLETED'::public.transaction_status else 'DELIVERED'::public.transaction_status end
    where id=tx.id returning * into tx;
  elsif p_action='RECEPTION' and tx.buyer_id=auth.uid() then
    update public.transactions
    set received_at=now(), status=case when delivered_at is not null then 'COMPLETED'::public.transaction_status else 'RECEIVED'::public.transaction_status end
    where id=tx.id returning * into tx;
  else raise exception 'Confirmación no autorizada'; end if;
  if tx.status='COMPLETED' then
    select * into pub from public.publications where id=tx.publication_id for update;
    final_stock := case when tx.stock_reserved_at is null then pub.stock-tx.quantity else pub.stock end;
    if final_stock < 0 then raise exception 'El inventario no puede ser negativo'; end if;
    update public.publications
    set stock=final_stock,
        status=case when final_stock=0 then 'COMPLETED'::public.publication_status else 'AVAILABLE'::public.publication_status end,
        completed_at=case when final_stock=0 then now() else null end
    where id=pub.id;
    update public.transaction_requests set status='COMPLETED'::public.request_status where id=tx.request_id;
    update public.transactions set completed_at=now() where id=tx.id returning * into tx;
  end if;
  return tx;
end;
$$;

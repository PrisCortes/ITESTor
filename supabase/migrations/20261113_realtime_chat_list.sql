-- Fase 1: mantiene la actividad del chat sincronizada sin borrar historial.
-- Cada evento relevante actualiza solamente el chat contextual que ya existe.
create or replace function public.touch_chat_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'messages' then
    update public.chats set updated_at = new.created_at where id = new.chat_id;
  elsif tg_table_name = 'transaction_requests' then
    update public.chats set updated_at = now() where transaction_request_id = new.id;
  elsif tg_table_name = 'transactions' then
    update public.chats set updated_at = now() where transaction_request_id = new.request_id;
  elsif tg_table_name = 'loan_requests' then
    update public.chats set updated_at = now() where loan_request_id = new.id;
  elsif tg_table_name = 'loans' then
    update public.chats set updated_at = now() where loan_request_id = new.loan_request_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.touch_chat_activity() from public, anon, authenticated;

drop trigger if exists messages_touch_chat_activity on public.messages;
create trigger messages_touch_chat_activity
after insert on public.messages
for each row execute function public.touch_chat_activity();

drop trigger if exists transaction_requests_touch_chat_activity on public.transaction_requests;
create trigger transaction_requests_touch_chat_activity
after update on public.transaction_requests
for each row execute function public.touch_chat_activity();

drop trigger if exists transactions_touch_chat_activity on public.transactions;
create trigger transactions_touch_chat_activity
after insert or update on public.transactions
for each row execute function public.touch_chat_activity();

drop trigger if exists loan_requests_touch_chat_activity on public.loan_requests;
create trigger loan_requests_touch_chat_activity
after update on public.loan_requests
for each row execute function public.touch_chat_activity();

drop trigger if exists loans_touch_chat_activity on public.loans;
create trigger loans_touch_chat_activity
after insert or update on public.loans
for each row execute function public.touch_chat_activity();

-- messages ya existe en instalaciones nuevas; estas comprobaciones mantienen
-- la migración segura en proyectos creados con versiones anteriores.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chats'
    ) then
      alter publication supabase_realtime add table public.chats;
    end if;
  else
    raise exception 'No existe la publicación supabase_realtime; ejecuta primero schema.sql y habilita Realtime.';
  end if;
end;
$$;

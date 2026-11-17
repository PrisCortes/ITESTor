-- Permite conversaciones directas iniciadas desde un perfil, sin alterar los chats
-- ya vinculados a compras, intercambios o préstamos.
do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.chats'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%transaction_request_id%'
    and pg_get_constraintdef(oid) like '%loan_request_id%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.chats drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.chats
  add constraint chats_one_optional_context
  check ((transaction_request_id is not null)::integer + (loan_request_id is not null)::integer <= 1);

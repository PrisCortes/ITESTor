-- Tablas que actualizan la interfaz de chat y las alertas persistentes.
-- Se comprueba cada una para que la migración sea compatible con proyectos ya inicializados.
do $$
declare relation_name text;
begin
  foreach relation_name in array array['transaction_requests','transactions','loan_requests','loan_offers','loans','ratings','message_receipts','internal_notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = relation_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', relation_name);
    end if;
  end loop;
end $$;

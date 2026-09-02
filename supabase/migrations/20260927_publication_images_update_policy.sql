-- Ejecuta este ajuste solo si policies.sql ya fue aplicado antes de esta mejora.
create policy "owner updates image row" on public.publication_images
for update to authenticated
using (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid()))
with check (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid()));

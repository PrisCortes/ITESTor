-- Ejecuta este ajuste solo si policies.sql ya fue aplicado antes de esta mejora.
drop policy if exists "available publications readable" on public.publications;
create policy "catalog or owner publications readable" on public.publications
for select using (status <> 'COMPLETED' or owner_id = auth.uid());

drop policy if exists "publication images readable" on public.publication_images;
create policy "visible publication images readable" on public.publication_images
for select using (exists (select 1 from public.publications p where p.id = publication_id and (p.status <> 'COMPLETED' or p.owner_id = auth.uid())));

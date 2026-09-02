-- ITEStore: ejecuta este archivo después de policies.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publication-images','publication-images',true,5242880,array['image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "public catalog image read" on storage.objects for select using (bucket_id = 'publication-images');
create policy "owner uploads publication image" on storage.objects for insert to authenticated with check (bucket_id = 'publication-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates own publication image" on storage.objects for update to authenticated using (bucket_id = 'publication-images' and owner_id = auth.uid()) with check (bucket_id = 'publication-images' and owner_id = auth.uid());
create policy "owner deletes own publication image" on storage.objects for delete to authenticated using (bucket_id = 'publication-images' and owner_id = auth.uid());

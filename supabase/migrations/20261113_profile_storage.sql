-- Avatares públicos mínimos; la ruta se limita al UUID del propietario.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images','profile-images',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "public profile image read" on storage.objects for select using (bucket_id = 'profile-images');
create policy "owner uploads profile image" on storage.objects for insert to authenticated with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates profile image" on storage.objects for update to authenticated using (bucket_id = 'profile-images' and owner_id = auth.uid()) with check (bucket_id = 'profile-images' and owner_id = auth.uid());
create policy "owner deletes profile image" on storage.objects for delete to authenticated using (bucket_id = 'profile-images' and owner_id = auth.uid());

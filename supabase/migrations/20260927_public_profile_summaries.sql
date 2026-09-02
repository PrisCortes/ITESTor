-- Ejecuta este ajuste solo si schema.sql ya fue aplicado antes de esta mejora.
create or replace view public.public_profile_summaries as
  select id, name, career_id, rating_average from public.profiles;
grant select on public.public_profile_summaries to anon, authenticated;

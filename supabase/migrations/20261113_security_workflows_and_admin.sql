-- Protección de interacciones, flujos administrativos y métricas. Es una migración
-- incremental: no elimina historial ni sustituye las RPC existentes.

alter table public.publications
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists removal_reason text check (char_length(removal_reason) <= 1000);

-- El resumen es la única fuente pública de datos de perfil que consume la interfaz.
-- El correo institucional se publica porque forma parte explícita del perfil público
-- solicitado; no se exponen los campos privados de auth.users.
create or replace view public.public_profile_summaries as
  select p.id, p.name, p.email, p.career_id, p.rating_average, p.avatar_url
  from public.profiles p;
grant select on public.public_profile_summaries to anon, authenticated;

create or replace function public.assert_active_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_active_user() then
    raise exception 'Tu cuenta está suspendida y no puede realizar esta acción';
  end if;
  return new;
end;
$$;

create or replace function public.assert_unblocked_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare other_user uuid;
begin
  if tg_table_name = 'transaction_requests' then
    if public.users_blocked_between(new.buyer_id, new.seller_id) then raise exception 'No puedes iniciar una interacción con este usuario'; end if;
  elsif tg_table_name = 'chats' then
    if public.users_blocked_between(new.participant_a, new.participant_b) then raise exception 'No puedes iniciar una interacción con este usuario'; end if;
  elsif tg_table_name = 'messages' then
    select case when c.participant_a = new.sender_id then c.participant_b else c.participant_a end into other_user from public.chats c where c.id = new.chat_id;
    if other_user is null or public.users_blocked_between(new.sender_id, other_user) then raise exception 'No puedes enviar mensajes a este usuario'; end if;
  elsif tg_table_name = 'loan_offers' then
    select requester_id into other_user from public.loan_requests where id = new.loan_request_id;
    if other_user is null or public.users_blocked_between(new.lender_id, other_user) then raise exception 'No puedes iniciar una interacción con este usuario'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists publications_active_actor on public.publications;
create trigger publications_active_actor before insert or update on public.publications for each row execute function public.assert_active_actor();
drop trigger if exists transaction_requests_active_actor on public.transaction_requests;
create trigger transaction_requests_active_actor before insert or update on public.transaction_requests for each row execute function public.assert_active_actor();
drop trigger if exists loan_requests_active_actor on public.loan_requests;
create trigger loan_requests_active_actor before insert or update on public.loan_requests for each row execute function public.assert_active_actor();
drop trigger if exists loan_offers_active_actor on public.loan_offers;
create trigger loan_offers_active_actor before insert or update on public.loan_offers for each row execute function public.assert_active_actor();
drop trigger if exists loans_active_actor on public.loans;
create trigger loans_active_actor before insert or update on public.loans for each row execute function public.assert_active_actor();
drop trigger if exists chats_active_actor on public.chats;
create trigger chats_active_actor before insert or update on public.chats for each row execute function public.assert_active_actor();
drop trigger if exists messages_active_actor on public.messages;
create trigger messages_active_actor before insert or update on public.messages for each row execute function public.assert_active_actor();

drop trigger if exists transaction_requests_unblocked on public.transaction_requests;
create trigger transaction_requests_unblocked before insert on public.transaction_requests for each row execute function public.assert_unblocked_interaction();
drop trigger if exists loan_offers_unblocked on public.loan_offers;
create trigger loan_offers_unblocked before insert on public.loan_offers for each row execute function public.assert_unblocked_interaction();
drop trigger if exists chats_unblocked on public.chats;
create trigger chats_unblocked before insert on public.chats for each row execute function public.assert_unblocked_interaction();
drop trigger if exists messages_unblocked on public.messages;
create trigger messages_unblocked before insert on public.messages for each row execute function public.assert_unblocked_interaction();

-- Las políticas restrictivas se combinan con las existentes, por lo que no amplían
-- el acceso legado. Conservan el acceso anónimo al catálogo público.
create policy "blocked users cannot see publications" on public.publications as restrictive for select
  using (auth.uid() is null or not public.users_blocked_between(auth.uid(), owner_id));
create policy "blocked users cannot see loan requests" on public.loan_requests as restrictive for select
  using (auth.uid() is null or not public.users_blocked_between(auth.uid(), requester_id));
create policy "active users modify publications" on public.publications as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "active users modify transaction requests" on public.transaction_requests as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "active users modify chats" on public.chats as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "active users modify messages" on public.messages as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "active users modify loan requests" on public.loan_requests as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "active users modify loan offers" on public.loan_offers as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create or replace function public.assert_chat_can_be_hidden()
returns trigger language plpgsql security definer set search_path = public as $$
declare request_row public.transaction_requests; transaction_row public.transactions; loan_row public.loans; allowed boolean := false;
begin
  if new.user_id <> auth.uid() then raise exception 'No puedes ocultar un chat ajeno'; end if;
  select r.* into request_row from public.chats c join public.transaction_requests r on r.id=c.transaction_request_id where c.id=new.chat_id;
  if found then
    if request_row.status = 'REJECTED' then allowed := true; end if;
    select t.* into transaction_row from public.transactions t where t.request_id=request_row.id;
    if transaction_row.status = 'CANCELLED' then allowed := true; end if;
    if transaction_row.status = 'COMPLETED' and exists(select 1 from public.ratings where transaction_id=transaction_row.id and rater_id=new.user_id) then allowed := true; end if;
  else
    select l.* into loan_row from public.chats c join public.loans l on l.loan_request_id=c.loan_request_id where c.id=new.chat_id;
    if loan_row.status in ('CANCELLED','CLOSED') then allowed := true; end if;
  end if;
  if not allowed then raise exception 'Esta conversación no puede ocultarse mientras la operación siga activa'; end if;
  return new;
end;
$$;
drop trigger if exists chat_hidden_allowed on public.chat_hidden_users;
create trigger chat_hidden_allowed before insert on public.chat_hidden_users for each row execute function public.assert_chat_can_be_hidden();

create or replace function public.admin_remove_publication(p_publication_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if not public.is_admin() then raise exception 'Acceso administrativo requerido'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 2 then raise exception 'Indica un motivo válido'; end if;
  update public.publications set status = 'COMPLETED', removed_at = now(), removed_by = auth.uid(), removal_reason = trim(p_reason), completed_at = coalesce(completed_at, now())
  where id = p_publication_id returning owner_id into owner;
  if owner is null then raise exception 'Publicación no encontrada'; end if;
  insert into public.admin_actions(admin_id, action_type, target_type, target_id, reason) values(auth.uid(), 'REMOVE_PUBLICATION', 'PUBLICATION', p_publication_id, trim(p_reason));
  insert into public.internal_notifications(user_id,type,title,body,link) values(owner,'ADMIN_PUBLICATION','Publicación retirada','Una publicación fue retirada: ' || trim(p_reason), '/#profile');
end;
$$;

create or replace function public.admin_resolve_report(p_report_type text, p_report_id uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acceso administrativo requerido'; end if;
  if p_status not in ('RESOLVED','DISMISSED') then raise exception 'Estado de resolución inválido'; end if;
  if p_report_type = 'PUBLICATION' then
    update public.publication_reports set status=p_status,resolved_by=auth.uid(),resolution=nullif(trim(p_resolution),''),resolved_at=now() where id=p_report_id and status='OPEN';
  elsif p_report_type = 'USER' then
    update public.user_reports set status=p_status,resolved_by=auth.uid(),resolution=nullif(trim(p_resolution),''),resolved_at=now() where id=p_report_id and status='OPEN';
  else raise exception 'Tipo de reporte inválido'; end if;
  if not found then raise exception 'Reporte no disponible'; end if;
  insert into public.admin_actions(admin_id,action_type,target_type,target_id,reason) values(auth.uid(),'RESOLVE_REPORT',p_report_type || '_REPORT',p_report_id,nullif(trim(p_resolution),''));
end;
$$;

create or replace function public.admin_suspend_user(p_user_id uuid, p_kind text, p_reason text, p_ends_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare suspension_id uuid;
begin
  if not public.is_admin() then raise exception 'Acceso administrativo requerido'; end if;
  if p_user_id = auth.uid() then raise exception 'No puedes suspender tu propia cuenta'; end if;
  if p_kind not in ('TEMPORARY','PERMANENT') or char_length(trim(coalesce(p_reason,''))) < 2 then raise exception 'Datos de suspensión inválidos'; end if;
  if p_kind='TEMPORARY' and (p_ends_at is null or p_ends_at <= now()) then raise exception 'La fecha de fin debe ser futura'; end if;
  insert into public.user_suspensions(user_id,admin_id,reason,kind,ends_at) values(p_user_id,auth.uid(),trim(p_reason),p_kind,case when p_kind='TEMPORARY' then p_ends_at else null end) returning id into suspension_id;
  insert into public.admin_actions(admin_id,action_type,target_type,target_id,reason) values(auth.uid(),'SUSPEND_' || p_kind,'USER',p_user_id,trim(p_reason));
  insert into public.internal_notifications(user_id,type,title,body,link) values(p_user_id,'ADMIN_SUSPENSION','Cuenta suspendida','Tu cuenta fue suspendida: ' || trim(p_reason), '/#profile');
  return suspension_id;
end;
$$;

create or replace function public.admin_statistics()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'total_users',(select count(*) from public.profiles),
    'sales_completed_by_month',(select coalesce(jsonb_agg(x order by x->>'month'),'[]'::jsonb) from (select jsonb_build_object('month',to_char(coalesce(t.completed_at,t.updated_at),'YYYY-MM'),'count',count(*)) x from public.transactions t where t.status='COMPLETED' group by to_char(coalesce(t.completed_at,t.updated_at),'YYYY-MM')) q),
    'loans_completed',(select count(*) from public.loans where status='CLOSED'),
    'loans_overdue',(select count(*) from public.loans where status in ('ACTIVE','RETURN_PENDING') and expected_return_at < now() and lender_received_at is null),
    'total_publications',(select count(*) from public.publications),
    'expired_requests_without_offer',(select count(*) from public.loan_requests r where r.status='EXPIRED' and not exists(select 1 from public.loan_offers o where o.loan_request_id=r.id))
  ) else null end;
$$;

revoke all on function public.assert_active_actor() from public, anon, authenticated;
revoke all on function public.assert_unblocked_interaction() from public, anon, authenticated;
revoke all on function public.assert_chat_can_be_hidden() from public, anon, authenticated;
revoke all on function public.admin_remove_publication(uuid,text) from public;
revoke all on function public.admin_resolve_report(text,uuid,text,text) from public;
revoke all on function public.admin_suspend_user(uuid,text,text,timestamptz) from public;
revoke all on function public.admin_statistics() from public;
grant execute on function public.admin_remove_publication(uuid,text), public.admin_resolve_report(text,uuid,text,text), public.admin_suspend_user(uuid,text,text,timestamptz), public.admin_statistics() to authenticated;

create or replace function public.search_public_profiles(p_query text)
returns table(id uuid, name text, email text, career_id uuid, rating_average numeric, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.career_id, p.rating_average, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and not public.users_blocked_between(auth.uid(), p.id)
    and (p.name ilike '%' || trim(p_query) || '%' or p.email ilike '%' || trim(p_query) || '%')
  order by p.name
  limit 20;
$$;
create or replace function public.get_public_profile(p_profile_id uuid)
returns table(id uuid, name text, email text, career_id uuid, rating_average numeric, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.career_id, p.rating_average, p.avatar_url
  from public.profiles p
  where auth.uid() is not null and p.id = p_profile_id
    and p.id <> auth.uid() and not public.users_blocked_between(auth.uid(), p.id);
$$;
revoke all on function public.search_public_profiles(text), public.get_public_profile(uuid) from public;
grant execute on function public.search_public_profiles(text), public.get_public_profile(uuid) to authenticated;

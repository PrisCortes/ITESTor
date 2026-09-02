-- ITEStore: ejecuta este archivo después de schema.sql y antes de storage.sql.
alter table public.careers enable row level security; alter table public.meeting_points enable row level security; alter table public.profiles enable row level security; alter table public.publications enable row level security; alter table public.publication_images enable row level security; alter table public.transaction_requests enable row level security; alter table public.transactions enable row level security; alter table public.loan_requests enable row level security; alter table public.loan_offers enable row level security; alter table public.loans enable row level security; alter table public.chats enable row level security; alter table public.messages enable row level security; alter table public.ratings enable row level security; alter table public.internal_notifications enable row level security;

create policy "catalogs readable" on public.careers for select using (true);
create policy "points readable" on public.meeting_points for select using (active = true);
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and email = (select email from public.profiles where id = auth.uid()));

create policy "catalog or owner publications readable" on public.publications for select using (status <> 'COMPLETED' or owner_id = auth.uid());
create policy "owner creates publication" on public.publications for insert to authenticated with check (owner_id = auth.uid());
create policy "owner updates publication" on public.publications for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes publication" on public.publications for delete to authenticated using (owner_id = auth.uid());
create policy "visible publication images readable" on public.publication_images for select using (exists (select 1 from public.publications p where p.id = publication_id and (p.status <> 'COMPLETED' or p.owner_id = auth.uid())));
create policy "owner adds image row" on public.publication_images for insert to authenticated with check (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid()));
create policy "owner updates image row" on public.publication_images for update to authenticated using (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid())) with check (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid()));
create policy "owner removes image row" on public.publication_images for delete to authenticated using (exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = auth.uid()));

create policy "request participants read" on public.transaction_requests for select to authenticated using (auth.uid() in (buyer_id,seller_id));
create policy "buyer creates request" on public.transaction_requests for insert to authenticated with check (buyer_id = auth.uid() and buyer_id <> seller_id and exists (select 1 from public.publications p where p.id = publication_id and p.owner_id = seller_id and p.status = 'AVAILABLE' and p.stock >= quantity));
create policy "participants update request" on public.transaction_requests for update to authenticated using (auth.uid() in (buyer_id,seller_id)) with check (auth.uid() in (buyer_id,seller_id));
create policy "transaction participants read" on public.transactions for select to authenticated using (auth.uid() in (buyer_id,seller_id));
create policy "seller creates transaction" on public.transactions for insert to authenticated with check (seller_id = auth.uid());
create policy "transaction participants update" on public.transactions for update to authenticated using (auth.uid() in (buyer_id,seller_id)) with check (auth.uid() in (buyer_id,seller_id));

create policy "open loans readable" on public.loan_requests for select using (status in ('OPEN','SELECTED','SCHEDULED','ACTIVE') or requester_id = auth.uid());
create policy "requester creates loan request" on public.loan_requests for insert to authenticated with check (requester_id = auth.uid());
create policy "requester updates loan request" on public.loan_requests for update to authenticated using (requester_id = auth.uid()) with check (requester_id = auth.uid());
create policy "loan offers participants read" on public.loan_offers for select to authenticated using (lender_id = auth.uid() or exists (select 1 from public.loan_requests r where r.id = loan_request_id and r.requester_id = auth.uid()));
create policy "lender creates offer" on public.loan_offers for insert to authenticated with check (lender_id = auth.uid() and exists (select 1 from public.loan_requests r where r.id = loan_request_id and r.requester_id <> auth.uid() and r.status = 'OPEN'));
create policy "offer participant update" on public.loan_offers for update to authenticated using (lender_id = auth.uid() or exists (select 1 from public.loan_requests r where r.id = loan_request_id and r.requester_id = auth.uid()));
create policy "loan participants read" on public.loans for select to authenticated using (auth.uid() in (requester_id,lender_id));
create policy "requester creates loan" on public.loans for insert to authenticated with check (requester_id = auth.uid() and requester_id <> lender_id);
create policy "loan participants update" on public.loans for update to authenticated using (auth.uid() in (requester_id,lender_id)) with check (auth.uid() in (requester_id,lender_id));

create policy "chat participants read" on public.chats for select to authenticated using (auth.uid() in (participant_a,participant_b));
create policy "chat participant creates" on public.chats for insert to authenticated with check (auth.uid() in (participant_a,participant_b));
create policy "chat participants update" on public.chats for update to authenticated using (auth.uid() in (participant_a,participant_b));
create policy "chat participants read messages" on public.messages for select to authenticated using (exists (select 1 from public.chats c where c.id = chat_id and auth.uid() in (c.participant_a,c.participant_b)));
create policy "participant sends message" on public.messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.chats c where c.id = chat_id and auth.uid() in (c.participant_a,c.participant_b)));

create policy "ratings participants read" on public.ratings for select to authenticated using (auth.uid() in (rater_id,rated_id));
create policy "participant rates completed transaction" on public.ratings for insert to authenticated with check (rater_id = auth.uid());
create policy "own notifications" on public.internal_notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notification read" on public.internal_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke execute on function public.respond_to_transaction(uuid,boolean) from public;
revoke execute on function public.schedule_transaction(uuid,uuid,timestamptz,text) from public;
revoke execute on function public.confirm_transaction(uuid,text) from public;
revoke execute on function public.cancel_transaction(uuid) from public;
grant execute on function public.respond_to_transaction(uuid,boolean), public.schedule_transaction(uuid,uuid,timestamptz,text), public.confirm_transaction(uuid,text), public.cancel_transaction(uuid) to authenticated;

-- Historial inmutable de acuerdos de encuentro. Cada reprogramación conserva el
-- acuerdo anterior y marca cuál es el vigente; no modifica mensajes existentes.
create table if not exists public.chat_system_events (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  event_type text not null check (event_type in ('TRANSACTION_MEETING','LOAN_DELIVERY_MEETING','LOAN_RETURN_MEETING')),
  details jsonb not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);
create index if not exists chat_system_events_chat_idx on public.chat_system_events(chat_id, created_at);
alter table public.chat_system_events enable row level security;
create policy "chat participants read system events" on public.chat_system_events for select to authenticated using (
  exists (select 1 from public.chats c where c.id = chat_id and auth.uid() in (c.participant_a,c.participant_b))
);

create or replace function public.record_transaction_meeting_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_chat_id uuid; point_name text;
begin
  if new.meeting_at is null or new.meeting_at is not distinct from old.meeting_at then return new; end if;
  select c.id into v_chat_id from public.chats c where c.transaction_request_id = new.request_id;
  select name into point_name from public.meeting_points where id = new.meeting_point_id;
  if v_chat_id is not null then
    update public.chat_system_events set superseded_at=now() where chat_id=v_chat_id and event_type='TRANSACTION_MEETING' and superseded_at is null;
    insert into public.chat_system_events(chat_id,event_type,details) values(v_chat_id,'TRANSACTION_MEETING',jsonb_build_object('point',coalesce(point_name,'Punto por definir'),'at',new.meeting_at,'payment_method',new.payment_method));
  end if;
  return new;
end;
$$;
create or replace function public.record_loan_meeting_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_chat_id uuid; point_name text;
begin
  select c.id into v_chat_id from public.chats c where c.loan_request_id = new.loan_request_id and auth.uid() in (c.participant_a,c.participant_b) limit 1;
  if v_chat_id is null then return new; end if;
  if new.meeting_at is not null and new.meeting_at is distinct from old.meeting_at then
    select name into point_name from public.meeting_points where id = new.meeting_point_id;
    update public.chat_system_events set superseded_at=now() where chat_id=v_chat_id and event_type='LOAN_DELIVERY_MEETING' and superseded_at is null;
    insert into public.chat_system_events(chat_id,event_type,details) values(v_chat_id,'LOAN_DELIVERY_MEETING',jsonb_build_object('point',coalesce(point_name,'Punto por definir'),'at',new.meeting_at));
  end if;
  if new.return_meeting_at is not null and new.return_meeting_at is distinct from old.return_meeting_at then
    select name into point_name from public.meeting_points where id = new.return_meeting_point_id;
    update public.chat_system_events set superseded_at=now() where chat_id=v_chat_id and event_type='LOAN_RETURN_MEETING' and superseded_at is null;
    insert into public.chat_system_events(chat_id,event_type,details) values(v_chat_id,'LOAN_RETURN_MEETING',jsonb_build_object('point',coalesce(point_name,'Punto por definir'),'at',new.return_meeting_at));
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_record_meeting_event on public.transactions;
create trigger transactions_record_meeting_event after update on public.transactions for each row execute function public.record_transaction_meeting_event();
drop trigger if exists loans_record_meeting_event on public.loans;
create trigger loans_record_meeting_event after update on public.loans for each row execute function public.record_loan_meeting_event();

-- Bloquear incluye una denuncia persistente para el módulo administrativo.
create or replace function public.report_blocked_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_reports(reported_user_id,reporter_id,reason)
  values(new.blocked_id,new.blocker_id,new.reason)
  on conflict (reported_user_id,reporter_id) do nothing;
  return new;
end;
$$;
drop trigger if exists user_blocks_create_report on public.user_blocks;
create trigger user_blocks_create_report after insert on public.user_blocks for each row execute function public.report_blocked_user();

revoke all on function public.record_transaction_meeting_event() from public, anon, authenticated;
revoke all on function public.record_loan_meeting_event() from public, anon, authenticated;
revoke all on function public.report_blocked_user() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_system_events') then
    alter publication supabase_realtime add table public.chat_system_events;
  end if;
end $$;

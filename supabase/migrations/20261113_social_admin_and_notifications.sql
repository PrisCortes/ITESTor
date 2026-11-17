-- Extensiones no destructivas para perfiles, favoritos, seguridad social y administración.
alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_url text;

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, publication_id)
);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 2 and 1000),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.publication_reports (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 2 and 1000),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','DISMISSED')),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution text check (char_length(resolution) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (publication_id, reporter_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reported_user_id uuid not null references public.profiles(id) on delete restrict,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 2 and 1000),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','DISMISSED')),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution text check (char_length(resolution) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reported_user_id, reporter_id),
  check (reported_user_id <> reporter_id)
);

create table if not exists public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('ADMIN')),
  granted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.user_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 2 and 1000),
  kind text not null check (kind in ('TEMPORARY','PERMANENT')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  lifted_at timestamptz,
  check ((kind = 'PERMANENT' and ends_at is null) or (kind = 'TEMPORARY' and ends_at is not null and ends_at > starts_at))
);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (char_length(trim(action_type)) between 2 and 80),
  target_type text not null check (char_length(trim(target_type)) between 2 and 80),
  target_id uuid,
  reason text check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_hidden_users (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, recipient_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists favorites_user_idx on public.favorites(user_id, created_at desc);
create index if not exists blocks_pair_idx on public.user_blocks(blocker_id, blocked_id);
create index if not exists chat_hidden_user_idx on public.chat_hidden_users(user_id, hidden_at desc);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id) where revoked_at is null;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'ADMIN');
$$;
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (
    select 1 from public.user_suspensions
    where user_id = auth.uid() and lifted_at is null and starts_at <= now()
      and (kind = 'PERMANENT' or ends_at > now())
  );
$$;
create or replace function public.users_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create or replace function public.create_message_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid;
begin
  select case when participant_a = new.sender_id then participant_b else participant_a end into recipient from public.chats where id = new.chat_id;
  if recipient is not null then insert into public.message_receipts(message_id, recipient_id) values(new.id, recipient) on conflict do nothing; end if;
  return new;
end;
$$;
drop trigger if exists messages_create_receipt on public.messages;
create trigger messages_create_receipt after insert on public.messages for each row execute function public.create_message_receipt();

create or replace function public.mark_chat_messages_seen(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.chats where id = p_chat_id and auth.uid() in (participant_a, participant_b)) then raise exception 'No eres participante de este chat'; end if;
  update public.message_receipts set delivered_at = coalesce(delivered_at, now()), read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and message_id in (select id from public.messages where chat_id = p_chat_id);
end;
$$;

alter table public.favorites enable row level security;
alter table public.user_blocks enable row level security;
alter table public.publication_reports enable row level security;
alter table public.user_reports enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_suspensions enable row level security;
alter table public.admin_actions enable row level security;
alter table public.chat_hidden_users enable row level security;
alter table public.message_receipts enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own favorites" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active_user());
create policy "own blocks" on public.user_blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid() and public.is_active_user());
create policy "reporter reads own publication reports" on public.publication_reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "active user reports publication" on public.publication_reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_active_user());
create policy "admin updates publication reports" on public.publication_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reporter reads own user reports" on public.user_reports for select to authenticated using (reporter_id = auth.uid() or public.is_admin());
create policy "active user reports user" on public.user_reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_active_user());
create policy "admin updates user reports" on public.user_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin reads roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin reads suspensions" on public.user_suspensions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin manages suspensions" on public.user_suspensions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin reads audit" on public.admin_actions for select to authenticated using (public.is_admin());
create policy "admin writes audit" on public.admin_actions for insert to authenticated with check (public.is_admin());
create policy "own chat visibility" on public.chat_hidden_users for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "receipt participants read" on public.message_receipts for select to authenticated using (recipient_id = auth.uid() or exists(select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid()));
create policy "recipient updates receipt" on public.message_receipts for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.users_blocked_between(uuid,uuid) from public, anon, authenticated;
revoke all on function public.create_message_receipt() from public, anon, authenticated;
revoke all on function public.mark_chat_messages_seen(uuid) from public;
grant execute on function public.mark_chat_messages_seen(uuid) to authenticated;

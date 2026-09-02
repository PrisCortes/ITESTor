-- ITEStore: ejecuta este archivo primero en el SQL Editor de Supabase.
-- Las cuentas se crean exclusivamente mediante Supabase Auth, nunca aquí.
create extension if not exists pgcrypto;

create type public.publication_status as enum ('AVAILABLE','PENDING','COMPLETED');
create type public.operation_type as enum ('SALE','EXCHANGE');
create type public.physical_condition as enum ('NEW','USED');
create type public.request_status as enum ('PENDING','ACCEPTED','REJECTED','CANCELLED','COMPLETED');
create type public.transaction_status as enum ('PENDING','SCHEDULED','DELIVERED','RECEIVED','COMPLETED','CANCELLED');
create type public.loan_request_status as enum ('OPEN','EXPIRED','SELECTED','SCHEDULED','ACTIVE','RETURN_PENDING','RETURNED','CANCELLED','CLOSED');
create type public.loan_offer_status as enum ('PENDING','SELECTED','ACCEPTED','REJECTED','WITHDRAWN','CANCELLED');

create table public.careers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.meeting_points (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  email text not null unique check (email ~* '^[^@[:space:]]+@itesa\\.edu\\.mx$'),
  career_id uuid references public.careers(id) on delete restrict,
  rating_average numeric(3,2) not null default 0 check (rating_average between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vista pública limitada: permite mostrar vendedor y calificación sin exponer correos.
create view public.public_profile_summaries as
  select id, name, career_id, rating_average from public.profiles;
grant select on public.public_profile_summaries to anon, authenticated;

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  career_id uuid not null references public.careers(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text not null check (char_length(trim(description)) between 10 and 1000),
  condition public.physical_condition not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  operation_type public.operation_type not null,
  stock integer not null default 1 check (stock >= 0),
  status public.publication_status not null default 'AVAILABLE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((operation_type = 'EXCHANGE') or price > 0),
  check ((status <> 'COMPLETED') or completed_at is not null)
);
create index publications_catalog_idx on public.publications(status, career_id, operation_type, created_at desc);
create index publications_owner_idx on public.publications(owner_id, created_at desc);

create table public.publication_images (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  position smallint not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  unique(publication_id, position)
);

create table public.transaction_requests (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  kind public.operation_type not null,
  note text check (char_length(note) <= 1000),
  status public.request_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index transaction_requests_participants_idx on public.transaction_requests(buyer_id, seller_id, status);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.transaction_requests(id) on delete restrict,
  publication_id uuid not null references public.publications(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status public.transaction_status not null default 'PENDING',
  meeting_point_id uuid references public.meeting_points(id) on delete restrict,
  meeting_at timestamptz,
  payment_method text check (payment_method in ('CASH','TRANSFER','OTHER')),
  delivered_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index transactions_participants_idx on public.transactions(buyer_id, seller_id, status);

create table public.loan_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  career_id uuid not null references public.careers(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 3 and 100),
  description text not null check (char_length(trim(description)) between 10 and 1000),
  quantity integer not null check (quantity > 0),
  deadline timestamptz not null check (deadline > created_at),
  use_duration text not null check (char_length(trim(use_duration)) between 2 and 100),
  estimated_return timestamptz not null,
  status public.loan_request_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (estimated_return > deadline)
);
create index loan_requests_catalog_idx on public.loan_requests(status, deadline, career_id);

create table public.loan_offers (
  id uuid primary key default gen_random_uuid(),
  loan_request_id uuid not null references public.loan_requests(id) on delete cascade,
  lender_id uuid not null references public.profiles(id) on delete restrict,
  note text check (char_length(note) <= 1000),
  status public.loan_offer_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(loan_request_id, lender_id)
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  loan_request_id uuid not null unique references public.loan_requests(id) on delete restrict,
  loan_offer_id uuid not null unique references public.loan_offers(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  lender_id uuid not null references public.profiles(id) on delete restrict,
  status public.loan_request_status not null default 'SELECTED' check (status in ('SELECTED','SCHEDULED','ACTIVE','RETURN_PENDING','RETURNED','CANCELLED','CLOSED')),
  meeting_point_id uuid references public.meeting_points(id) on delete restrict,
  meeting_at timestamptz,
  return_meeting_point_id uuid references public.meeting_points(id) on delete restrict,
  return_meeting_at timestamptz,
  expected_return_at timestamptz not null,
  lender_delivered_at timestamptz,
  requester_received_at timestamptz,
  requester_returned_at timestamptz,
  lender_received_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> lender_id)
);
create index loans_participants_idx on public.loans(requester_id, lender_id, status);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  transaction_request_id uuid unique references public.transaction_requests(id) on delete cascade,
  loan_request_id uuid references public.loan_requests(id) on delete cascade,
  participant_a uuid not null references public.profiles(id) on delete restrict,
  participant_b uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (participant_a <> participant_b),
  check ((transaction_request_id is not null)::integer + (loan_request_id is not null)::integer = 1)
);
create index chats_participants_idx on public.chats(participant_a, participant_b, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (char_length(trim(content)) between 1 and 1500),
  created_at timestamptz not null default now()
);
create index messages_chat_time_idx on public.messages(chat_id, created_at);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete restrict,
  rated_id uuid not null references public.profiles(id) on delete restrict,
  score smallint not null check (score between 1 and 5),
  review text check (char_length(review) <= 1000),
  created_at timestamptz not null default now(),
  unique(transaction_id, rater_id),
  check (rater_id <> rated_id)
);

create table public.internal_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (char_length(type) between 2 and 60),
  title text not null check (char_length(title) between 2 and 160),
  body text not null check (char_length(body) <= 1000),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.internal_notifications(user_id, read_at, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger publications_updated before update on public.publications for each row execute function public.set_updated_at();
create trigger requests_updated before update on public.transaction_requests for each row execute function public.set_updated_at();
create trigger transactions_updated before update on public.transactions for each row execute function public.set_updated_at();
create trigger loan_requests_updated before update on public.loan_requests for each row execute function public.set_updated_at();
create trigger loan_offers_updated before update on public.loan_offers for each row execute function public.set_updated_at();
create trigger loans_updated before update on public.loans for each row execute function public.set_updated_at();
create trigger chats_updated before update on public.chats for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email !~* '^[^@[:space:]]+@itesa\\.edu\\.mx$' then raise exception 'Solo se permite correo institucional @itesa.edu.mx'; end if;
  insert into public.profiles (id, name, email, career_id)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)), lower(new.email), nullif(new.raw_user_meta_data->>'career_id','')::uuid);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.limit_publication_images() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.publication_images where publication_id = new.publication_id) >= 4 then raise exception 'Una publicación permite máximo cuatro imágenes'; end if;
  if not exists (select 1 from public.publications where id = new.publication_id and owner_id = auth.uid()) then raise exception 'Solo el propietario puede añadir imágenes'; end if;
  return new;
end; $$;
create trigger publication_image_limit before insert on public.publication_images for each row execute function public.limit_publication_images();

create or replace function public.validate_message_sender() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.chats where id = new.chat_id and auth.uid() in (participant_a, participant_b)) then raise exception 'No eres participante de este chat'; end if;
  if new.sender_id <> auth.uid() then raise exception 'El emisor debe ser el usuario autenticado'; end if;
  return new;
end; $$;
create trigger message_sender_guard before insert on public.messages for each row execute function public.validate_message_sender();

create or replace function public.validate_rating() returns trigger language plpgsql as $$
declare tx public.transactions;
begin
  select * into tx from public.transactions where id = new.transaction_id;
  if tx.status <> 'COMPLETED' then raise exception 'Solo se puede calificar una transacción concluida'; end if;
  if new.rater_id <> auth.uid() or new.rater_id not in (tx.buyer_id,tx.seller_id) or new.rated_id not in (tx.buyer_id,tx.seller_id) or new.rater_id = new.rated_id then raise exception 'Calificación no autorizada'; end if;
  return new;
end; $$;
create trigger rating_guard before insert on public.ratings for each row execute function public.validate_rating();

create or replace function public.refresh_rating_average() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.profiles set rating_average = coalesce((select round(avg(score)::numeric,2) from public.ratings where rated_id = new.rated_id),0) where id = new.rated_id; return new; end; $$;
create trigger ratings_average after insert on public.ratings for each row execute function public.refresh_rating_average();

-- Operaciones atómicas: el cliente solo pide la transición; estas funciones verifican rol, estado y stock.
create or replace function public.respond_to_transaction(p_request_id uuid, p_accept boolean) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare req public.transaction_requests; pub public.publications; tx public.transactions;
begin
  select * into req from public.transaction_requests where id = p_request_id for update;
  if not found or req.seller_id <> auth.uid() or req.status <> 'PENDING' then raise exception 'Solicitud no disponible para responder'; end if;
  if not p_accept then update public.transaction_requests set status='REJECTED' where id=req.id; return null; end if;
  select * into pub from public.publications where id=req.publication_id for update;
  if pub.status <> 'AVAILABLE' or pub.stock < req.quantity then raise exception 'No hay stock suficiente'; end if;
  update public.transaction_requests set status='ACCEPTED' where id=req.id;
  update public.publications set status='PENDING' where id=pub.id;
  insert into public.transactions(request_id,publication_id,buyer_id,seller_id,quantity) values(req.id,pub.id,req.buyer_id,req.seller_id,req.quantity) returning * into tx;
  return tx;
end; $$;

create or replace function public.schedule_transaction(p_transaction_id uuid, p_meeting_point_id uuid, p_meeting_at timestamptz, p_payment_method text) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare tx public.transactions;
begin select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or auth.uid() not in (tx.buyer_id,tx.seller_id) or tx.status not in ('PENDING','SCHEDULED') then raise exception 'No puedes programar esta operación'; end if;
  if p_meeting_at <= now() or not exists(select 1 from public.meeting_points where id=p_meeting_point_id and active) then raise exception 'Datos de encuentro no válidos'; end if;
  update public.transactions set meeting_point_id=p_meeting_point_id, meeting_at=p_meeting_at, payment_method=p_payment_method, status='SCHEDULED' where id=tx.id returning * into tx; return tx;
end; $$;

create or replace function public.confirm_transaction(p_transaction_id uuid, p_action text) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare tx public.transactions; pub public.publications;
begin select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or tx.status not in ('SCHEDULED','DELIVERED','RECEIVED') then raise exception 'La operación no está lista para confirmar'; end if;
  if p_action='DELIVERY' and tx.seller_id=auth.uid() then update public.transactions set delivered_at=now(),status=case when received_at is not null then 'COMPLETED' else 'DELIVERED' end where id=tx.id returning * into tx;
  elsif p_action='RECEPTION' and tx.buyer_id=auth.uid() then update public.transactions set received_at=now(),status=case when delivered_at is not null then 'COMPLETED' else 'RECEIVED' end where id=tx.id returning * into tx;
  else raise exception 'Confirmación no autorizada'; end if;
  if tx.status='COMPLETED' then select * into pub from public.publications where id=tx.publication_id for update; update public.publications set stock=pub.stock-tx.quantity,status=case when pub.stock-tx.quantity=0 then 'COMPLETED' else 'AVAILABLE' end,completed_at=case when pub.stock-tx.quantity=0 then now() else null end where id=pub.id; update public.transaction_requests set status='COMPLETED' where id=tx.request_id; update public.transactions set completed_at=now() where id=tx.id returning * into tx; end if;
  return tx;
end; $$;

create or replace function public.cancel_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tx public.transactions;
begin select * into tx from public.transactions where id=p_transaction_id for update;
  if not found or auth.uid() not in (tx.buyer_id,tx.seller_id) or tx.status in ('COMPLETED','CANCELLED') then raise exception 'No puedes cancelar esta operación'; end if;
  update public.transactions set status='CANCELLED',cancelled_at=now() where id=tx.id; update public.transaction_requests set status='CANCELLED' where id=tx.request_id; update public.publications set status='AVAILABLE' where id=tx.publication_id and stock>0;
end; $$;

-- Habilita el canal de mensajes en Database > Replication > supabase_realtime si no aparece automáticamente.
alter publication supabase_realtime add table public.messages;

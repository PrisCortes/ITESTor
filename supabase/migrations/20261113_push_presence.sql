-- Presencia efímera en servidor: permite no enviar push cuando el destinatario
-- está realmente dentro de la conversación. No conserva contenido de mensajes.
create table if not exists public.active_chat_sessions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);
create index if not exists active_chat_sessions_expiry_idx on public.active_chat_sessions(chat_id, expires_at);

create table if not exists public.push_dispatches (
  message_id uuid primary key references public.messages(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  skipped_active_at timestamptz
);

alter table public.active_chat_sessions enable row level security;
alter table public.push_dispatches enable row level security;
create policy "own active chat session" on public.active_chat_sessions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "recipient reads own push dispatches" on public.push_dispatches for select to authenticated using (recipient_id = auth.uid());

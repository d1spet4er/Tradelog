create table if not exists public.trade_journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_key text not null,
  entry_reason text not null default '',
  exit_reason text not null default '',
  notes text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trade_key)
);

create index if not exists trade_journal_entries_user_id_idx
  on public.trade_journal_entries (user_id);

alter table public.trade_journal_entries enable row level security;

create policy "Users can read their own trade journal entries"
  on public.trade_journal_entries
  for select
  using (auth.uid() = user_id);

create policy "Users can create their own trade journal entries"
  on public.trade_journal_entries
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own trade journal entries"
  on public.trade_journal_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own trade journal entries"
  on public.trade_journal_entries
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_trade_journal_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trade_journal_entries_updated_at on public.trade_journal_entries;

create trigger trade_journal_entries_updated_at
before update on public.trade_journal_entries
for each row execute function public.set_trade_journal_updated_at();

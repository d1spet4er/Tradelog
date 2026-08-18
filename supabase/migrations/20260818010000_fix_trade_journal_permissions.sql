-- The journal table is protected by RLS, but the authenticated role
-- still needs table-level privileges to reach the RLS policies.
grant select, insert, update, delete on public.trade_journal_entries to authenticated;

grant usage on schema public to authenticated;

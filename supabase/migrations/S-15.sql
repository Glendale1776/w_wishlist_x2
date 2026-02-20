-- S-15: group-funding shortfall controls (idempotent)

alter table public.items
  add column if not exists funding_deadline_at timestamptz null,
  add column if not exists shortfall_policy text not null default 'owner_decides';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'items_shortfall_policy_check'
  ) then
    alter table public.items
      add constraint items_shortfall_policy_check
      check (shortfall_policy in ('owner_decides', 'auto_extend_7d', 'auto_archive'));
  end if;
end $$;

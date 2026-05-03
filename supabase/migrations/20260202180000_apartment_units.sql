-- Apartment units: admin-controlled availability for EOI preferred-unit selection.
-- Apply in Supabase SQL editor or via supabase db push (if linked).

create table if not exists public.apartment_units (
  id text primary key,
  label text not null,
  available boolean not null default true,
  notes text null,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

drop trigger if exists apartment_units_set_updated_at on public.apartment_units;
create trigger apartment_units_set_updated_at
before update on public.apartment_units
for each row execute function public.set_updated_at();

insert into public.apartment_units (id, label, available, sort_order)
values
  ('1', 'Left wing ground floor', true, 10),
  ('2', 'Left wing ground floor', true, 20),
  ('3', 'Bitcoin', true, 30),
  ('4', 'Celo', true, 40),
  ('5', 'Adaverse', true, 50),
  ('6', 'Kinesis', true, 60),
  ('7', 'Ethereum', true, 70),
  ('8', 'Solana', true, 80),
  ('9', 'Inspiration room', true, 90),
  ('10', 'Bungalow Self-Con', true, 100),
  ('11', '2 Bedroom Flat (left)', true, 110),
  ('12', '2 Bedroom Flat (right)', true, 120)
on conflict (id) do nothing;

alter table public.apartment_units enable row level security;

drop policy if exists "apartment_units_select_auth" on public.apartment_units;
create policy "apartment_units_select_auth"
on public.apartment_units
for select
to authenticated
using (true);

drop policy if exists "apartment_units_insert_auth" on public.apartment_units;
create policy "apartment_units_insert_auth"
on public.apartment_units
for insert
to authenticated
with check (true);

drop policy if exists "apartment_units_update_auth" on public.apartment_units;
create policy "apartment_units_update_auth"
on public.apartment_units
for update
to authenticated
using (true)
with check (true);

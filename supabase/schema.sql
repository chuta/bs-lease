-- BlockSpace EOI Leasing App (Supabase schema + RLS)
-- Paste into Supabase SQL editor for project: crbbkgwpnhyqefgbbupp

-- 1) pricing_config (single row)
create table if not exists public.pricing_config (
  id uuid primary key default gen_random_uuid(),
  currency text not null default 'NGN',
  base_rent_kobo bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Ensure only one row is used (optional convention):
-- We'll keep multiple rows possible but the app will read the most-recent updated row.

-- 2) line_items
create table if not exists public.line_items (
  id text primary key,
  label text not null,
  description text null,
  price_kobo bigint not null default 0,
  default_checked boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

-- 2b) lease_duration_tiers (duration-based pricing multipliers)
-- Multipliers are in basis points (10000 = 1.00x)
create table if not exists public.lease_duration_tiers (
  months int primary key,
  label text not null,
  multiplier_bps int not null default 10000,
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  constraint lease_duration_months_check check (months > 0),
  constraint lease_duration_multiplier_bps_check check (multiplier_bps >= 0)
);

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_config_set_updated_at on public.pricing_config;
create trigger pricing_config_set_updated_at
before update on public.pricing_config
for each row execute function public.set_updated_at();

drop trigger if exists line_items_set_updated_at on public.line_items;
create trigger line_items_set_updated_at
before update on public.line_items
for each row execute function public.set_updated_at();

drop trigger if exists lease_duration_tiers_set_updated_at on public.lease_duration_tiers;
create trigger lease_duration_tiers_set_updated_at
before update on public.lease_duration_tiers
for each row execute function public.set_updated_at();

-- Seed base config if empty
insert into public.pricing_config (currency, base_rent_kobo)
select 'NGN', 0
where not exists (select 1 from public.pricing_config);

-- Seed line items (matches current src/data/lineItems.ts defaults)
insert into public.line_items (id, label, description, price_kobo, default_checked, active, sort_order)
values
  ('furnish_bed_mattress', '6x4 bed & mattress (pre-furnished)', 'Included in the apartment furnishings.', 0, true, true, 10),
  ('furnish_reading_table_chair', 'Reading table & chair (pre-furnished)', 'Included in the apartment furnishings.', 0, true, true, 20),
  ('furnish_sofas', '2 seating room sofas (pre-furnished)', 'Included in the apartment furnishings.', 0, true, true, 30),
  ('furnish_center_rug', 'Center rug (pre-furnished)', 'Included in the apartment furnishings.', 0, true, true, 40),
  ('facility_solar_power', 'Solar power (stable electricity)', null, 0, true, true, 50),
  ('facility_starlink_internet', 'High-speed Starlink Internet', null, 0, true, true, 60),
  ('facility_security', 'Security', null, 0, true, true, 70),
  ('agency_agreement_fee', 'Agency & Agreement Fee', 'Optional fee for agency and agreement processing.', 0, false, true, 80),
  (
    'caution_fee',
    'Caution Fee',
    'Refundable caution deposit if no damage occurs during your occupancy of the facility.',
    0,
    true,
    true,
    90
  )
on conflict (id) do nothing;

-- If you already applied this schema before `caution_fee` existed, run the insert above
-- as a one-off (same values + on conflict do nothing) in the SQL editor to add the row.

-- Seed lease duration tiers (defaults; admin can edit multipliers anytime)
insert into public.lease_duration_tiers (months, label, multiplier_bps, active, sort_order)
values
  (1, '1 month', 14000, true, 10),
  (3, '3 months', 12500, true, 20),
  (6, '6 months', 11250, true, 30),
  (12, '12 months', 10000, true, 40),
  (24, '24 months', 9500, true, 50)
on conflict (months) do nothing;

-- RLS
alter table public.pricing_config enable row level security;
alter table public.line_items enable row level security;
alter table public.lease_duration_tiers enable row level security;

-- Public read (anon + authenticated)
drop policy if exists "pricing_config_read_all" on public.pricing_config;
create policy "pricing_config_read_all"
on public.pricing_config
for select
to anon, authenticated
using (true);

drop policy if exists "line_items_read_all" on public.line_items;
create policy "line_items_read_all"
on public.line_items
for select
to anon, authenticated
using (true);

drop policy if exists "lease_duration_tiers_read_all" on public.lease_duration_tiers;
create policy "lease_duration_tiers_read_all"
on public.lease_duration_tiers
for select
to anon, authenticated
using (true);

-- Authenticated write (assumes only admins have credentials)
drop policy if exists "pricing_config_write_auth" on public.pricing_config;
create policy "pricing_config_write_auth"
on public.pricing_config
for insert
to authenticated
with check (true);

drop policy if exists "pricing_config_update_auth" on public.pricing_config;
create policy "pricing_config_update_auth"
on public.pricing_config
for update
to authenticated
using (true)
with check (true);

drop policy if exists "line_items_write_auth" on public.line_items;
create policy "line_items_write_auth"
on public.line_items
for insert
to authenticated
with check (true);

drop policy if exists "line_items_update_auth" on public.line_items;
create policy "line_items_update_auth"
on public.line_items
for update
to authenticated
using (true)
with check (true);

drop policy if exists "line_items_delete_auth" on public.line_items;
create policy "line_items_delete_auth"
on public.line_items
for delete
to authenticated
using (true);

drop policy if exists "lease_duration_tiers_write_auth" on public.lease_duration_tiers;
create policy "lease_duration_tiers_write_auth"
on public.lease_duration_tiers
for insert
to authenticated
with check (true);

drop policy if exists "lease_duration_tiers_update_auth" on public.lease_duration_tiers;
create policy "lease_duration_tiers_update_auth"
on public.lease_duration_tiers
for update
to authenticated
using (true)
with check (true);

drop policy if exists "lease_duration_tiers_delete_auth" on public.lease_duration_tiers;
create policy "lease_duration_tiers_delete_auth"
on public.lease_duration_tiers
for delete
to authenticated
using (true);

-- 3) EOI submissions (stored for admin dashboard review)
create table if not exists public.eoi_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_id text not null unique,
  created_at timestamptz not null default now(),
  status text not null default 'Pending',

  -- Applicant fields
  full_name text not null,
  date_of_birth date not null,
  gender text not null,
  religion text not null,
  state_of_origin text not null,
  current_address text not null,
  phone_number text not null,
  whatsapp_number text null,
  email text not null,
  occupation text not null,
  industry text not null,
  nin text not null,
  facebook_handle text null,
  x_handle text null,
  instagram_handle text null,
  linkedin_handle text null,

  -- Apartment preference
  preferred_unit text not null,
  move_in_date date null,
  lease_duration_months int not null,

  -- Screening
  convicted_crime boolean not null,
  ongoing_court_case boolean not null,
  staying_alone boolean not null,
  married boolean not null,
  number_of_children int not null,
  drug_addiction boolean not null,

  -- Agent
  estate_agent text not null,

  -- Pricing snapshot
  currency text not null default 'NGN',
  base_rent_kobo bigint not null,
  options_kobo bigint not null,
  total_kobo bigint not null,
  duration_multiplier_bps int null,
  selected_line_items jsonb not null,

  -- Storage object paths
  passport_object_path text not null,
  nin_object_path text not null,
  pdf_object_path text not null,

  constraint eoi_status_check check (status in ('Pending','Processing','Accepted','Rejected')),
  constraint eoi_children_check check (number_of_children >= 0),
  constraint eoi_duration_check check (lease_duration_months > 0),
  constraint eoi_selected_line_items_check check (jsonb_typeof(selected_line_items) = 'array')
);

alter table public.eoi_submissions
  add column if not exists duration_multiplier_bps int null;

alter table public.eoi_submissions alter column facebook_handle drop not null;
alter table public.eoi_submissions alter column x_handle drop not null;
alter table public.eoi_submissions alter column instagram_handle drop not null;
alter table public.eoi_submissions alter column linkedin_handle drop not null;

create index if not exists eoi_submissions_status_idx on public.eoi_submissions(status);
create index if not exists eoi_submissions_created_at_idx on public.eoi_submissions(created_at desc);
create index if not exists eoi_submissions_email_idx on public.eoi_submissions(email);

-- Notes (internal)
create table if not exists public.eoi_notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.eoi_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid null,
  note text not null
);

create index if not exists eoi_notes_submission_idx on public.eoi_notes(submission_id, created_at desc);

-- Storage bucket (private) for uploads + PDFs
-- Note: requires the `storage` schema to exist (default in Supabase).
insert into storage.buckets (id, name, public)
values ('eoi-uploads', 'eoi-uploads', false)
on conflict (id) do nothing;

-- Storage: signed URLs from the admin app use the logged-in user's JWT. Without a SELECT
-- policy on storage.objects, createSignedUrl returns HTTP 400 and submission details break.
drop policy if exists "eoi_uploads_objects_select_authenticated" on storage.objects;
create policy "eoi_uploads_objects_select_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'eoi-uploads');

-- Public listing gallery: anon may create signed URLs only for marketing images (not passport/nin/pdf).
drop policy if exists "eoi_uploads_listing_gallery_select_public" on storage.objects;
create policy "eoi_uploads_listing_gallery_select_public"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'eoi-uploads' and name like 'listing-gallery/%');

-- Admin: upload / replace / delete listing images in the same bucket.
drop policy if exists "eoi_uploads_listing_gallery_insert_auth" on storage.objects;
create policy "eoi_uploads_listing_gallery_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'eoi-uploads' and name like 'listing-gallery/%');

drop policy if exists "eoi_uploads_listing_gallery_update_auth" on storage.objects;
create policy "eoi_uploads_listing_gallery_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'eoi-uploads' and name like 'listing-gallery/%')
with check (bucket_id = 'eoi-uploads' and name like 'listing-gallery/%');

drop policy if exists "eoi_uploads_listing_gallery_delete_auth" on storage.objects;
create policy "eoi_uploads_listing_gallery_delete_auth"
on storage.objects
for delete
to authenticated
using (bucket_id = 'eoi-uploads' and name like 'listing-gallery/%');

-- Marketing photos for the public EOI landing page (paths in eoi-uploads bucket).
create table if not exists public.listing_gallery_images (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  caption text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint listing_gallery_path_prefix check (object_path like 'listing-gallery/%')
);

create index if not exists listing_gallery_images_sort_idx
  on public.listing_gallery_images (sort_order asc, created_at asc);

alter table public.listing_gallery_images enable row level security;

drop policy if exists "listing_gallery_select_public" on public.listing_gallery_images;
create policy "listing_gallery_select_public"
on public.listing_gallery_images
for select
to anon, authenticated
using (true);

drop policy if exists "listing_gallery_insert_auth" on public.listing_gallery_images;
create policy "listing_gallery_insert_auth"
on public.listing_gallery_images
for insert
to authenticated
with check (true);

drop policy if exists "listing_gallery_update_auth" on public.listing_gallery_images;
create policy "listing_gallery_update_auth"
on public.listing_gallery_images
for update
to authenticated
using (true)
with check (true);

drop policy if exists "listing_gallery_delete_auth" on public.listing_gallery_images;
create policy "listing_gallery_delete_auth"
on public.listing_gallery_images
for delete
to authenticated
using (true);

-- RLS for submissions + notes
alter table public.eoi_submissions enable row level security;
alter table public.eoi_notes enable row level security;

-- Disallow client-side insert/delete (Netlify function uses service role).
drop policy if exists "eoi_submissions_select_auth" on public.eoi_submissions;
create policy "eoi_submissions_select_auth"
on public.eoi_submissions
for select
to authenticated
using (true);

drop policy if exists "eoi_submissions_update_auth" on public.eoi_submissions;
create policy "eoi_submissions_update_auth"
on public.eoi_submissions
for update
to authenticated
using (true)
with check (true);

drop policy if exists "eoi_notes_select_auth" on public.eoi_notes;
create policy "eoi_notes_select_auth"
on public.eoi_notes
for select
to authenticated
using (true);

drop policy if exists "eoi_notes_insert_auth" on public.eoi_notes;
create policy "eoi_notes_insert_auth"
on public.eoi_notes
for insert
to authenticated
with check (true);


-- =====================================================================
-- Dix Balles : schéma de la base Supabase
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Ensuite : seed.sql (les plans de départ), puis team.sql (l'équipe).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Équipe : les e-mails autorisés à valider et modifier les plans
-- ---------------------------------------------------------------------
create table if not exists public.team (
  email text primary key check (email = lower(email))
);
alter table public.team enable row level security;
-- Aucune règle d'accès : la liste n'est lisible par personne depuis le site.

create or replace function public.is_team()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_team() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Les bons plans
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id          text primary key default ('c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  name        text not null check (char_length(name) between 1 and 80),
  cat         text not null check (cat in ('food','culture','vue','balade','soiree','cine','autre')),
  sub         text check (sub in ('resto','snack','sucre')),
  veg         text check (veg in ('option','full')),
  veg_note    text not null default '' check (char_length(veg_note) <= 120),
  price       numeric(5,2) not null check (price >= 0 and price <= 10),
  deal        text not null check (char_length(deal) between 1 and 240),
  cond        text not null default '' check (char_length(cond) <= 300),
  address     text not null default '' check (char_length(address) <= 160),
  city        text not null check (char_length(city) between 1 and 60),
  postcode    text check (char_length(postcode) <= 10),
  arr         smallint check (arr between 1 and 20),
  lat         double precision check (lat between -90 and 90),
  lng         double precision check (lng between -180 and 180),
  place_id    text check (char_length(place_id) <= 200),
  fiche_link  text check (fiche_link is null or (fiche_link ~ '^https?://' and char_length(fiche_link) <= 600)),
  proof_link  text check (proof_link is null or (proof_link ~ '^https?://' and char_length(proof_link) <= 500)),
  proof_photo text check (char_length(proof_photo) <= 200),
  src_label   text,
  src_url     text,
  src_date    text,
  recheck     boolean not null default false,
  status      text not null default 'pending' check (status in ('pending','published','hidden')),
  origin      text not null default 'community' check (origin in ('seed','community')),
  verified    boolean not null default false,
  device      text,  -- utilisé seulement pour limiter les abus, toujours vidé à l'enregistrement
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  hidden_at   timestamptz
);
create index if not exists plans_status_idx on public.plans (status);
create index if not exists plans_city_idx on public.plans (city);

alter table public.plans enable row level security;

drop policy if exists "plans: lecture publique" on public.plans;
create policy "plans: lecture publique" on public.plans
  for select to anon, authenticated
  using (status = 'published' or public.is_team());

drop policy if exists "plans: proposition anonyme" on public.plans;
create policy "plans: proposition anonyme" on public.plans
  for insert to anon, authenticated
  with check (
    public.is_team() or (
      status = 'pending' and origin = 'community' and verified = false and recheck = false
      and checked_at is null and edited_at is null and hidden_at is null
      and src_label is null and src_url is null and src_date is null
    )
  );

drop policy if exists "plans: modification équipe" on public.plans;
create policy "plans: modification équipe" on public.plans
  for update to authenticated
  using (public.is_team()) with check (public.is_team());

drop policy if exists "plans: suppression équipe" on public.plans;
create policy "plans: suppression équipe" on public.plans
  for delete to authenticated
  using (public.is_team());

-- Journal anonyme des envois, pour limiter le spam (aucune donnée personnelle)
create table if not exists public.submission_log (
  device     text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists submission_log_idx on public.submission_log (device, kind, created_at);
alter table public.submission_log enable row level security;
-- Aucune règle d'accès : invisible depuis le site.

create or replace function public.limit_submissions()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  d text := coalesce(nullif(new.device, ''), 'inconnu');
  k text := tg_argv[0];
  max_per_day int := tg_argv[1]::int;
  r text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  -- Pas de limite pour l'équipe ni pour les imports lancés depuis l'éditeur SQL
  if r not in ('anon', 'authenticated') or public.is_team() then
    new.device := null;
    return new;
  end if;
  if (select count(*) from public.submission_log
      where device = d and kind = k and created_at > now() - interval '1 day') >= max_per_day then
    raise exception 'Trop d''envois depuis cet appareil aujourd''hui. Réessaie demain.' using errcode = 'P0001';
  end if;
  if k = 'plan' and (select count(*) from public.plans where status = 'pending') >= 500 then
    raise exception 'Trop de plans en attente de validation. Réessaie plus tard.' using errcode = 'P0001';
  end if;
  insert into public.submission_log (device, kind) values (d, k);
  delete from public.submission_log where created_at < now() - interval '7 days';
  new.device := null;
  return new;
end;
$$;

drop trigger if exists plans_limit on public.plans;
create trigger plans_limit before insert on public.plans
  for each row execute function public.limit_submissions('plan', '10');

-- ---------------------------------------------------------------------
-- Notes (étoiles) : une par appareil et par plan, sans compte
-- ---------------------------------------------------------------------
create table if not exists public.ratings (
  plan_id    text not null references public.plans(id) on delete cascade,
  device     text not null check (char_length(device) between 8 and 64),
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (plan_id, device)
);
alter table public.ratings enable row level security;
-- Aucune règle d'accès directe : on passe par les deux fonctions ci-dessous.

create or replace function public.rate_plan(p_plan text, p_device text, p_stars int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_stars < 1 or p_stars > 5 or char_length(coalesce(p_device, '')) not between 8 and 64 then
    raise exception 'Note invalide.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and status = 'published') then
    raise exception 'Plan introuvable.' using errcode = 'P0001';
  end if;
  insert into public.ratings (plan_id, device, stars) values (p_plan, p_device, p_stars)
  on conflict (plan_id, device) do update set stars = excluded.stars, updated_at = now();
end;
$$;
grant execute on function public.rate_plan(text, text, int) to anon, authenticated;

create or replace function public.plan_ratings()
returns table (plan_id text, avg numeric, n int)
language sql stable security definer
set search_path = public
as $$
  select r.plan_id, round(avg(r.stars)::numeric, 1), count(*)::int
  from public.ratings r join public.plans p on p.id = r.plan_id
  where p.status = 'published'
  group by r.plan_id;
$$;
grant execute on function public.plan_ratings() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Signalements (prix changé, lieu fermé…)
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  plan_id    text not null references public.plans(id) on delete cascade,
  type       text not null check (type in ('price','closed','other')),
  price      numeric(6,2) check (price >= 0 and price < 1000),
  note       text not null default '' check (char_length(note) <= 200),
  device     text,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

drop policy if exists "reports: envoi anonyme" on public.reports;
create policy "reports: envoi anonyme" on public.reports
  for insert to anon, authenticated
  with check (resolved = false);

drop policy if exists "reports: lecture équipe" on public.reports;
create policy "reports: lecture équipe" on public.reports
  for select to authenticated using (public.is_team());

drop policy if exists "reports: traitement équipe" on public.reports;
create policy "reports: traitement équipe" on public.reports
  for update to authenticated using (public.is_team()) with check (public.is_team());

drop policy if exists "reports: suppression équipe" on public.reports;
create policy "reports: suppression équipe" on public.reports
  for delete to authenticated using (public.is_team());

drop trigger if exists reports_limit on public.reports;
create trigger reports_limit before insert on public.reports
  for each row execute function public.limit_submissions('report', '20');

-- ---------------------------------------------------------------------
-- Photos de preuve : privées, visibles seulement par l'équipe
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preuves', 'preuves', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "preuves: dépôt anonyme" on storage.objects;
create policy "preuves: dépôt anonyme" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'preuves');

drop policy if exists "preuves: lecture équipe" on storage.objects;
create policy "preuves: lecture équipe" on storage.objects
  for select to authenticated
  using (bucket_id = 'preuves' and public.is_team());

drop policy if exists "preuves: suppression équipe" on storage.objects;
create policy "preuves: suppression équipe" on storage.objects
  for delete to authenticated
  using (bucket_id = 'preuves' and public.is_team());

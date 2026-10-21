-- ============================================================
-- Boy's Duty — Supabase setup
-- Paste this whole file into Supabase → SQL Editor → Run. Once.
-- Members: Boss, Ice, Ikkew, Ong. Owner (controls settings): Ice
-- To change the owner, edit owner_name() below before running.
-- ============================================================

-- One table holds everything (check-ins, votes, payments, profiles…)
create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.docs enable row level security;

-- Who is signed in (username = the part before @ in their login email)
create or replace function public.my_name() returns text language sql stable as $$
  select lower(split_part(coalesce(auth.jwt()->>'email',''),'@',1))
$$;
create or replace function public.is_member() returns boolean language sql stable as $$
  select public.my_name() in ('boss','ice','ikkew','ong')
$$;
create or replace function public.owner_name() returns text language sql immutable as $$
  select 'ice'
$$;
create or replace function public.treasurer_name() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce((select data->>'treasurer' from public.docs where collection='settings' and id='main'),''))
$$;

-- Nobody can edit anyone else's progress
create or replace function public.can_write(c text, i text, d jsonb) returns boolean language sql stable as $$
  select public.is_member() and (
       (c in ('checkins','pauses','photos') and lower(d->>'user') = public.my_name())
    or (c in ('accounts','profiles')        and lower(i)          = public.my_name())
    or (c = 'settings'                      and public.my_name()  = public.owner_name())
    or (c = 'payments' and (lower(d->>'user') = public.my_name() or public.my_name() = public.treasurer_name()))
  )
  -- you can't pre-fill your own approvals
  and (c <> 'checkins' or coalesce(d->'reactions','{}'::jsonb) = '{}'::jsonb)
  and (c <> 'pauses'   or coalesce(d->'votes','{}'::jsonb)     = '{}'::jsonb)
  -- only the treasurer can mark a payment confirmed
  and (c <> 'payments' or public.my_name() = public.treasurer_name() or coalesce(d->>'status','pending') = 'pending')
$$;

drop policy if exists "members read"   on public.docs;
drop policy if exists "members insert" on public.docs;
drop policy if exists "members update" on public.docs;
drop policy if exists "members delete" on public.docs;
create policy "members read"   on public.docs for select to authenticated using (public.is_member());
create policy "members insert" on public.docs for insert to authenticated with check (public.can_write(collection, id, data));
create policy "members update" on public.docs for update to authenticated
  using (case when collection = 'payments' then public.my_name() = public.treasurer_name() else public.can_write(collection, id, data) end)
  with check (case when collection = 'payments' then public.my_name() = public.treasurer_name() else public.can_write(collection, id, data) end);
create policy "members delete" on public.docs for delete to authenticated
  using (collection in ('checkins','pauses','photos') and public.can_write(collection, id, data));

-- Deep merge used for partial updates
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    (select coalesce(jsonb_object_agg(coalesce(ka, kb),
       case when va is null then vb when vb is null then va else public.jsonb_deep_merge(va, vb) end), '{}'::jsonb)
     from jsonb_each(a) e1(ka, va) full join jsonb_each(b) e2(kb, vb) on ka = kb)
  else b end
$$;
create or replace function public.doc_merge(p_col text, p_id text, p_patch jsonb) returns void
language sql security invoker as $$
  update public.docs set data = public.jsonb_deep_merge(data, p_patch), updated_at = now()
  where collection = p_col and id = p_id
$$;

-- Votes: you can only set YOUR vote, and only on someone else's session / excuse
create or replace function public.vote(p_col text, p_id text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_name(); k text;
begin
  if not public.is_member() then raise exception 'not a member'; end if;
  if p_col = 'checkins' then k := 'reactions'; elsif p_col = 'pauses' then k := 'votes'; else raise exception 'bad collection'; end if;
  if p_value is not null and p_value not in ('approve','cap','deny') then raise exception 'bad vote'; end if;
  update public.docs
     set data = jsonb_set(case when data ? k then data else data || jsonb_build_object(k, '{}'::jsonb) end,
                          array[k, initcap(me)], coalesce(to_jsonb(p_value), 'null'::jsonb)),
         updated_at = now()
   where collection = p_col and id = p_id and lower(data->>'user') <> me;
end $$;

grant execute on function public.doc_merge(text,text,jsonb) to authenticated;
grant execute on function public.vote(text,text,text) to authenticated;

-- Live updates on everyone's phones
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- Photo storage (proof photos + transfer slips)
insert into storage.buckets (id, name, public) values ('proofs', 'proofs', true) on conflict (id) do nothing;
drop policy if exists "proofs upload own" on storage.objects;
drop policy if exists "proofs delete own" on storage.objects;
create policy "proofs upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "proofs delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Season settings: Winter Arc 19 Oct – 31 Dec, fees 300 / +500 / +300
insert into public.docs (collection, id, data) values
  ('settings', 'main', '{"start":"2026-10-19","end":"2026-12-31","name":"Winter Arc","fees":{"first":300,"second":500,"after":300},"paid":{},"treasurer":"Ice"}')
on conflict (collection, id) do nothing;

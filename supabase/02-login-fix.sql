-- Fore Man Gym — login fix. Paste into Supabase → SQL Editor → Run. Once.
-- Usernames: Boss, Ice, Ikkew, Ong. Everyone starts with password 0000.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.members (
  name    text primary key,
  pw      text not null,
  changed boolean not null default false
);
create table if not exists public.sessions (
  uid  uuid primary key,
  name text not null references public.members(name) on delete cascade,
  at   timestamptz not null default now()
);
alter table public.members  enable row level security;   -- no policies: only the functions below can touch them
alter table public.sessions enable row level security;

insert into public.members (name, pw) values
  ('boss',  extensions.crypt('0000', extensions.gen_salt('bf'))),
  ('ice',   extensions.crypt('0000', extensions.gen_salt('bf'))),
  ('ikkew', extensions.crypt('0000', extensions.gen_salt('bf'))),
  ('ong',   extensions.crypt('0000', extensions.gen_salt('bf')))
on conflict (name) do nothing;

-- Who is signed in on this phone
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.sessions where uid = auth.uid()), '')
$$;

create or replace function public.login(p_name text, p_pw text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare m public.members%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false); end if;
  select * into m from public.members where name = lower(trim(p_name));
  if not found or m.pw <> crypt(p_pw, m.pw) then return json_build_object('ok', false); end if;
  insert into public.sessions (uid, name) values (auth.uid(), m.name)
    on conflict (uid) do update set name = excluded.name, at = now();
  return json_build_object('ok', true, 'changed', m.changed);
end $$;

create or replace function public.verify_password(p_pw text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select pw = crypt(p_pw, pw) from public.members where name = public.my_name()), false)
$$;

create or replace function public.set_password(p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.my_name() = '' then raise exception 'Sign in first'; end if;
  if length(coalesce(p_new, '')) < 4 then raise exception 'Use at least 4 characters'; end if;
  update public.members set pw = crypt(p_new, gen_salt('bf')), changed = true where name = public.my_name();
end $$;

create or replace function public.reset_member(p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.my_name() <> public.owner_name() then raise exception 'Only the owner can reset logins'; end if;
  update public.members set pw = crypt('0000', gen_salt('bf')), changed = false where name = lower(p_name);
  delete from public.sessions where name = lower(p_name);
end $$;

create or replace function public.logout() returns void
language sql security definer set search_path = public as $$
  delete from public.sessions where uid = auth.uid()
$$;

grant execute on function public.my_name(), public.login(text,text), public.verify_password(text),
  public.set_password(text), public.reset_member(text), public.logout() to authenticated;

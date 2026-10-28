-- Fore Man Gym — add member "Army". Paste into Supabase → SQL Editor → Run. Once.
-- Army logs in with username Army, password 0000.

insert into public.members (name, pw) values
  ('army', extensions.crypt('0000', extensions.gen_salt('bf')))
on conflict (name) do nothing;

create or replace function public.is_member() returns boolean language sql stable as $$
  select public.my_name() in ('boss','ice','ikkew','ong','army')
$$;

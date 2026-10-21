# Fore Man Gym

Private gym-challenge web app for 4 friends: **Boss, Ice, Ikkew, Ong**. Owner: **Ice** (Natarit).
Hosted on Netlify (auto-deploys from this repo, publish dir = repo root, no build step). Data on Supabase.

## Files
- `index.html` — the whole app (HTML + CSS + JS in one file). Mobile-first, iPhone Pro Max tuned.
- `shim.js` — data layer: wraps Supabase (table `docs`, storage bucket `proofs`, RPC login) behind a small `claude.use("db"|"assets"|"user")` API the app uses, plus `window.BD` auth helpers.
- `config.js` — Supabase URL + publishable key, owner name, `ai` flag (false = no AI photo check).
- `logo.png` (in-app, transparent), `icon-*.png` (home-screen icons with frame), `manifest.webmanifest`.
- `supabase/` — SQL already run in the Supabase project (setup + login fix) and the optional AI edge function.

## Rules the app enforces
- Week = Monday–Sunday. Goal: at least 3 weights + 4 cardio (7 sessions). Max 1 weights + 1 cardio per day.
- Cardio counts only with 40+ min and kcal ≥ weight × 333/78 (78 kg → 333 kcal).
- Proof: up to 5 photos per check-in. A session counts when 2 friends approve; 2 caps = rejected;
  after 48h undecided → majority of votes, no votes = approved. Sender can't vote on own session.
- Penalty per week at Sunday close: 1st miss ฿300, 2nd +฿500, each after +฿300. Excused weeks (2 approvals) = no fee.
- Pot: PromptPay QR + slip upload; treasurer confirms. Only owner edits challenge/fees/pot account (also enforced by RLS).
- Login: username = name, default password 0000 (server-checked via `login` RPC on an anonymous Supabase session).

## Style
Matte black + cool aurora (cyan #7FD4E6, ice #A9C7D8, periwinkle #9DA4F2, teal #62C3B0). Fonts: Unbounded (display), Manrope (body), JetBrains Mono (numbers).
Member colors: Boss ice, Ice cyan, Ikkew teal, Ong periwinkle. Keep 44pt tap targets and safe-area padding.

## Workflow
Owner wants every change live right away: after editing, commit and push to `main` (Netlify auto-deploys) as well as the working branch. No zip/manual uploads.

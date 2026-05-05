# Quest Life — Setup Guide

Follow these steps to get Quest Life live on your phone and Lillian's iPad in about 15 minutes. No coding experience needed.

---

## Step 1 — Create a free Supabase account

1. Go to **supabase.com** and click "Start for free"
2. Sign up and create a new project (name it "questlife" or anything you like)
3. Wait ~2 minutes for it to provision
4. Go to **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (a long string starting with `eyJ...`)

---

## Step 2 — Create the database table

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Paste this and click **Run**:

```sql
create table game_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz default now()
);

alter table game_state enable row level security;

create policy "Allow all" on game_state
  for all using (true) with check (true);
```

---

## Step 3 — Create a free Vercel account

1. Go to **vercel.com** and sign up (free)
2. You can sign in with GitHub or just email

---

## Step 4 — Deploy the app

1. Go to **vercel.com/new**
2. Click **"Upload"** (no GitHub needed)
3. Drag and drop the entire **questlife** folder you received
4. Before clicking Deploy, click **"Environment Variables"** and add:
   - `REACT_APP_SUPABASE_URL` → paste your Project URL from Step 1
   - `REACT_APP_SUPABASE_ANON_KEY` → paste your anon key from Step 1
5. Click **Deploy**
6. In about 60 seconds you'll get a live URL like `questlife-mercer.vercel.app`

---

## Step 5 — Add to home screens

### On your iPhone:
1. Open Safari and go to your Vercel URL
2. Tap the **Share** button (box with arrow) at the bottom
3. Scroll down and tap **"Add to Home Screen"**
4. Name it "Quest Life" and tap Add
5. It will appear on your home screen like a real app

### On Lillian's iPad:
1. Same steps — open Safari, go to the same URL
2. Tap Share → Add to Home Screen
3. Both devices will share the same data automatically through Supabase

---

## Optional — Connect Todoist

Once the app is live, tap **"Connect Todoist"** in the top right corner:

1. Go to todoist.com → Settings → Integrations → Developer
2. Copy your API token
3. Paste it into the app and tap Save Token
4. Use **⟳ Todoist** to pull your open tasks into your quest log

---

## Troubleshooting

**App shows "Local only" in the header:** Your Supabase environment variables weren't set correctly. Go to Vercel → your project → Settings → Environment Variables and check them.

**Todoist sync fails:** Double-check your API token. It should be a long string from todoist.com → Settings → Integrations → Developer (not your password).

**Changes on one device don't appear on the other:** Pull down to refresh, or wait a few seconds. The sync is real-time but requires an active internet connection.

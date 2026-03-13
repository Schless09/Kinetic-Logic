# Kinetic Logic

MVP platform for collecting **Vision-Language-Action (VLA)** data for AI training. Captures video and motion sensors (accelerometer + gyroscope) in sync, then uploads to Supabase.

## Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS, Shadcn UI
- **Native:** Capacitor (iOS/Android sensor + camera)
- **Backend:** Supabase (Auth, PostgreSQL, Storage, RLS, Edge policies)
- **Pipeline:** Python (PyTorch, ffmpeg, pandas, httpx) for video+IMU processing and training/eval workers
- **Sensors:** `@capacitor/motion` (50Hz), browser `DeviceMotionEvent` fallback

## Setup

1. **Install & run (web)**

   ```bash
   npm install
   cp .env.example .env.local
   # Edit .env.local with your Supabase URL and anon key
   npm run dev
   ```

2. **Supabase**

   - Create a project at [supabase.com](https://supabase.com).
   - Run the migration: `supabase/migrations/20250311000000_kinetic_logic_schema.sql` (SQL Editor or `supabase db push`).
   - Create a Storage bucket named `vla-assets` and add policies so authenticated users can upload (see comments in the migration file).
   - Enable Email (or other) Auth; after sign-up, ensure a row in `profiles` exists for the user (id = auth.uid(), role/location as needed).

3. **Native (Capacitor) – iOS & Android**

   **One-time setup**
   - **Android:** No extra tools beyond Node. Run `npx cap add android` (already done if you have an `android/` folder).
   - **iOS:** Requires Xcode and [CocoaPods](https://capacitorjs.com/docs/getting-started/environment-setup#homebrew) on your Mac. Then run `npx cap add ios`.

   **Build and run**
   ```bash
   npm run build:mobile    # static export to out/ + cap sync (for bundled native app)
   npm run cap:ios        # open Xcode (build & run on simulator or device)
   npm run cap:android    # open Android Studio (build & run on emulator or device)
   ```
   Camera and motion permissions are added by the Capacitor Camera and Motion plugins.

4. **Python pipeline (optional but recommended)**

From the repo root:

```bash
npm run python:setup    # once: creates python/.venv and installs deps
```

Then you can:

```bash
npm run python:fixture    # optional: create test session in data/raw/
npm run python:process    # process raw sessions → frames + manifest
npm run python:train      # train small BC model
npm run python:evaluate   # evaluate model (MSE + toy rollout)
```

For the background worker that processes uploaded sessions into manifests and records artifacts:

```bash
cd python
cp .env.example .env      # set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
python worker.py
```

5. **Deploy to Vercel**
   - Connect the repo to Vercel. The default `npm run build` runs in **server mode** (no static export), so API routes (e.g. `/api/auth/signup`) work.
   - Set env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Optional: For native apps, you can set `server.url` in `capacitor.config.ts` to your Vercel URL so the app loads from the web instead of a bundled export.

## Data format: Kinetic Trace

VLA payload syncing sensors to video frames:

- **`src/types/kinetic-trace.ts`** – `KineticTrace` interface and helpers.
- Samples: `timestamp_ms`, `video_frame_id`, optional `audio_transcript`, `sensors: { accel, gyro }`.
- Metadata: `device`, `fps`, `sensor_hz`.

## Features

- **Sensor engine** – `src/hooks/useVLASensorEngine.ts`: 50Hz accel/gyro buffered in a ref, timestamps aligned to capture start; works in Capacitor and in browser (with permission).
- **Recording dashboard** – `src/app/capture/page.tsx`: Start/Stop Capture, live camera preview, sensor health, then package and upload. Respects **task hardware requirements** and disables Start if the expert’s hardware profile doesn’t meet them.
- **Auto-upload** – `src/lib/upload-vla.ts`: On Stop, builds JSON trace, uploads video + JSON to `/[organizationId]/[expertId]/[sessionId]/`, updates session and inserts assets in DB. Sets `sessions.status = 'uploaded'` which triggers downstream jobs + review rows.

**Multi-tenant (organizations):** Data is scoped by organization (DB: `organizations` table, `organization_id` on profiles/sessions/tasks). Run migrations in order through `20250318000000_expert_multi_org_membership.sql`. The **profile_organizations** junction table lets one expert belong to multiple orgs; on the capture page they choose **Recording for** (org) then task. New users get their first org at sign-up and a row in `profile_organizations`; platform admins can add more rows to let an expert work for additional orgs.

**Platform admin:** Run these two migrations in order (Postgres requires the new enum value to be committed before use): `20250313000000_platform_admin_enum_only.sql` then `20250313000001_platform_admin_policies.sql`. Users with `role = 'platform_admin'` can see and manage all organizations, profiles, sessions, and assets. Assign in Dashboard: `UPDATE profiles SET role = 'platform_admin' WHERE email = 'you@company.com'`.

## Organizations: invite link vs choose

- **Invite link:** An organization (e.g. “The Data Gym”) gives experts a link: `https://yourapp.com/join/<slug>`. Example: `/join/data-gym` → redirects to sign-up with that organization pre-selected; the form shows “You're joining The Data Gym”. In the DB, add rows to `organizations` and set `slug` (e.g. `data-gym`) for each.
- **Choose organization:** If the user opens `/sign-up` with no `?organization=` in the URL, they see a “Recording for” dropdown **only for orgs with `allow_open_signup = true`** (run `20250315000000_vendor_invite_and_join.sql`). Set `allow_open_signup = true` for orgs that allow open sign-up; leave it false for invite-only.
- Default organization (`slug = 'default'`) is set to open sign-up by the migration so the selector works with one org out of the box.

**Tasks (instructions + bounties + hardware requirements):**

- Run `20250316000000_tasks_and_instructions.sql` to add a `tasks` table (organization_id, name, instructions).
- Run `20250322000000_marketplace_bounties_and_reviews.sql` to add bounty fields and `session_reviews`.
- Run `20250324000000_task_hardware_requirements.sql` to add `required_hardware_tags`, `preferred_hardware_tags`, `bounty_overrides` to tasks and `hardware_tags` to profiles.

Org admins manage tasks in the app at `/org/tasks`: set name, instructions, bounty, caps, required/preferred hardware, and optional tiered bounty overrides. Experts see a **Task** dropdown on the capture page (filtered to tasks they can fulfill with their hardware) and the instructions for the selected task; the session is linked to that task.

**Expert consent (onboarding):** Run `20250319000000_expert_consent.sql` to add `expert_consents` (version, signed_at, recording_country, recording_region, enhanced_data_release, signature_hash) and `sessions.consent_id`. Experts must complete the agreement at `/onboarding` once before recording; each session stores the consent id for data provenance. For Uzbekistan/global: translate the agreement (e.g. Uzbek, Russian) in `src/lib/consent-agreement.ts` or add locale-specific content.

**Marketplace + review:**

- **Session reviews**: run `20250322000000_marketplace_bounties_and_reviews.sql`. Each time a session becomes `uploaded`, a row is created in `session_reviews` with `status = 'pending'`. Org reviewers (admins/annotators) use `/review` to approve/reject and set `payout_cents`.
- **Expert dashboard** (`/dashboard`) shows posted bounty (from `tasks.bounty_cents`) and, once approved, the earned payout from `session_reviews.payout_cents`.

## Step-by-step flows

### Expert (user) flow

1. **Get to the app**  
   Opens `/` (home) or is sent a **join link** by an organization: `https://yourapp.com/join/<slug>` (e.g. `/join/data-gym`).

2. **Sign up or sign in**
   - **Via join link:** Clicks link → redirects to `/sign-up?organization=<slug>`. Form shows “You’re joining [Org Name]” with that org pre-selected. Enters first name, last name, email, optional phone, password → submits. Account is created and tied to that organization.
   - **Direct sign-up:** Goes to `/sign-up`. If the org has open sign-up enabled, sees an **Organization** dropdown and picks one. Otherwise must use a join link. Submits form → account created with chosen `organization_id`.
   - **Sign in:** Goes to `/sign-in`, enters email and password.

3. **Capture**
   - Goes to `/capture` (from home or after auth).
   - Sees **Recording for** (organization) — one or more orgs they belong to; picks which org this capture is for.
   - If that org has **tasks**, sees a **Task** dropdown (e.g. “Change a tire”) and the task’s instructions. Can pick a task or leave “No task selected”.
   - Taps **Start Capture**: app creates a session (expert, chosen organization, optional task), starts camera and motion sensors (50 Hz accel/gyro).
   - Taps **Stop & Upload**: app builds the trace, uploads video + sensor JSON to Storage under `[organizationId]/[expertId]/[sessionId]/`, updates the session to `uploaded`, and inserts asset rows. Expert sees a short confirmation.

4. **Ongoing**  
   Can start more captures (for the same or a different org); each produces a new session and assets. Experts can complete tasks for any org they belong to. Data is visible only to that org (and to admins/annotators in that org).

---

### Organization (vendor) flow

1. **Org exists**  
   An organization row exists in `organizations` (created by migration, e.g. “Default”, or by a platform admin). It has a `slug` (e.g. `data-gym`) and optionally `allow_open_signup`.

2. **Invite experts**
   - **Invite-only:** Set `allow_open_signup = false`. Share the join link: `https://yourapp.com/join/<slug>`. New users must use this link; they can’t pick the org on the open sign-up page.
   - **Open sign-up:** Set `allow_open_signup = true`. The org appears in the **Organization** dropdown on `/sign-up` for users who land there without a join link.

3. **Define tasks (for experts)**  
   Someone with **admin** (or platform_admin) in that org adds rows to the `tasks` table (e.g. in Supabase Table Editor or a future admin UI): `organization_id`, `name`, `instructions`. Experts in that org then see these tasks on the capture page and can attach a task to each session.

4. **Who can do what**
   - **Experts** can belong to multiple orgs (`profile_organizations`). On capture they choose which org they’re recording for; they see tasks only for that org. Data is scoped by the chosen org.
   - **Admins / annotators** in an org: RLS lets them read (and where policy allows, manage) that org’s profiles, sessions, and assets. Tasks insert/update/delete require `admin` or `platform_admin`.
   - **Platform admins:** Can see and manage all organizations, profiles, sessions, and assets. They can add an expert to more orgs by inserting rows into `profile_organizations` (e.g. `INSERT INTO profile_organizations (profile_id, organization_id) VALUES ('user-uuid', 'org-uuid')`).

---

## Routes

- `/` – Home with links to capture, task board, review, etc.
- `/sign-up`, `/sign-in` – Auth. Sign-in supports `?redirect=` (e.g. `/sign-in?redirect=/onboarding`).
- `/join/[slug]` – Invite link; redirects to sign-up with organization pre-selected.
- `/onboarding` – **Expert Data Contribution & Release Agreement**. Required once before recording: recording location (country, optional city/region), consent text, optional Enhanced Data Release, and signature. Signature is hashed and stored; each session is linked to the consent in effect for data provenance.
- `/settings/hardware` – Experts declare what capture hardware they have (phone, laptop webcam, smart glasses, depth camera, VR/AR headset).
- `/tasks` – Task board: browse active tasks and bounties per org, filtered by required hardware. “Record this task” pre-selects org + task in capture.
- `/org/tasks` – Org admin task management: create/edit tasks (instructions, bounty, hardware requirements).
- `/capture` – Recording dashboard (requires sign-in and completed onboarding). Expert chooses **Recording for** (org) and **Task**; hardware compatibility is enforced before starting capture.
- `/dashboard` – My recordings: shows task, org, time, bounty, review status, and earned payout (no raw video/sensor data).
- `/review` – Org reviewers approve/reject uploaded sessions and set payout per approved session.
- `/ops` – Internal pipeline ops: recent `ml_jobs` + `ml_artifacts` per org.

## Scripts

- `npm run dev` – Next.js dev server
- `npm run build` – Production build (server mode for Vercel; API routes work)
- `npm run build:mobile` – Static export to `out/` then `cap sync` (for native iOS/Android bundle)
- `npm run cap:ios` / `npm run cap:android` – Open native project in Xcode / Android Studio
- `npx cap sync` – Copy web assets into native projects
- `npm run python:setup` – Create Python venv and install pipeline dependencies
- `npm run python:fixture` – Create a synthetic recording in `data/raw/` for pipeline testing
- `npm run python:process` / `python:train` / `python:evaluate` – Run pipeline stages locally

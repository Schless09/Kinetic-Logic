# Kinetic Logic — Stakeholder Overview

**One-pager:** What the product is, who uses it, what’s built, and how the full loop works.

---

## What It Is

**Kinetic Logic** is an MVP platform for collecting **Vision-Language-Action (VLA)** data for AI/robotics training. Experts record **video + motion sensors** (accelerometer, gyroscope) in sync; the system stores that data, processes it into training-ready form, and supports a lightweight **training → evaluation** pipeline—all without requiring physical robots.

- **Public-facing terms:** Contributors are **Experts**; customers/teams are **Organizations**.
- **Data format:** Each recording is a **Kinetic Trace**: synchronized video, 50 Hz sensor samples (accel + gyro), optional audio/transcript, and metadata (device, fps). This is the standard shape for VLA and embodied-AI datasets.
- **Marketplace angle:** Orgs set **per-task bounties** (and optional tiered payouts by hardware). Experts see only tasks they can fulfill (by hardware and org); sessions go through an **approval gate** before payout. Experts see **posted bounty** and **earned payout** on their dashboard.

---

## Who Uses It

| Role | Who | What they do |
|------|-----|--------------|
| **Experts** | Contributors / data collectors | Sign up (via invite link or open org), complete consent, set **My hardware** (phone, laptop, glasses, etc.). Browse **Task board** (filtered by org + hardware), record for a task, upload. **My recordings** shows task, org, time, **bounty**, **review status**, and **earned payout** when approved. |
| **Organizations** | Customers / teams (e.g. “The Data Gym”) | **Manage tasks** (name, instructions, bounty, required/preferred hardware, tiered bounty overrides). Invite experts via join links or open sign-up. **Review queue**: approve or reject uploaded sessions and set payout before contributor is “paid” (billing not implemented; workflow + audit in place). |
| **Platform admins** | Internal ops | See all orgs, sessions, assets; manage profiles; add experts to multiple orgs. View **Pipeline ops** (job + artifact status). Can manage tasks and reviews across orgs. |

---

## What’s Built (Feature List)

### 1. Web app (Next.js)

- **Auth:** Sign up, sign in, optional redirect (e.g. after login → `/onboarding` or `/capture`).
- **Invite flow:** `/join/<slug>` (e.g. `/join/data-gym`) → sign-up with that organization pre-selected.
- **Onboarding:** One-time **Expert Data Contribution & Release Agreement** at `/onboarding`: recording country/region, consent text, optional “Enhanced Data Release,” and signature (hashed and stored). Required before recording; each session links to the consent in effect.
- **My hardware** (`/settings/hardware`): Experts declare which capture devices they have (e.g. phone_imu, laptop_webcam, smart_glasses, depth_camera, vr_ar_headset). Used to filter which tasks they see and whether they can start a recording for a task.
- **Task board** (`/tasks`): Browse **active tasks** per organization with bounty and hardware requirements. Only tasks whose **required hardware** the expert has are shown. “Record this task” deep-links to capture with org + task pre-selected. Link to **Manage tasks** (org admins) and **My hardware**.
- **Manage tasks** (`/org/tasks`): Org admins create/edit tasks: name, instructions, **bounty**, max approved sessions, budget cap, **required** and **preferred** hardware tags, optional **tiered bounty overrides** (e.g. higher payout for smart_glasses). Active/inactive toggle. Tasks listed with “Preview in capture” and “Edit.”
- **Review queue** (`/review`): Org admins/annotators see **pending** session reviews. Approve (with payout in USD) or reject (with reason). Approved sessions show as “earned” on the expert’s dashboard.
- **Capture dashboard** (`/capture`): Expert chooses **Recording for** (organization) and **Task** (only tasks compatible with their **hardware_tags** are listed). If a task requires hardware they don’t have, Start Capture is disabled and they’re prompted to update **My hardware**. Start/Stop capture with live camera + motion (50 Hz accel/gyro). On stop: package video + sensor JSON → upload to storage, update session to `uploaded`, insert asset rows; a **session_reviews** row is auto-created (pending). **Audio** is recorded with video. Visual “uploading” state; success shows session ID and link to **My recordings**.
- **My recordings** (`/dashboard`): List of completed sessions: task name, org name, time, **posted bounty**, **review status** (pending/approved/rejected), **earned payout** when approved, and session ID. No raw video or sensor data.
- **Pipeline ops** (`/ops`): Internal view of **ml_jobs** and **ml_artifacts** (processing/training/eval jobs and outputs) per organization. For org members and platform admins to see pipeline health.

### 2. Native apps (Capacitor)

- **iOS and Android** projects; app runs the same web app (camera + motion via Capacitor plugins).
- **Build:** `npm run build:mobile` (static export) then open Xcode/Android Studio. Camera and motion permissions are configured.
- **Deploy:** Can point the app at the hosted web app (e.g. Vercel) via `server.url` so updates are instant without app-store releases.

### 3. Backend (Supabase)

- **Auth:** Email (and extensible) sign-in/sign-up.
- **Database:** PostgreSQL with Row Level Security (RLS). Data is scoped by organization; experts can belong to multiple orgs via `profile_organizations`. Role checks use a **SECURITY DEFINER** helper (`current_user_role()`) to avoid RLS recursion when reading `profiles.role`.
- **Profiles:** `role`, `trust_level` (scaffolding for future rate limits / auto-approval), **hardware_tags** (array of capture device tags the expert has).
- **Tasks:** `bounty_cents`, `max_approved_sessions`, `budget_cents`, `is_active`, **required_hardware_tags**, **preferred_hardware_tags**, **bounty_overrides** (JSON: tiered bounty by hardware tag).
- **Session reviews:** Table **session_reviews** (session_id, organization_id, status: pending/approved/rejected, reviewer_id, payout_cents, reject_reason, reviewed_at). When a session becomes `uploaded`, a **pending** review row is auto-created so the review queue has something to approve/reject.
- **Organization pricing:** Optional table **organization_pricing** (floor_bounty_cents, platform_fee_bps, rush_multiplier_bps, managed_fulfillment) for future billing; config-only today.
- **Storage:** Bucket `vla-assets`; paths `/<org_id>/<expert_id>/<session_id>/video.*` and `sensor.json`. Authenticated upload with policies; public read for generated URLs.
- **Migrations (in order):** Core schema → vendors → rename to organizations → profile_organizations (multi-org) → tasks → expert consent → storage policies → **ml_jobs + ml_artifacts** → **marketplace bounties and reviews** (session_reviews, task bounty fields, organization_pricing, trust_level) → **fix RLS profiles recursion** (current_user_role, policy rewrites) → **task hardware requirements** (profiles.hardware_tags, tasks required/preferred/bounty_overrides).

### 4. Python pipeline (video → data → training → evaluation)

- **Process** (`process.py`): Reads raw session (video + `sensor.json`) from disk or after worker download; extracts frames; aligns to sensor samples; writes **manifest** (e.g. Parquet) and frame images. Output: training-ready rows (frame, sensor, “action” = next sensor).
- **Train** (`train.py`): Loads manifest; trains a small **behavioral cloning (BC)** policy: (image + sensor) → next sensor. Saves model to `data/models/bc_policy.pt`.
- **Evaluate** (`evaluate.py`): Loads trained model; reports MSE/RMSE on the dataset and an optional **toy rollout** (fixed first frame, autoregressive prediction for a few steps). No robot required.
- **Worker** (`worker.py`): Polls `ml_jobs` for queued `process_session` jobs; downloads session assets into `data/raw/<session_id>/`; runs process; uploads manifest to storage; writes **ml_artifacts** row; marks job succeeded/failed. Uses **service role** key so it can write jobs/artifacts.
- **Helpers:** `fetch_sessions.py` (optional) pulls uploaded sessions from Supabase into `data/raw/`. `make_fixture.py` creates a synthetic session so the pipeline can be tested without real recordings.
- **Environment:** Pipeline uses **`python/.env`** (not the Next.js `.env.local`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (for worker), optional `SUPABASE_ANON_KEY` for fetch. One-time `npm run python:setup`; then `npm run python:process`, `python:train`, `python:evaluate` (or run `python worker.py` for the full loop).

### 5. Automation / “full loop”

- **Trigger:** When an expert finishes upload, `sessions.status` is set to `uploaded` → DB trigger enqueues an **ml_jobs** row (`kind = process_session`, `session_id` set).
- **Worker:** Run `python worker.py` (with `SUPABASE_SERVICE_ROLE_KEY`). It claims jobs, downloads assets, runs process, uploads manifest, records **ml_artifacts**, and updates job status.
- **Visibility:** `/ops` shows recent jobs and artifacts per organization so stakeholders can see that processing ran and where outputs live.

---

## Hardware tiers (task requirements)

Tasks can specify **required** and **preferred** capture hardware. Experts declare what they have in **My hardware**. The app filters so experts only see and can start tasks they can fulfill.

| Tag | Typical use |
|-----|-------------|
| **phone_imu** | Smartphone video + 50 Hz accel/gyro (current baseline). |
| **laptop_webcam** | Laptop/webcam; no IMU. Desktop tasks, UI, fine finger work. |
| **smart_glasses** | Egocentric POV (e.g. Meta Ray-Ban). |
| **depth_camera** | RGB + depth + IMU (RealSense, OAK-D). |
| **vr_ar_headset** | VR/AR (Quest, Vision Pro): 6DOF, hand tracking, depth. |

Orgs can set **tiered bounty overrides** (e.g. base $15 phone, $35 glasses, $75 depth). Reviewers can use that to set payout when approving; the expert dashboard shows posted bounty and earned payout.

---

## Expert quality / blocking (scaffolding)

- **trust_level** on profiles (default 0); intended for future rate limits and “trusted expert” auto-approval.
- **Approval gate:** Every uploaded session goes through **session_reviews** (approve/reject + payout). No automatic blocking yet; a future step is to add `is_blocked` (and optionally auto-block from rejection rate) and enforce it in RLS so blocked experts cannot create new sessions.

---

## Data & Privacy

- **Consent:** Stored in `expert_consents` (version, location, enhanced release flag, signature hash). Every session references the consent id for provenance.
- **Isolation:** Sessions and assets are scoped by **organization_id**; RLS enforces that only members of that org (and platform admins) can read.
- **Experts:** See only their own session list on the dashboard (metadata only, no video/sensor). They do not see other experts’ data or raw pipeline outputs.

---

## Technical Stack (Summary)

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind, Shadcn UI |
| Native | Capacitor 8 (iOS/Android), Camera + Motion plugins |
| Backend | Supabase (Auth, Postgres, Storage) |
| Pipeline | Python 3 (PyTorch, pandas, ffmpeg, httpx); runs locally or on a worker host |
| Deploy | Vercel (web), optional native app stores |

---

## How to Explain the “Full Loop”

1. **Expert** picks org + task (filtered by hardware), records on web or mobile → video + sensor JSON upload → session marked **uploaded**.
2. **Database** creates a **pending** session_review row (approval gate) and a **process_session** ml_job (pipeline).
3. **Org reviewer** uses **Review queue** (`/review`) to approve (with payout) or reject. Expert sees status and earned payout on **My recordings**.
4. **Worker** (Python) picks up the ml_job, downloads the session’s files, runs **process** (frames + aligned manifest), uploads manifest to storage, and writes an **ml_artifacts** row.
5. **Training** (today: manual or scheduled) consumes processed data and produces a model (e.g. BC policy); **evaluation** runs on holdout data / toy rollout.
6. **Ops page** (`/ops`) shows job status and artifact links so stakeholders can confirm the pipeline ran and where outputs are.

No physical robots are required; the value is **curated, aligned VLA data** and a path from raw uploads → approval → processed dataset → trained model → evaluation, with clear audit (consent, org scoping, review history, job/artifact history).

---

## Routes quick reference

| Route | Purpose |
|-------|---------|
| `/` | Home; sign in / sign up / Record / Task board / Review / My recordings |
| `/sign-up`, `/sign-in` | Auth |
| `/join/[slug]` | Invite link → sign-up with org pre-selected |
| `/onboarding` | One-time expert consent agreement |
| `/settings/hardware` | Expert: declare capture hardware (phone, laptop, glasses, etc.) |
| `/tasks` | Task board: browse active tasks by org (filtered by hardware); “Record this task” → capture |
| `/org/tasks` | Org admin: create/edit tasks (bounty, required/preferred hardware, tiered overrides) |
| `/capture` | Recording dashboard; org + task picker (hardware-filtered); start/stop & upload |
| `/dashboard` | My recordings: task, org, time, bounty, review status, earned payout |
| `/review` | Org admin/annotator: approve or reject uploaded sessions; set payout |
| `/ops` | Pipeline ops: ml_jobs and ml_artifacts per org |

---

## Scripts Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Run Next.js dev server |
| `npm run build` | Production build (Vercel) |
| `npm run build:mobile` | Static export + Capacitor sync for iOS/Android |
| `npm run cap:ios` / `cap:android` | Open native IDE |
| `npm run python:setup` | One-time: create venv + install Python deps |
| `npm run python:fixture` | Create test session in `data/raw/` |
| `npm run python:process` | Process raw sessions → manifest + frames |
| `npm run python:train` | Train BC model from manifest |
| `npm run python:evaluate` | Eval model (MSE + toy rollout) |
| `python worker.py` (from `python/`, with `.env`) | Run pipeline worker (claim jobs, process, upload artifacts) |

---

*Document generated for stakeholder sharing. For implementation details, see the main README and `python/README.md`.*

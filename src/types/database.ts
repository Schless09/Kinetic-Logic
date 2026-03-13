/** Supabase DB types for Kinetic Logic MVP (multi-tenant organizations) */

export type AppRole = "expert" | "annotator" | "admin" | "platform_admin";
export type SessionStatus = "recording" | "uploaded" | "verified";
export type AssetType = "video" | "sensor_json";
export type MlJobKind = "process_session" | "train" | "evaluate";
export type MlJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type MlArtifactType = "manifest" | "frames" | "model" | "metrics" | "log" | "other";

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  allow_open_signup: boolean;
  created_at: string;
  updated_at: string;
}

/** Which organizations an expert belongs to; one expert can have multiple orgs. */
export interface ProfileOrganization {
  profile_id: string;
  organization_id: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  role: AppRole;
  location: string | null;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  trust_level?: number;
  hardware_tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  organization_id: string;
  name: string;
  instructions: string | null;
  bounty_cents?: number | null;
  max_approved_sessions?: number | null;
  budget_cents?: number | null;
  is_active?: boolean;
  min_trust_level?: number;
  required_hardware_tags?: string[];
  preferred_hardware_tags?: string[];
  bounty_overrides?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export type SessionReviewStatus = "pending" | "approved" | "rejected";

export interface SessionReview {
  id: string;
  session_id: string;
  organization_id: string;
  status: SessionReviewStatus;
  reviewer_id: string | null;
  payout_cents: number | null;
  reject_reason: string | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpertConsent {
  id: string;
  profile_id: string;
  version: string;
  signed_at: string;
  recording_country: string;
  recording_region: string | null;
  enhanced_data_release: boolean;
  signature_hash: string;
  created_at: string;
}

export interface Session {
  id: string;
  expert_id: string;
  organization_id: string;
  consent_id: string | null;
  task_id: string | null;
  task_metadata: Record<string, unknown>;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  session_id: string;
  type: AssetType;
  file_url: string;
  checksum: string | null;
  created_at: string;
}

export interface MlJob {
  id: string;
  organization_id: string;
  kind: MlJobKind;
  status: MlJobStatus;
  session_id: string | null;
  attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MlArtifact {
  id: string;
  organization_id: string;
  job_id: string;
  type: MlArtifactType;
  file_url: string;
  checksum: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

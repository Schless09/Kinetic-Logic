import { supabase } from "@/lib/supabase";
import type { KineticTrace, KineticTraceSample } from "@/types/kinetic-trace";

const STORAGE_BUCKET = "vla-assets";
const SENSOR_HZ = 50;

/**
 * Build a full KineticTrace from raw samples and metadata.
 */
export function buildTraceFromSamples(
  device: string,
  fps: number,
  samples: KineticTraceSample[]
): KineticTrace {
  return {
    metadata: { device, fps, sensor_hz: SENSOR_HZ },
    samples,
  };
}

/**
 * Simple hash for checksum (non-crypto, for dedup/consistency).
 */
export async function checksumBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Upload video and sensor JSON to Supabase Storage at /[organizationId]/[expertId]/[sessionId]/,
 * then update session + insert assets in DB and set session status to 'uploaded'.
 */
export interface UploadVLAParams {
  organizationId: string;
  expertId: string;
  sessionId: string;
  videoBlob: Blob;
  trace: KineticTrace;
  taskMetadata?: Record<string, unknown>;
}

export interface UploadVLAResult {
  sessionId: string;
  videoUrl: string;
  sensorUrl: string;
  error?: string;
}

export async function uploadSessionAssets({
  organizationId,
  expertId,
  sessionId,
  videoBlob,
  trace,
  taskMetadata = {},
}: UploadVLAParams): Promise<UploadVLAResult> {
  const videoExt = videoBlob.type.includes("mp4") ? "mp4" : "webm";
  const prefix = `${organizationId}/${expertId}/${sessionId}`;
  const videoPath = `${prefix}/video.${videoExt}`;
  const sensorPath = `${prefix}/sensor.json`;

  const { error: videoErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(videoPath, videoBlob, {
      contentType: videoBlob.type,
      upsert: true,
    });
  if (videoErr) {
    return {
      sessionId,
      videoUrl: "",
      sensorUrl: "",
      error: `Video upload failed: ${videoErr.message}`,
    };
  }

  const sensorBlob = new Blob([JSON.stringify(trace)], {
    type: "application/json",
  });
  const { error: sensorErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(sensorPath, sensorBlob, {
      contentType: "application/json",
      upsert: true,
    });
  if (sensorErr) {
    return {
      sessionId,
      videoUrl: "",
      sensorUrl: "",
      error: `Sensor upload failed: ${sensorErr.message}`,
    };
  }

  const {
    data: { publicUrl: baseUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("");
  const videoUrl = `${baseUrl}/${videoPath}`;
  const sensorUrl = `${baseUrl}/${sensorPath}`;

  const videoChecksum = await checksumBlob(videoBlob);
  const sensorChecksum = await checksumBlob(sensorBlob);

  const { error: sessionErr } = await supabase
    .from("sessions")
    .update({ status: "uploaded", task_metadata: taskMetadata, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (sessionErr) {
    return {
      sessionId,
      videoUrl,
      sensorUrl,
      error: `Session update failed: ${sessionErr.message}`,
    };
  }

  await supabase.from("assets").insert([
    { session_id: sessionId, type: "video", file_url: videoUrl, checksum: videoChecksum },
    { session_id: sessionId, type: "sensor_json", file_url: sensorUrl, checksum: sensorChecksum },
  ]);

  return { sessionId, videoUrl, sensorUrl };
}

/**
 * Create a new session row (status = 'recording') before starting capture.
 * Requires organization_id from current user's profile. Optional consentId links to expert_consents for provenance; optional taskId links to a task.
 */
export async function createSession(
  expertId: string,
  organizationId: string,
  taskMetadata: Record<string, unknown> = {},
  taskId?: string | null,
  consentId?: string | null
): Promise<{ sessionId: string; error?: string }> {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      expert_id: expertId,
      organization_id: organizationId,
      consent_id: consentId ?? null,
      task_id: taskId ?? null,
      task_metadata: taskMetadata,
      status: "recording",
    })
    .select("id")
    .single();
  if (error) return { sessionId: "", error: error.message };
  return { sessionId: data.id };
}

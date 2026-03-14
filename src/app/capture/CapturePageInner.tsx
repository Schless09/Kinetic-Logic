"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SensorHealth } from "@/components/capture/SensorHealth";
import { useVLASensorEngine } from "@/hooks/useVLASensorEngine";
import { buildTraceFromSamples, createSession, uploadSessionAssets } from "@/lib/upload-vla";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/database";

const VIDEO_FPS = 30;
const SENSOR_HZ = 50;

export function CapturePageInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"idle" | "recording" | "uploading" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ sessionId: string; videoUrl: string; sensorUrl: string } | null>(
    null
  );
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [latestConsentId, setLatestConsentId] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hardwareTags, setHardwareTags] = useState<string[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const expertIdRef = useRef<string | null>(null);
  const organizationIdRef = useRef<string | null>(null);

  const {
    startCapture: startSensors,
    stopCapture: stopSensors,
    isCapturing,
    lastEventAt,
    sampleCount,
  } = useVLASensorEngine({ fps: VIDEO_FPS, sensor_hz: SENSOR_HZ });

  const videoRef = useRef<HTMLVideoElement>(null);

  // Load orgs, consent, hardware
  useEffect(() => {
    (async () => {
      const preselectOrgId = searchParams.get("organizationId");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("hardware_tags")
        .eq("id", user.id)
        .maybeSingle();
      setHardwareTags((profile?.hardware_tags as string[] | null) ?? []);

      const { data: consents } = await supabase
        .from("expert_consents")
        .select("id")
        .eq("profile_id", user.id)
        .order("signed_at", { ascending: false })
        .limit(1);
      if (!consents?.length) {
        window.location.href = "/onboarding";
        return;
      }
      setLatestConsentId(consents[0].id);

      const { data: rows } = await supabase
        .from("profile_organizations")
        .select("organization_id, organizations(id, name)")
        .eq("profile_id", user.id);
      if (!rows?.length) return;
      const orgs = rows
        .map(
          (r: {
            organization_id: string;
            organizations: { id: string; name: string } | { id: string; name: string }[] | null;
          }) => {
            const org = r.organizations;
            if (!org) return null;
            const single = Array.isArray(org) ? org[0] : org;
            return single ? { id: single.id, name: single.name } : null;
          }
        )
        .filter(Boolean) as { id: string; name: string }[];
      setOrganizations(orgs);
      if (orgs.length > 0) {
        setSelectedOrganizationId((prev) => {
          if (prev) return prev;
          if (preselectOrgId && orgs.some((o) => o.id === preselectOrgId)) return preselectOrgId;
          return orgs[0].id;
        });
      }
      setOrganizationsLoaded(true);
    })();
  }, [searchParams]);

  // Load tasks for the selected org, filtered by hardware compatibility
  useEffect(() => {
    if (!selectedOrganizationId) {
      setTasks([]);
      return;
    }
    (async () => {
      const preselectTaskId = searchParams.get("taskId");
      const { data: tasksList } = await supabase
        .from("tasks")
        .select(
          "id, organization_id, name, instructions, bounty_cents, is_active, required_hardware_tags, preferred_hardware_tags, bounty_overrides, created_at, updated_at"
        )
        .eq("organization_id", selectedOrganizationId)
        .eq("is_active", true)
        .order("name");
      const all = (tasksList as Task[]) ?? [];
      const have = new Set(hardwareTags);
      const compatible = all.filter((t) => (t.required_hardware_tags ?? []).every((tag) => have.has(tag)));
      setTasks(compatible);
      setSelectedTask((prev) => {
        if (prev && prev.organization_id === selectedOrganizationId) return prev;
        if (preselectTaskId) {
          const hit = compatible.find((t) => t.id === preselectTaskId) ?? null;
          if (hit) return hit;
        }
        return null;
      });
    })();
  }, [selectedOrganizationId, searchParams, hardwareTags]);

  const selectedTaskCompatible = useMemo(() => {
    if (!selectedTask) return true;
    const have = new Set(hardwareTags);
    return (selectedTask.required_hardware_tags ?? []).every((tag) => have.has(tag));
  }, [hardwareTags, selectedTask]);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const stream = streamRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob());
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        stream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        chunksRef.current = [];
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const handleStartCapture = useCallback(async () => {
    setErrorMessage(null);
    setUploadResult(null);

    // iOS requires getUserMedia to be started in the same user gesture as the tap.
    // Request media immediately (no await before this), then do the rest after we have the stream.
    const streamPromise = navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });

    let stream: MediaStream;
    try {
      stream = await streamPromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera or microphone access failed";
      setErrorMessage(
        msg.includes("Permission") || msg.includes("NotAllowed") || msg.includes("denied")
          ? "Camera and microphone access are required. Allow access when prompted, then try again."
          : msg
      );
      setStatus("error");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const expertId = user?.id ?? null;
    expertIdRef.current = expertId;
    if (!expertId) {
      stream.getTracks().forEach((t) => t.stop());
      setErrorMessage("Sign in required to capture.");
      setStatus("error");
      return;
    }

    const organizationId = selectedOrganizationId ?? null;
    organizationIdRef.current = organizationId;
    if (!organizationId || !organizations.some((o) => o.id === organizationId)) {
      stream.getTracks().forEach((t) => t.stop());
      setErrorMessage("Select an organization to record for.");
      setStatus("error");
      return;
    }

    const { sessionId, error: sessionError } = await createSession(
      expertId,
      organizationId,
      {
        started_at: new Date().toISOString(),
        ...(selectedTask && {
          task_name: selectedTask.name,
          task_instructions: selectedTask.instructions ?? undefined,
        }),
      },
      selectedTask?.id ?? null,
      latestConsentId
    );
    if (sessionError || !sessionId) {
      stream.getTracks().forEach((t) => t.stop());
      setErrorMessage(sessionError ?? "Failed to create session");
      setStatus("error");
      return;
    }
    sessionIdRef.current = sessionId;

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }

    const mimeType = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.start(500);
    mediaRecorderRef.current = recorder;

    await startSensors();
    setStatus("recording");
  }, [startSensors, selectedTask, selectedOrganizationId, organizations, latestConsentId]);

  const handleStopCapture = useCallback(async () => {
    if (status !== "recording") return;
    setStatus("uploading");

    const [samples, videoBlob] = await Promise.all([stopSensors(), stopRecording()]);
    const expertId = expertIdRef.current;
    const organizationId = organizationIdRef.current;
    const sessionId = sessionIdRef.current;

    if (!expertId || !organizationId || !sessionId) {
      setErrorMessage("Missing session, organization, or user");
      setStatus("error");
      return;
    }

    const device = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
    const trace = buildTraceFromSamples(device, VIDEO_FPS, samples);

    const result = await uploadSessionAssets({
      organizationId,
      expertId,
      sessionId,
      videoBlob,
      trace,
    });

    if (result.error) {
      setErrorMessage(result.error);
      setStatus("error");
      return;
    }
    setUploadResult({ sessionId: result.sessionId, videoUrl: result.videoUrl, sensorUrl: result.sensorUrl });
    setStatus("done");
  }, [status, stopSensors, stopRecording]);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-lg mx-auto px-4 pt-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">Kinetic Logic</h1>
            <p className="text-muted-foreground text-sm">VLA capture: video + motion sensors</p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary hover:underline shrink-0"
          >
            My recordings
          </Link>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Live preview</CardTitle>
              <Badge variant={status === "recording" ? "destructive" : status === "uploading" ? "default" : "secondary"}>
                {status === "recording" ? "Recording" : status === "uploading" ? "Uploading…" : "Idle"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === "uploading" && (
              <div
                className="rounded-lg border border-primary/30 bg-primary/5 p-5 flex flex-col items-center gap-3"
                role="status"
                aria-live="polite"
              >
                <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden />
                <p className="text-sm font-medium text-foreground">Uploading video and sensor data…</p>
                <p className="text-xs text-muted-foreground">This may take a moment</p>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full w-full rounded-full bg-primary/40 animate-pulse origin-left"
                    style={{ animationDuration: "1.2s" }}
                  />
                </div>
              </div>
            )}
            {organizationsLoaded && organizations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No organizations assigned. Use an invite link from an org or ask an admin to add you.
              </p>
            )}
            {organizations.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Recording for</label>
                <select
                  value={selectedOrganizationId ?? ""}
                  onChange={(e) => setSelectedOrganizationId(e.target.value || null)}
                  className={cn(
                    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  )}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tasks.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Task (what to record)</label>
                <select
                  value={selectedTask?.id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedTask(tasks.find((t) => t.id === id) ?? null);
                  }}
                  className={cn(
                    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  )}
                >
                  <option value="">No task selected</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {selectedTask?.instructions && (
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedTask.instructions}
                  </div>
                )}
              </div>
            )}
            <div
              className={cn(
                "relative aspect-4/3 w-full rounded-lg bg-muted overflow-hidden",
                status === "recording" && "ring-2 ring-primary"
              )}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
              {status === "idle" && !streamRef.current && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm text-center px-4">
                  Camera and microphone will start when you tap Start Capture
                </div>
              )}
            </div>

            <SensorHealth lastEventAt={lastEventAt} isCapturing={isCapturing} sampleCount={sampleCount} />

            <div className="flex gap-2">
              <Button
                onClick={handleStartCapture}
                disabled={
                  status === "recording" ||
                  status === "uploading" ||
                  organizations.length === 0 ||
                  !selectedOrganizationId ||
                  !selectedTaskCompatible
                }
                className="flex-1"
              >
                Start Capture
              </Button>
              <Button
                variant="destructive"
                onClick={handleStopCapture}
                disabled={status !== "recording"}
                className="flex-1"
              >
                Stop & Upload
              </Button>
            </div>

            {errorMessage && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{errorMessage}</p>
                {(errorMessage.includes("Sign in") || errorMessage.includes("organization")) && (
                  <Link href="/sign-in" className="text-sm text-primary underline underline-offset-4">
                    Sign in
                  </Link>
                )}
              </div>
            )}
            {!selectedTaskCompatible && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">This task requires hardware not in your profile.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Required: <span className="font-mono">{selectedTask?.required_hardware_tags?.join(", ")}</span>
                </p>
                <Link href="/settings/hardware" className="text-sm text-primary hover:underline mt-2 inline-block">
                  Update my hardware
                </Link>
              </div>
            )}
            {uploadResult && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-2">
                <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
                  <span
                    className="h-5 w-5 rounded-full bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400"
                    aria-hidden
                  >
                    ✓
                  </span>
                  Upload complete
                </p>
                <p className="text-xs text-muted-foreground">Video and sensor JSON uploaded.</p>
                <p className="text-xs font-mono text-muted-foreground break-all" title="Session ID">
                  {uploadResult.sessionId}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


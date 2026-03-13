"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const HARDWARE_TAGS = [
  { tag: "phone_imu", label: "Smartphone (video + IMU)" },
  { tag: "laptop_webcam", label: "Laptop / webcam" },
  { tag: "smart_glasses", label: "Smart glasses (egocentric video)" },
  { tag: "depth_camera", label: "Depth camera (RealSense / OAK-D)" },
  { tag: "vr_ar_headset", label: "VR/AR headset (hand tracking / depth)" },
] as const;

export default function HardwareSettingsPage() {
  const [hardware, setHardware] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const hardwareSet = useMemo(() => new Set(hardware), [hardware]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sign in required.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, hardware_tags")
      .eq("id", user.id)
      .maybeSingle();
    if (profileErr) {
      setError(profileErr.message);
      setLoading(false);
      return;
    }
    if (!profile) {
      setError("No profile row found for this user. Create the profile row (id = auth.uid()) then refresh.");
      setLoading(false);
      return;
    }

    setRole(profile.role ?? null);
    setHardware((profile.hardware_tags as string[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback((tag: string, checked: boolean) => {
    setHardware((prev) => (checked ? Array.from(new Set([...prev, tag])) : prev.filter((x) => x !== tag)));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Sign in required.");
      setSaving(false);
      return;
    }

    const { error: err } = await supabase.from("profiles").update({ hardware_tags: hardware }).eq("id", user.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    setSaving(false);
  }, [hardware]);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-2xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">My hardware</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Select what you have. You’ll only see tasks you can complete with your hardware.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Task board
          </Link>
          <Link
            href="/capture"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Record
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hardware profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && <p className="text-sm text-muted-foreground py-2">Loading…</p>}
            {error && <p className="text-sm text-destructive py-2">{error}</p>}

            {!loading && !error && (
              <>
                <p className="text-xs text-muted-foreground">
                  Role: <span className="font-mono">{role ?? "unknown"}</span>
                </p>
                <div className="space-y-2">
                  {HARDWARE_TAGS.map((h) => (
                    <label key={h.tag} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={hardwareSet.has(h.tag)}
                        onChange={(e) => toggle(h.tag, e.target.checked)}
                      />
                      <span>{h.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{h.tag}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={load} disabled={saving}>
                    Refresh
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  For MVP, filtering is done in the app. Later we can enforce server-side checks in RLS.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


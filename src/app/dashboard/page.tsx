"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SessionRow = {
  id: string;
  created_at: string;
  status: string;
  task_id: string | null;
  organization_id: string;
  tasks: { name: string; bounty_cents?: number | null } | null;
  organizations: { name: string } | null;
  session_reviews?: { status: string; payout_cents: number | null } | { status: string; payout_cents: number | null }[] | null;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setError("Sign in to see your recordings.");
        return;
      }
      const { data, error: err } = await supabase
        .from("sessions")
        .select(
          "id, created_at, status, task_id, organization_id, tasks(name, bounty_cents), organizations(name), session_reviews(status, payout_cents)"
        )
        .eq("expert_id", user.id)
        .order("created_at", { ascending: false });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setSessions((data as SessionRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-lg mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">My recordings</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Log of tasks you’ve completed (time, task, org). No video or sensor data here.
        </p>

        <div className="flex gap-2 mb-4">
          <Link
            href="/capture"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New recording
          </Link>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Home
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completed sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            )}
            {error && (
              <p className="text-sm text-destructive py-4">{error}</p>
            )}
            {!loading && !error && sessions.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                No recordings yet. Start a capture from the recording dashboard.
              </p>
            )}
            {!loading && !error && sessions.length > 0 && (
              <ul className="divide-y divide-border">
                {sessions.map((s) => (
                  <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {s.tasks?.name ?? "No task"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.organizations?.name ?? "—"} · {formatDateTime(s.created_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const r = s.session_reviews;
                          const single = Array.isArray(r) ? r[0] : r;
                          const reviewStatus = single?.status ?? "pending";
                          const payout = single?.payout_cents ?? null;
                          const posted = (s.tasks as { bounty_cents?: number | null } | null)?.bounty_cents ?? null;

                          const postedText = posted !== null ? `Bounty: $${(posted / 100).toFixed(2)}` : "Bounty: —";
                          const payoutText = payout !== null ? ` · Earned: $${(payout / 100).toFixed(2)}` : "";
                          return `${postedText} · Review: ${reviewStatus}${payoutText}`;
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {s.id}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReviewQueueRow = {
  id: string; // session_reviews.id
  status: "pending" | "approved" | "rejected";
  payout_cents: number | null;
  reject_reason: string | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  session_id: string;
  organization_id: string;
  sessions:
    | {
        id: string;
        created_at: string;
        expert_id: string;
        task_id: string | null;
        organizations: { name: string } | { name: string }[] | null;
        tasks:
          | { name: string; bounty_cents: number | null }
          | { name: string; bounty_cents: number | null }[]
          | null;
      }
    | {
        id: string;
        created_at: string;
        expert_id: string;
        task_id: string | null;
        organizations: { name: string } | { name: string }[] | null;
        tasks:
          | { name: string; bounty_cents: number | null }
          | { name: string; bounty_cents: number | null }[]
          | null;
      }[]
    | null;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ReviewPage() {
  const [rows, setRows] = useState<ReviewQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const [payoutDraft, setPayoutDraft] = useState<Record<string, string>>({});
  const [rejectDraft, setRejectDraft] = useState<Record<string, string>>({});

  const canReview = profileRole === "admin" || profileRole === "annotator" || profileRole === "platform_admin";

  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);

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
      .select("role")
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
    setProfileRole(profile?.role ?? null);

    const { data, error: err } = await supabase
      .from("session_reviews")
      .select(
        "id, status, payout_cents, reject_reason, notes, reviewed_at, created_at, session_id, organization_id, sessions(id, created_at, expert_id, task_id, organizations(name), tasks(name, bounty_cents))"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const list = (data as ReviewQueueRow[]) ?? [];
    setRows(list);

    // Initialize payout drafts from task bounty (if present)
    const nextDraft: Record<string, string> = {};
    for (const r of list) {
      const s = r.sessions;
      const singleSession = Array.isArray(s) ? s[0] : s;
      const taskObj = singleSession?.tasks;
      const singleTask = Array.isArray(taskObj) ? taskObj[0] : taskObj;
      const suggested = r.payout_cents ?? singleTask?.bounty_cents ?? null;
      if (suggested !== null) nextDraft[r.id] = (suggested / 100).toString();
    }
    setPayoutDraft((prev) => ({ ...nextDraft, ...prev }));

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = useCallback(
    async (reviewId: string) => {
      const dollars = payoutDraft[reviewId];
      const payoutCents =
        dollars && dollars.trim().length > 0 ? Math.max(0, Math.round(parseFloat(dollars) * 100)) : null;
      const { data: { user } } = await supabase.auth.getUser();
      const reviewerId = user?.id ?? null;

      const { error: err } = await supabase
        .from("session_reviews")
        .update({
          status: "approved",
          payout_cents: payoutCents,
          reviewer_id: reviewerId,
          reviewed_at: new Date().toISOString(),
          reject_reason: null,
        })
        .eq("id", reviewId);
      if (err) {
        setError(err.message);
        return;
      }
      await load();
    },
    [load, payoutDraft]
  );

  const reject = useCallback(
    async (reviewId: string) => {
      const reason = rejectDraft[reviewId]?.trim() ?? "";
      const { data: { user } } = await supabase.auth.getUser();
      const reviewerId = user?.id ?? null;

      const { error: err } = await supabase
        .from("session_reviews")
        .update({
          status: "rejected",
          reviewer_id: reviewerId,
          reviewed_at: new Date().toISOString(),
          reject_reason: reason.length ? reason : "Rejected",
        })
        .eq("id", reviewId);
      if (err) {
        setError(err.message);
        return;
      }
      await load();
    },
    [load, rejectDraft]
  );

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Review queue</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Approve/reject uploaded sessions before payout. (Billing is not implemented yet—this is the workflow + audit trail.)
        </p>

        <div className="flex gap-2 mb-4">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Home
          </Link>
          <Link
            href="/ops"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Pipeline ops
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending reviews ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
            {error && <p className="text-sm text-destructive py-4">{error}</p>}
            {!loading && !error && !canReview && (
              <p className="text-sm text-muted-foreground py-4">
                Your role is <span className="font-mono">{profileRole ?? "unknown"}</span>. You need{" "}
                <span className="font-medium">admin</span> or <span className="font-medium">annotator</span> to review.
              </p>
            )}

            {!loading && !error && canReview && pending.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No pending sessions right now.</p>
            )}

            {!loading && !error && canReview && pending.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pending.map((r) => {
                  const s = r.sessions;
                  const singleSession = Array.isArray(s) ? s[0] : s;
                  const orgObj = singleSession?.organizations;
                  const singleOrg = Array.isArray(orgObj) ? orgObj[0] : orgObj;
                  const taskObj = singleSession?.tasks;
                  const singleTask = Array.isArray(taskObj) ? taskObj[0] : taskObj;

                  const orgName = singleOrg?.name ?? r.organization_id;
                  const taskName = singleTask?.name ?? "No task";
                  const suggested = singleTask?.bounty_cents ?? null;
                  return (
                    <li key={r.id} className="p-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-0.5">
                          <p className="text-sm font-medium">
                            {taskName}{" "}
                            <span className="text-xs text-muted-foreground font-normal">
                              · {orgName} · {formatDateTime(r.created_at)}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">session {r.session_id}</p>
                          <p className="text-xs text-muted-foreground">
                            Suggested bounty: {formatMoney(suggested)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[180px]">
                            <label className="text-xs text-muted-foreground">Payout (USD)</label>
                            <Input
                              value={payoutDraft[r.id] ?? ""}
                              onChange={(e) => setPayoutDraft((p) => ({ ...p, [r.id]: e.target.value }))}
                              placeholder={suggested ? (suggested / 100).toString() : "e.g. 20"}
                            />
                          </div>
                          <Button onClick={() => approve(r.id)} className="h-10">
                            Approve
                          </Button>
                          <div className="flex-1 min-w-[220px]">
                            <label className="text-xs text-muted-foreground">Reject reason</label>
                            <Input
                              value={rejectDraft[r.id] ?? ""}
                              onChange={(e) => setRejectDraft((p) => ({ ...p, [r.id]: e.target.value }))}
                              placeholder="e.g. wrong framing, incomplete steps"
                            />
                          </div>
                          <Button variant="destructive" onClick={() => reject(r.id)} className="h-10">
                            Reject
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}


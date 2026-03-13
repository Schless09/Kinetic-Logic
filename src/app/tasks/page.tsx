"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Task } from "@/types/database";

type OrgRow = { id: string; name: string };

function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function TasksPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [hardwareTags, setHardwareTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOrgAdmin = role === "admin" || role === "platform_admin";

  const selectedOrg = useMemo(() => orgs.find((o) => o.id === selectedOrgId) ?? null, [orgs, selectedOrgId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to view tasks.");
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
      setHardwareTags((profile.hardware_tags as string[] | null) ?? []);

      const { data: rows, error: orgErr } = await supabase
        .from("profile_organizations")
        .select("organization_id, organizations(id, name)")
        .eq("profile_id", user.id);
      if (orgErr) {
        setError(orgErr.message);
        setLoading(false);
        return;
      }

      const list =
        rows
          ?.map(
            (r: {
              organization_id: string;
              organizations: { id: string; name: string } | { id: string; name: string }[] | null;
            }) => {
              const org = r.organizations;
              const single = Array.isArray(org) ? org[0] : org;
              return single ? { id: single.id, name: single.name } : null;
            }
          )
          .filter(Boolean) ?? [];

      setOrgs(list as OrgRow[]);
      setSelectedOrgId((prev) => prev ?? (list as OrgRow[])[0]?.id ?? null);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrgId) {
      setTasks([]);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase
        .from("tasks")
        .select(
          "id, organization_id, name, instructions, bounty_cents, is_active, required_hardware_tags, preferred_hardware_tags, bounty_overrides, created_at, updated_at"
        )
        .eq("organization_id", selectedOrgId)
        .eq("is_active", true)
        .order("name");
      if (err) {
        setError(err.message);
        return;
      }
      setTasks((data as Task[]) ?? []);
    })();
  }, [selectedOrgId]);

  const compatibleTasks = useMemo(() => {
    const have = new Set(hardwareTags);
    return tasks.filter((t) => {
      const req = t.required_hardware_tags ?? [];
      return req.every((tag) => have.has(tag));
    });
  }, [hardwareTags, tasks]);

  const missingHardwareForAny = useMemo(() => {
    const have = new Set(hardwareTags);
    const missing = new Set<string>();
    for (const t of tasks) {
      for (const tag of t.required_hardware_tags ?? []) {
        if (!have.has(tag)) missing.add(tag);
      }
    }
    return Array.from(missing);
  }, [hardwareTags, tasks]);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Task board</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Browse active tasks and bounties, then start a recording for the selected task.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Home
          </Link>
          <Link
            href="/capture"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Record
          </Link>
          <Link
            href="/org/tasks"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Manage tasks
          </Link>
          <Link
            href="/settings/hardware"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            My hardware
          </Link>
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Organization</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground py-2">Loading…</p>}
            {error && <p className="text-sm text-destructive py-2">{error}</p>}
            {!loading && orgs.length > 0 && (
              <select
                value={selectedOrgId ?? ""}
                onChange={(e) => setSelectedOrgId(e.target.value || null)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Active tasks {selectedOrg ? <span className="text-muted-foreground font-normal">· {selectedOrg.name}</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!loading && !error && selectedOrgId && tasks.length > 0 && compatibleTasks.length !== tasks.length && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Some tasks are hidden because your hardware profile doesn’t meet requirements.
                </p>
                {missingHardwareForAny.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Missing required tags: <span className="font-mono">{missingHardwareForAny.join(", ")}</span>
                  </p>
                )}
                <Link href="/settings/hardware" className="text-sm text-primary hover:underline mt-2 inline-block">
                  Update my hardware
                </Link>
              </div>
            )}
            {tasks.length === 0 && !loading && !error && (
              <div className="py-2 space-y-2">
                <p className="text-sm text-muted-foreground">No active tasks for this organization yet.</p>
                {isOrgAdmin && (
                  <Link
                    href="/org/tasks"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Create the first task
                  </Link>
                )}
              </div>
            )}
            {compatibleTasks.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {compatibleTasks.map((t) => (
                  <li key={t.id} className="p-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t.name}</p>
                          {(t.required_hardware_tags?.length ?? 0) > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Requires: <span className="font-mono">{t.required_hardware_tags?.join(", ")}</span>
                            </p>
                          )}
                          {(t.preferred_hardware_tags?.length ?? 0) > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Preferred: <span className="font-mono">{t.preferred_hardware_tags?.join(", ")}</span>
                            </p>
                          )}
                          {t.instructions && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{t.instructions}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium">{formatMoney(t.bounty_cents ?? null)}</p>
                          <p className="text-xs text-muted-foreground">per approved session</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/capture?organizationId=${encodeURIComponent(t.organization_id)}&taskId=${encodeURIComponent(t.id)}`}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Record this task
                        </Link>
                      </div>
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


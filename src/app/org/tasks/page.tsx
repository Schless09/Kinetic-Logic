"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Task } from "@/types/database";

type OrgRow = { id: string; name: string };

function dollarsToCents(v: string): number | null {
  const s = v.trim();
  if (!s.length) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * 100));
}

function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toString();
}

export default function OrgTasksPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canManage = role === "admin" || role === "platform_admin";

  const selectedOrg = useMemo(() => orgs.find((o) => o.id === selectedOrgId) ?? null, [orgs, selectedOrgId]);
  const editingTask = useMemo(() => tasks.find((t) => t.id === editingId) ?? null, [tasks, editingId]);

  const [form, setForm] = useState({
    name: "",
    instructions: "",
    bountyDollars: "",
    maxApprovedSessions: "",
    budgetDollars: "",
    isActive: true,
    requiredHardware: [] as string[],
    preferredHardware: [] as string[],
    overridesJson: "" as string,
  });

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm({
      name: "",
      instructions: "",
      bountyDollars: "",
      maxApprovedSessions: "",
      budgetDollars: "",
      isActive: true,
      requiredHardware: [],
      preferredHardware: [],
      overridesJson: "",
    });
  }, []);

  const loadBase = useCallback(async () => {
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
    setRole(profile?.role ?? null);

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
  }, []);

  const loadTasks = useCallback(async () => {
    if (!selectedOrgId) {
      setTasks([]);
      return;
    }
    const { data, error: err } = await supabase
      .from("tasks")
      .select(
        "id, organization_id, name, instructions, bounty_cents, max_approved_sessions, budget_cents, is_active, required_hardware_tags, preferred_hardware_tags, bounty_overrides, created_at, updated_at"
      )
      .eq("organization_id", selectedOrgId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    setTasks((data as Task[]) ?? []);
  }, [selectedOrgId]);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    loadTasks();
    resetForm();
  }, [loadTasks, resetForm, selectedOrgId]);

  const startEdit = useCallback((t: Task) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      instructions: t.instructions ?? "",
      bountyDollars: centsToDollars(t.bounty_cents ?? null),
      maxApprovedSessions: t.max_approved_sessions?.toString?.() ?? "",
      budgetDollars: centsToDollars(t.budget_cents ?? null),
      isActive: t.is_active ?? true,
      requiredHardware: t.required_hardware_tags ?? [],
      preferredHardware: t.preferred_hardware_tags ?? [],
      overridesJson: t.bounty_overrides ? JSON.stringify(t.bounty_overrides, null, 2) : "",
    });
  }, []);

  const save = useCallback(async () => {
    if (!selectedOrgId) return;
    setError(null);

    const bountyCents = dollarsToCents(form.bountyDollars);
    const budgetCents = dollarsToCents(form.budgetDollars);
    const maxApproved =
      form.maxApprovedSessions.trim().length > 0 ? Math.max(0, parseInt(form.maxApprovedSessions, 10)) : null;

    if (!form.name.trim()) {
      setError("Task name is required.");
      return;
    }

    const payload = {
      organization_id: selectedOrgId,
      name: form.name.trim(),
      instructions: form.instructions.trim().length ? form.instructions : null,
      bounty_cents: bountyCents,
      budget_cents: budgetCents,
      max_approved_sessions: Number.isFinite(maxApproved as number) ? maxApproved : null,
      is_active: form.isActive,
      required_hardware_tags: form.requiredHardware,
      preferred_hardware_tags: form.preferredHardware,
      bounty_overrides: (() => {
        const raw = form.overridesJson.trim();
        if (!raw.length) return {};
        try {
          const parsed = JSON.parse(raw) as unknown;
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          // fall back to empty and let reviewer/admin fix it
          return {};
        }
      })(),
    };

    if (editingId) {
      const { error: err } = await supabase.from("tasks").update(payload).eq("id", editingId);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from("tasks").insert(payload);
      if (err) {
        setError(err.message);
        return;
      }
    }

    await loadTasks();
    resetForm();
  }, [editingId, form, loadTasks, resetForm, selectedOrgId]);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Task management</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Create and manage organization tasks (instructions + bounty). Visible to experts on the task board and capture page.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Task board
          </Link>
          <Link
            href="/review"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Review queue
          </Link>
          <Link
            href="/ops"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Pipeline ops
          </Link>
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground py-2">Loading…</p>}
            {error && <p className="text-sm text-destructive py-2">{error}</p>}
            {!loading && !canManage && (
              <p className="text-sm text-muted-foreground py-2">
                Your role is <span className="font-mono">{role ?? "unknown"}</span>. You need{" "}
                <span className="font-medium">admin</span> to manage tasks.
              </p>
            )}
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

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editingId ? "Edit task" : "Create task"}{" "}
              {selectedOrg ? <span className="text-muted-foreground font-normal">· {selectedOrg.name}</span> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Task name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Change a tire"
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1">
              <Label>Instructions</Label>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm((p) => ({ ...p, instructions: e.target.value }))}
                placeholder="Step-by-step instructions for the expert."
                disabled={!canManage}
                className="min-h-[120px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Bounty (USD)</Label>
                <Input
                  value={form.bountyDollars}
                  onChange={(e) => setForm((p) => ({ ...p, bountyDollars: e.target.value }))}
                  placeholder="e.g. 20"
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-1">
                <Label>Max approved sessions</Label>
                <Input
                  value={form.maxApprovedSessions}
                  onChange={(e) => setForm((p) => ({ ...p, maxApprovedSessions: e.target.value }))}
                  placeholder="e.g. 500"
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-1">
                <Label>Budget cap (USD)</Label>
                <Input
                  value={form.budgetDollars}
                  onChange={(e) => setForm((p) => ({ ...p, budgetDollars: e.target.value }))}
                  placeholder="e.g. 10000"
                  disabled={!canManage}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Required hardware</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["phone_imu", "laptop_webcam", "smart_glasses", "depth_camera", "vr_ar_headset"].map((tag) => (
                    <label key={tag} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.requiredHardware.includes(tag)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            requiredHardware: e.target.checked
                              ? Array.from(new Set([...p.requiredHardware, tag]))
                              : p.requiredHardware.filter((x) => x !== tag),
                          }))
                        }
                        disabled={!canManage}
                      />
                      {tag}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Preferred hardware</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["phone_imu", "laptop_webcam", "smart_glasses", "depth_camera", "vr_ar_headset"].map((tag) => (
                    <label key={tag} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.preferredHardware.includes(tag)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            preferredHardware: e.target.checked
                              ? Array.from(new Set([...p.preferredHardware, tag]))
                              : p.preferredHardware.filter((x) => x !== tag),
                          }))
                        }
                        disabled={!canManage}
                      />
                      {tag}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Tiered bounty overrides (JSON, optional)</Label>
              <textarea
                value={form.overridesJson}
                onChange={(e) => setForm((p) => ({ ...p, overridesJson: e.target.value }))}
                placeholder='e.g. { "phone_imu": 1500, "smart_glasses": 3500 }'
                disabled={!canManage}
                className="min-h-[110px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-mono outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Values are in cents. If set, the UI can show “+$X for smart_glasses” and reviewers can use it to set payout.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isActive"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                disabled={!canManage}
              />
              <Label htmlFor="isActive">Active (visible to experts)</Label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={!canManage}>
                {editingId ? "Save changes" : "Create task"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={!canManage && !editingTask}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground py-2">No tasks yet for this organization.</p>
            )}
            {tasks.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {tasks.map((t) => (
                  <li key={t.id} className="p-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {t.name}{" "}
                            <span className="text-xs text-muted-foreground font-normal">
                              · {t.is_active === false ? "inactive" : "active"}
                            </span>
                          </p>
                          {((t.required_hardware_tags?.length ?? 0) > 0 || (t.preferred_hardware_tags?.length ?? 0) > 0) && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {t.required_hardware_tags?.length ? `Requires: ${t.required_hardware_tags.join(", ")}` : null}
                              {t.required_hardware_tags?.length && t.preferred_hardware_tags?.length ? " · " : null}
                              {t.preferred_hardware_tags?.length ? `Preferred: ${t.preferred_hardware_tags.join(", ")}` : null}
                            </p>
                          )}
                          {t.instructions && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{t.instructions}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium">{t.bounty_cents ? `$${(t.bounty_cents / 100).toFixed(2)}` : "—"}</p>
                          <p className="text-xs text-muted-foreground">bounty</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Link
                          href={`/capture?organizationId=${encodeURIComponent(t.organization_id)}&taskId=${encodeURIComponent(t.id)}`}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
                        >
                          Preview in capture
                        </Link>
                        <Button variant="secondary" onClick={() => startEdit(t)} disabled={!canManage}>
                          Edit
                        </Button>
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


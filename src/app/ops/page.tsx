"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type JobRow = {
  id: string;
  created_at: string;
  updated_at: string;
  organization_id: string;
  kind: string;
  status: string;
  session_id: string | null;
  attempts: number;
  error: string | null;
  organizations: { name: string } | null;
};

type ArtifactRow = {
  id: string;
  created_at: string;
  organization_id: string;
  job_id: string;
  type: string;
  file_url: string;
  organizations: { name: string } | null;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export default function OpsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const jobsByOrg = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const j of jobs) {
      const key = j.organizations?.name ?? j.organization_id;
      const arr = map.get(key) ?? [];
      arr.push(j);
      map.set(key, arr);
    }
    return map;
  }, [jobs]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in to view pipeline status.");
        setLoading(false);
        return;
      }

      // Jobs
      const { data: jobsData, error: jobsErr } = await supabase
        .from("ml_jobs")
        .select(
          "id, created_at, updated_at, organization_id, kind, status, session_id, attempts, error, organizations(name)"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (jobsErr) {
        setError(jobsErr.message);
        setLoading(false);
        return;
      }

      // Artifacts
      const { data: artData, error: artErr } = await supabase
        .from("ml_artifacts")
        .select("id, created_at, organization_id, job_id, type, file_url, organizations(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (artErr) {
        setError(artErr.message);
        setLoading(false);
        return;
      }

      setJobs((jobsData as JobRow[]) ?? []);
      setArtifacts((artData as ArtifactRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
      <div className="container max-w-3xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Pipeline ops</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Job + artifact status for processing/training/evaluation. (You’ll only see orgs you belong to.)
        </p>

        <div className="flex gap-2 mb-4">
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
            New recording
          </Link>
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
            {error && <p className="text-sm text-destructive py-4">{error}</p>}
            {!loading && !error && jobs.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No jobs yet.</p>
            )}
            {!loading && !error && jobs.length > 0 && (
              <div className="space-y-6">
                {Array.from(jobsByOrg.entries()).map(([orgName, orgJobs]) => (
                  <div key={orgName}>
                    <p className="text-sm font-medium mb-2">{orgName}</p>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {orgJobs.slice(0, 20).map((j) => (
                        <li key={j.id} className="p-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-medium">{j.kind}</span>
                              <span className="text-xs rounded-md border border-border px-2 py-0.5">
                                {j.status}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                attempts: {j.attempts}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              created {formatDateTime(j.created_at)} · updated {formatDateTime(j.updated_at)}
                            </p>
                            {j.session_id && (
                              <p className="text-xs text-muted-foreground font-mono">
                                session {j.session_id}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground font-mono">{j.id}</p>
                            {j.error && (
                              <p className="text-xs text-destructive wrap-break-word">{j.error}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent artifacts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
            {error && <p className="text-sm text-destructive py-4">{error}</p>}
            {!loading && !error && artifacts.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No artifacts yet.</p>
            )}
            {!loading && !error && artifacts.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {artifacts.slice(0, 30).map((a) => (
                  <li key={a.id} className="p-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">{a.type}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.organizations?.name ?? a.organization_id}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(a.created_at)} · job{" "}
                        <span className="font-mono">{a.job_id}</span>
                      </p>
                      <a
                        href={a.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline break-all"
                      >
                        {a.file_url}
                      </a>
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


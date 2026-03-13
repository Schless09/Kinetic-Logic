"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import type { Organization } from "@/types/database";

const isSupabaseConfigured = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (
    typeof url === "string" &&
    url.length > 0 &&
    !url.includes("placeholder") &&
    typeof key === "string" &&
    key.length > 0 &&
    !key.includes("placeholder")
  );
};

const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

export function SignUpForm() {
  const configOk = useMemo(isSupabaseConfigured, []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgSlugFromUrl = searchParams.get("organization") ?? searchParams.get("vendor");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [inviteOrg, setInviteOrg] = useState<Organization | null>(null);
  const [joinableOrgs, setJoinableOrgs] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>(DEFAULT_ORGANIZATION_ID);
  const [organizationsLoading, setOrganizationsLoading] = useState(true);

  useEffect(() => {
    if (!configOk) {
      setOrganizationsLoading(false);
      return;
    }
    (async () => {
      if (orgSlugFromUrl) {
        const { data } = await supabase
          .from("organizations")
          .select("id, name, slug, allow_open_signup")
          .eq("slug", orgSlugFromUrl)
          .single();
        if (data) {
          setInviteOrg(data as Organization);
          setSelectedOrganizationId(data.id);
        }
      } else {
        const { data } = await supabase
          .from("organizations")
          .select("id, name, slug, allow_open_signup")
          .eq("allow_open_signup", true)
          .order("name");
        setJoinableOrgs((data as Organization[]) ?? []);
        if (data?.length) setSelectedOrganizationId(data[0].id);
      }
      setOrganizationsLoading(false);
    })();
  }, [configOk, orgSlugFromUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          organization_id: selectedOrganizationId,
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          phone_country: phoneCountry || undefined,
          phone_number: phoneNumber.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setLoading(false);
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
        return;
      }
      if (json.session) {
        await supabase.auth.setSession({
          access_token: json.session.access_token,
          refresh_token: json.session.refresh_token,
        });
      }
      router.push("/capture");
      router.refresh();
    } catch (err) {
      setLoading(false);
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Failed to fetch" || err instanceof TypeError) {
        setError(
          "Could not reach the server. Is the dev server running? Try: npm run dev"
        );
      } else {
        setError(message);
      }
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      {!configOk && (
        <div className="mb-4 w-full max-w-sm rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>Supabase not configured.</strong> Add <code className="rounded bg-black/10 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-black/10 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="rounded bg-black/10 px-1">.env.local</code> (one per line), then restart the dev server.
        </div>
      )}
      {configOk && process.env.NODE_ENV === "development" && (
        <p className="mb-2 text-xs text-muted-foreground">
          Using: {process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "").split("/")[0]}
        </p>
      )}
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign up</CardTitle>
          <p className="text-sm text-muted-foreground">
            {inviteOrg
              ? `You're joining ${inviteOrg.name}`
              : "Create a Kinetic Logic account"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!organizationsLoading && !inviteOrg && joinableOrgs.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="organization">Organization</Label>
                <select
                  id="organization"
                  value={selectedOrganizationId}
                  onChange={(e) => setSelectedOrganizationId(e.target.value)}
                  className={cn(
                    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  )}
                >
                  {joinableOrgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name">First name</Label>
                <Input
                  id="first_name"
                  type="text"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last name</Label>
                <Input
                  id="last_name"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Phone (optional)</Label>
              <div className="flex gap-2">
                <select
                  aria-label="Country"
                  value={phoneCountry}
                  onChange={(e) => setPhoneCountry(e.target.value)}
                  className={cn(
                    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    "min-w-28"
                  )}
                >
                  <option value="">Country</option>
                  {COUNTRIES.map((c) => (
                    <option key={`${c.name}-${c.dial}`} value={c.dial}>
                      {c.name} {c.dial}
                    </option>
                  ))}
                </select>
                <Input
                  type="tel"
                  placeholder="123 456 7890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  autoComplete="tel-national"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Sign up"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-primary underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
      <Link href="/" className="mt-6 text-sm text-muted-foreground hover:text-foreground">
        ← Back to home
      </Link>
    </main>
  );
}

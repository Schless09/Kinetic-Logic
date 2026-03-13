"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { COUNTRIES } from "@/lib/countries";
import { getConsentAgreementText, CONSENT_VERSION } from "@/lib/consent-agreement";
import { cn } from "@/lib/utils";

async function sha256Hex(message: string): Promise<string> {
  const buf = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsConsent, setNeedsConsent] = useState(true);
  const [recordingCountry, setRecordingCountry] = useState("");
  const [recordingRegion, setRecordingRegion] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [enhancedDataRelease, setEnhancedDataRelease] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const locationDisplay =
    [recordingRegion, recordingCountry].filter(Boolean).join(", ") || "City, Country";

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/sign-in?redirect=/onboarding");
        return;
      }
      const { data: consents } = await supabase
        .from("expert_consents")
        .select("id")
        .eq("profile_id", user.id)
        .limit(1);
      if (consents?.length) {
        setNeedsConsent(false);
        router.replace("/capture");
        return;
      }
      setLoading(false);
    })();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreed || !recordingCountry.trim() || !signature.trim()) {
      setError("Please fill in required fields and agree to the agreement.");
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Session expired. Please sign in again.");
        setSubmitting(false);
        return;
      }
      const signedAt = new Date().toISOString();
      const payload = `${CONSENT_VERSION}\n${signedAt}\n${user.id}\n${signature.trim()}`;
      const signatureHash = await sha256Hex(payload);

      const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
      const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).single();
      if (!profile) {
        const { error: profileErr } = await supabase.from("profiles").insert({
          id: user.id,
          email: user.email ?? "",
          role: "expert",
          organization_id: DEFAULT_ORG_ID,
        });
        if (profileErr) {
          setError(profileErr.message || "Could not create profile. Contact support.");
          setSubmitting(false);
          return;
        }
        await supabase.from("profile_organizations").insert({
          profile_id: user.id,
          organization_id: DEFAULT_ORG_ID,
        });
      }

      const { error: insertError } = await supabase.from("expert_consents").insert({
        profile_id: user.id,
        version: CONSENT_VERSION,
        signed_at: signedAt,
        recording_country: recordingCountry.trim(),
        recording_region: recordingRegion.trim() || null,
        enhanced_data_release: enhancedDataRelease,
        signature_hash: signatureHash,
      });
      if (insertError) {
        setError(insertError.message);
        setSubmitting(false);
        return;
      }
      router.replace("/capture");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!needsConsent) return null;

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expert Data Contribution & Release</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Complete this agreement once before recording. Your consent is attached to each session for data provenance.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recording location</CardTitle>
            <p className="text-sm text-muted-foreground">
              Where you will be recording (e.g. city and country). This appears on your signed agreement.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recording_country">Country *</Label>
                <select
                  id="recording_country"
                  required
                  value={recordingCountry}
                  onChange={(e) => setRecordingCountry(e.target.value)}
                  className={cn(
                    "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  )}
                >
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recording_region">City / Region (optional)</Label>
                <Input
                  id="recording_region"
                  type="text"
                  placeholder="e.g. Tashkent"
                  value={recordingRegion}
                  onChange={(e) => setRecordingRegion(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              <div className="space-y-2">
                <Label>Agreement</Label>
                <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {getConsentAgreementText(locationDisplay)}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="rounded border-input"
                  />
                  I have read and agree to the Expert Data Contribution & Release Agreement above.
                </label>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enhancedDataRelease}
                    onChange={(e) => setEnhancedDataRelease(e.target.checked)}
                    className="rounded border-input"
                  />
                  Enhanced Data Release (optional): I allow my data to be shared without face-blurring or other anonymization, as described in the agreement.
                </label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signature">Full name (to sign) *</Label>
                <Input
                  id="signature"
                  type="text"
                  placeholder="Type your full legal name"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  required
                  className="max-w-xs font-medium"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? "Submitting…" : "Sign and continue"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/capture" className="text-primary underline underline-offset-4">
            ← Back to capture
          </Link>
          {" · "}
          You must complete this agreement before recording.
        </p>
      </div>
    </main>
  );
}

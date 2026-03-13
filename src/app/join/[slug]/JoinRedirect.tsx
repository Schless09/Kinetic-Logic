"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Invite link: /join/data-gym → redirects to sign-up with organization pre-selected.
 */
export function JoinRedirect() {
  const router = useRouter();
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";

  useEffect(() => {
    if (slug) {
      router.replace(`/sign-up?organization=${encodeURIComponent(slug)}`);
    } else {
      router.replace("/sign-up");
    }
  }, [slug, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Redirecting to sign up…</p>
    </main>
  );
}

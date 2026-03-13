"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function HomeAuthLinks() {
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u ?? null);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    window.location.href = "/";
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-muted-foreground">{user.email}</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Task board
          </Link>
          <Link
            href="/capture"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Record
          </Link>
          <Link
            href="/review"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Review
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            My recordings
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Link
        href="/sign-in"
        className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
      >
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Sign up
      </Link>
    </div>
  );
}

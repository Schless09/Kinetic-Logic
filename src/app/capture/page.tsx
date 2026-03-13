"use client";

import { Suspense } from "react";
import { CapturePageInner } from "./CapturePageInner";

export default function CapturePageWrapper() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen safe-area-padding pb-8 md:pb-12">
          <div className="container max-w-lg mx-auto px-4 pt-6">
            <p className="text-sm text-muted-foreground">Loading capture…</p>
          </div>
        </main>
      }
    >
      <CapturePageInner />
    </Suspense>
  );
}


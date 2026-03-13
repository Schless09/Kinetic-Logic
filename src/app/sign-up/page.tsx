import { Suspense } from "react";
import { SignUpForm } from "./SignUpForm";

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <SignUpForm />
    </Suspense>
  );
}

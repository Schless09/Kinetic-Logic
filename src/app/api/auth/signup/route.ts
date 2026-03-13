import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { formatPhoneWithCountry } from "@/lib/countries";

const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("placeholder")) {
    return NextResponse.json(
      { error: "Server: Supabase not configured" },
      { status: 500 }
    );
  }

  let body: {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    phone_country?: string;
    phone_number?: string;
    organization_id?: string;
    vendor_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password, first_name, last_name, phone_country, phone_number, organization_id: bodyOrgId, vendor_id: bodyVendorId } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 }
    );
  }

  const supabaseAnon = createClient(url, key);
  const orgId = (bodyOrgId ?? bodyVendorId)?.trim() || DEFAULT_ORGANIZATION_ID;
  const { data: org } = await supabaseAnon.from("organizations").select("id").eq("id", orgId).single();
  const resolvedOrganizationId = org?.id ?? DEFAULT_ORGANIZATION_ID;

  const supabase = createClient(url, key);
  let result: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    result = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
  } catch (err) {
    const cause = err instanceof Error && "cause" in err ? (err.cause as Error) : null;
    const isDns = cause?.message?.includes("ENOTFOUND") ?? false;
    return NextResponse.json(
      {
        error: isDns
          ? "Could not reach Supabase (DNS failed). Check: 1) Supabase Dashboard → your project is not paused (Restore if needed). 2) Project URL in .env.local matches Dashboard → Settings → API."
          : (err instanceof Error ? err.message : "Network error"),
      },
      { status: 502 }
    );
  }

  const { data, error: signUpError } = result;
  if (signUpError) {
    return NextResponse.json({ error: signUpError.message }, { status: 400 });
  }
  if (!data.user) {
    return NextResponse.json({ error: "Sign up failed" }, { status: 500 });
  }

  const phone =
    phone_country && phone_number?.trim()
      ? formatPhoneWithCountry(phone_country, phone_number.trim())
      : null;

  // Insert profile as the new user (RLS requires auth.uid() = id)
  if (data.session?.access_token && data.session?.refresh_token) {
    const userClient = createClient(url, key);
    await userClient.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    await userClient.from("profiles").insert({
      id: data.user.id,
      email: data.user.email ?? email,
      role: "expert",
      organization_id: resolvedOrganizationId,
      first_name: first_name?.trim() || null,
      last_name: last_name?.trim() || null,
      phone,
    });
    await userClient.from("profile_organizations").insert({
      profile_id: data.user.id,
      organization_id: resolvedOrganizationId,
    });
  }

  return NextResponse.json({
    session: data.session,
    user: data.user,
  });
}

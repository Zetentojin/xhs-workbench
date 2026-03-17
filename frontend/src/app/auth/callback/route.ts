import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedOtpTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function safeNextPath(nextValue: string | null) {
  if (!nextValue || !nextValue.startsWith("/")) {
    return "/";
  }
  return nextValue;
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return Boolean(value && allowedOtpTypes.has(value as EmailOtpType));
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const nextPath = safeNextPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(nextPath, requestUrl.origin);
  const response = NextResponse.redirect(redirectUrl);
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient(response, cookieStore);

  if (!supabase) {
    redirectUrl.searchParams.set("auth", "missing-config");
    return NextResponse.redirect(redirectUrl);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      redirectUrl.searchParams.set("auth", "error");
      return NextResponse.redirect(redirectUrl);
    }

    redirectUrl.searchParams.set("auth", "success");
    response.headers.set("Location", redirectUrl.toString());
    return response;
  }

  if (tokenHash && isEmailOtpType(otpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) {
      redirectUrl.searchParams.set("auth", "error");
      return NextResponse.redirect(redirectUrl);
    }

    redirectUrl.searchParams.set("auth", "success");
    response.headers.set("Location", redirectUrl.toString());
    return response;
  }

  if (!code && !tokenHash) {
    redirectUrl.searchParams.set("auth", "missing-code");
    return NextResponse.redirect(redirectUrl);
  }

  redirectUrl.searchParams.set("auth", "error");
  return NextResponse.redirect(redirectUrl);
}

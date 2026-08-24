import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

type AuthMode = "sign-in" | "sign-up" | "verify-sign-up" | "forgot-password" | "verify-recovery" | "reset-password";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export function areSignupsEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

const signupsEnabled = areSignupsEnabled(import.meta.env.VITE_SIGNUPS_ENABLED);
const testMode = import.meta.env.VITE_TEST_MODE?.trim().toLowerCase() === "true";
const testUserEmail = import.meta.env.VITE_TEST_USER_EMAIL?.trim() || "local@test.invalid";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : undefined;
const AUTH_TIMEOUT_MS = 15_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;

function withTimeout<T>(request: PromiseLike<T>, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(request),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(message)), AUTH_TIMEOUT_MS)),
  ]);
}

export function PasswordField({
  label,
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  autoComplete: "current-password" | "new-password";
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  const inputId = label.toLowerCase().replaceAll(" ", "-");

  return <label htmlFor={inputId}>{label}
    <span className="auth-password-field">
      <input
        id={inputId}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={6}
        required
        value={value}
        onChange={event => onChange(event.currentTarget.value)}
      />
      <button
        type="button"
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={visible}
        onClick={() => setVisible(current => !current)}
      >{visible ? "Hide" : "Show"}</button>
    </span>
  </label>;
}

export function AuthGate({ children }: { children(session: Session): ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(testMode ? {
    access_token: "local-test-token",
    token_type: "bearer",
    expires_in: 0,
    expires_at: 0,
    refresh_token: "local-test-token",
    user: { id: "local-test-user", email: testUserEmail } as Session["user"],
  } : undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [otpResendAvailableAt, setOtpResendAvailableAt] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(Date.now());

  useEffect(() => {
    if (testMode) return;
    if (!supabase) return setSession(null);
    let active = true;
    void withTimeout(supabase.auth.getSession(), "Could not reach the account service. Check the Supabase browser configuration.")
      .then(({ data }) => { if (active) setSession(data.session); })
      .catch(error => {
        if (!active) return;
        setSession(null);
        setMessage(error instanceof Error ? error.message : "Could not load your account.");
      });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setMode("reset-password");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (otpResendAvailableAt <= Date.now()) return;
    setCooldownNow(Date.now());
    const interval = window.setInterval(() => {
      const now = Date.now();
      setCooldownNow(now);
      if (now >= otpResendAvailableAt) window.clearInterval(interval);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [otpResendAvailableAt]);

  const otpResendSeconds = Math.max(0, Math.ceil((otpResendAvailableAt - cooldownNow) / 1_000));
  const startOtpResendCooldown = (): void => {
    const now = Date.now();
    setCooldownNow(now);
    setOtpResendAvailableAt(now + OTP_RESEND_COOLDOWN_MS);
  };

  if (session === undefined) return <main className="auth-page"><p>Loading account...</p></main>;
  if (session && mode !== "reset-password") return <>
    <div className="account-bar">
      <a href="/replay-history">Replay history</a>
      <a href="/guides">Guides</a>
      <a href="/support">Support</a>
      <span>{session.user.email}</span>
      {!testMode && <button type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button>}
    </div>
    {children(session)}
  </>;

  const changeMode = (nextMode: AuthMode): void => {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setOtp("");
    setOtpResendAvailableAt(0);
    setMessage(undefined);
  };

  const resendOtp = async (): Promise<void> => {
    if (!supabase || otpResendSeconds > 0 || (mode !== "verify-sign-up" && mode !== "verify-recovery")) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      const error = mode === "verify-sign-up"
        ? (await withTimeout(supabase.auth.resend({ type: "signup", email: email.trim() }), "The account service did not respond. Try again.")).error
        : (await withTimeout(supabase.auth.resetPasswordForEmail(email.trim()), "The account service did not respond. Try again.")).error;
      if (error) return setMessage(error.message);
      startOtpResendCooldown();
      setMessage("A new verification code has been sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect to the account service.");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      if (mode === "forgot-password") {
        const result = await withTimeout(
          supabase.auth.resetPasswordForEmail(email.trim()),
          "The account service did not respond. Try again.",
        );
        if (result.error) return setMessage(result.error.message);
        setMode("verify-recovery");
        startOtpResendCooldown();
        setMessage("Enter the six-digit code sent to your email.");
        return;
      }
      if (mode === "verify-sign-up" || mode === "verify-recovery") {
        const result = await withTimeout(supabase.auth.verifyOtp({
          email: email.trim(),
          token: otp,
          type: mode === "verify-sign-up" ? "email" : "recovery",
        }), "The account service did not respond. Try again.");
        if (result.error) return setMessage(result.error.message);
        setOtp("");
        setOtpResendAvailableAt(0);
        if (mode === "verify-recovery") setMode("reset-password");
        return;
      }
      if (mode === "reset-password") {
        if (password !== confirmPassword) return setMessage("Passwords do not match.");
        const result = await withTimeout(supabase.auth.updateUser({ password }), "The account service did not respond. Try again.");
        if (result.error) return setMessage(result.error.message);
        setPassword("");
        setConfirmPassword("");
        setMode("sign-in");
        return;
      }
      if (mode === "sign-up" && !signupsEnabled) {
        setMode("sign-in");
        setMessage("New account registration is temporarily closed.");
        return;
      }
      if (mode === "sign-up" && password !== confirmPassword) return setMessage("Passwords do not match.");
      const request = mode === "sign-in"
        ? supabase.auth.signInWithPassword({ email: email.trim(), password })
        : supabase.auth.signUp({ email: email.trim(), password });
      const result = await withTimeout(request, "The account service did not respond. Check the Supabase browser configuration and try again.");
      if (result.error) return setMessage(result.error.message);
      if (mode === "sign-up" && !result.data.session) {
        setMode("verify-sign-up");
        startOtpResendCooldown();
        setMessage("Enter the six-digit code sent to your email.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect to the account service.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page">
    <form className="auth-card" onSubmit={event => void submit(event)}>
      <p className="eyebrow">Replay Lab</p>
      <h1>{mode === "sign-in" ? "Sign in"
        : mode === "sign-up" ? "Create account"
          : mode === "forgot-password" ? "Reset password"
            : mode === "verify-sign-up" ? "Verify your email"
              : mode === "verify-recovery" ? "Enter reset code"
                : "Choose a new password"}</h1>
      <p>{mode === "forgot-password"
        ? "Enter your account email and we will send you a one-time code."
        : mode === "verify-sign-up" || mode === "verify-recovery"
          ? `We sent a six-digit code to ${email}.`
        : mode === "reset-password"
          ? "Use at least six characters for your new password."
          : "Your account keeps player scans limited to replays you uploaded."}</p>
      {!supabase && <p className="auth-error">Supabase browser authentication is not configured.</p>}
      {(mode === "sign-in" || mode === "sign-up" || mode === "forgot-password") && <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.currentTarget.value)} /></label>}
      {(mode === "sign-in" || mode === "sign-up" || mode === "reset-password") && <PasswordField
        label={mode === "reset-password" ? "New password" : "Password"}
        value={password}
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        onChange={setPassword}
      />}
      {(mode === "sign-up" || mode === "reset-password") && <PasswordField label="Confirm password" value={confirmPassword} autoComplete="new-password" onChange={setConfirmPassword} />}
      {(mode === "verify-sign-up" || mode === "verify-recovery") && <label>Verification code<input
        className="auth-otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={otp}
        onChange={event => setOtp(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
      /></label>}
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="auth-submit" type="submit" disabled={!supabase || submitting}>{submitting
        ? "Please wait..."
        : mode === "sign-in" ? "Sign in"
          : mode === "sign-up" ? "Create account"
            : mode === "forgot-password" ? "Send reset code"
              : mode === "verify-sign-up" ? "Verify account"
                : mode === "verify-recovery" ? "Verify reset code"
                  : "Save new password"}</button>
      {(mode === "verify-sign-up" || mode === "verify-recovery") && <button className="auth-switch" type="button" disabled={submitting || otpResendSeconds > 0} onClick={() => void resendOtp()}>
        {otpResendSeconds > 0 ? `Resend code in ${otpResendSeconds}s` : "Resend code"}
      </button>}
      {mode === "sign-in" && <button className="auth-switch" type="button" onClick={() => changeMode("forgot-password")}>Forgot password?</button>}
      {mode === "sign-in" && !signupsEnabled && <p className="auth-registration-closed">New account registration is temporarily closed.</p>}
      {mode !== "reset-password" && (mode !== "sign-in" || signupsEnabled) && <button className="auth-switch" type="button" onClick={() => changeMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
        {mode === "sign-up" ? "Already have an account? Sign in" : mode === "sign-in" ? "Need an account? Sign up" : "Back to sign in"}
      </button>}
    </form>
  </main>;
}

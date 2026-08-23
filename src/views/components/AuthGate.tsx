import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

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

function withTimeout<T>(request: PromiseLike<T>, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(request),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(message)), AUTH_TIMEOUT_MS)),
  ]);
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
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot-password" | "reset-password">("sign-in");
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

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

  if (session === undefined) return <main className="auth-page"><p>Loading account...</p></main>;
  if (session && mode !== "reset-password") return <>
    <div className="account-bar">
      <a href="/replay-history">Replay history</a>
      <a href="/support">Support</a>
      <span>{session.user.email}</span>
      {!testMode && <button type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button>}
    </div>
    {children(session)}
  </>;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setMessage(undefined);
    try {
      if (mode === "forgot-password") {
        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const result = await withTimeout(
          supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo }),
          "The account service did not respond. Try again.",
        );
        if (result.error) return setMessage(result.error.message);
        setMessage("If an account exists for that email, a password reset link is on its way.");
        return;
      }
      if (mode === "reset-password") {
        const result = await withTimeout(supabase.auth.updateUser({ password }), "The account service did not respond. Try again.");
        if (result.error) return setMessage(result.error.message);
        setPassword("");
        setMode("sign-in");
        return;
      }
      if (mode === "sign-up" && !signupsEnabled) {
        setMode("sign-in");
        setMessage("New account registration is temporarily closed.");
        return;
      }
      const request = mode === "sign-in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
      const result = await withTimeout(request, "The account service did not respond. Check the Supabase browser configuration and try again.");
      if (result.error) return setMessage(result.error.message);
      if (mode === "sign-up" && !result.data.session) setMessage("Check your email to confirm your account, then sign in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect to the account service.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page">
    <form className="auth-card" onSubmit={event => void submit(event)}>
      <p className="eyebrow">Replay Lab</p>
      <h1>{mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : mode === "forgot-password" ? "Reset password" : "Choose a new password"}</h1>
      <p>{mode === "forgot-password"
        ? "Enter your account email and we will send you a secure reset link."
        : mode === "reset-password"
          ? "Use at least six characters for your new password."
          : "Your account keeps player scans limited to replays you uploaded."}</p>
      {!supabase && <p className="auth-error">Supabase browser authentication is not configured.</p>}
      {mode !== "reset-password" && <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.currentTarget.value)} /></label>}
      {mode !== "forgot-password" && <label>Password<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={event => setPassword(event.currentTarget.value)} /></label>}
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="auth-submit" type="submit" disabled={!supabase || submitting}>{submitting
        ? "Please wait..."
        : mode === "sign-in" ? "Sign in"
          : mode === "sign-up" ? "Create account"
            : mode === "forgot-password" ? "Send reset link"
              : "Save new password"}</button>
      {mode === "sign-in" && <button className="auth-switch" type="button" onClick={() => { setMode("forgot-password"); setMessage(undefined); }}>Forgot password?</button>}
      {mode === "sign-in" && !signupsEnabled && <p className="auth-registration-closed">New account registration is temporarily closed.</p>}
      {mode !== "reset-password" && (mode !== "sign-in" || signupsEnabled) && <button className="auth-switch" type="button" onClick={() => { setMode(mode === "sign-up" ? "sign-in" : mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(undefined); }}>
        {mode === "sign-up" ? "Already have an account? Sign in" : mode === "sign-in" ? "Need an account? Sign up" : "Back to sign in"}
      </button>}
    </form>
  </main>;
}

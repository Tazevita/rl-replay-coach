# rl-replay-coach

## Supabase email OTP setup

Account confirmation and password recovery use six-digit email codes. In Supabase Dashboard, update both templates under **Authentication > Email Templates**:

- **Confirm signup**: use subject `{{ .Token }} is your Replay Lab verification code` and paste `supabase/templates/confirm-signup.html` as the body.
- **Reset password**: use subject `{{ .Token }} is your Replay Lab password reset code` and paste `supabase/templates/reset-password.html` as the body.

Keep email confirmation enabled. Supabase generates the code and the app verifies it with `verifyOtp`; no redirect URL is required for either flow.

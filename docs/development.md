# Development

Use Node `^20.19.0` or `>=22.12.0`. Install the locked dependency graph with `npm ci`.

## Commands

- `npm start` starts Vite and the replay API on port 4173.
- `npm test` runs Vitest domain, application, adapter, contract, and React component tests.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run test:smoke` runs the intercepted Playwright browser smoke test.
- `npm run build` type-checks and creates the production Vite bundle.

The upload API expects the sibling `rocket-league-prediction-model` repository beside this repository. It uses that repository's `rrrocket`, Python virtual environment, and goal runner without modifying them. These external prerequisites are needed only for real upload processing. The browser smoke test intercepts both replay endpoints, and routine Vitest/component tests use fakes; neither requires rrrocket, Python, or a prediction model.

The application initially requests `./input/output.json`. That local generated file is ignored by Git and may fail to load in a fresh checkout; uploading a replay can recover from that state. Tests use `smallReplayFixture()` rather than the existing large generated replay artifact.

## Fully local mode

Set `TEST_MODE=true` in `.env` and run `npm start`. This mode does not require Supabase, AWS, R2, SQS, Docker, or an OpenAI key. It uses:

- A fixed local account (`TEST_USER_ID`, default `local-test-user`) with no sign-in screen.
- Prisma with SQLite at `.local-data/replay-coach.sqlite`.
- Parsed replay JSON under `.local-data/replays/`.
- The sibling prediction repository's local `rrrocket` binary and `prediction-model/.venv/bin/python`.

The server creates or updates the local SQLite schema at startup. Set `TEST_DATA_DIR` to move both the database and replay files. Delete that directory to reset all local data. `REPLAY_ANALYSIS_DEVICE` still controls the local model device and defaults to `cpu` on macOS.

Local mode enables OpenAI-backed mistake explanations and player coaching when `OPENAI_API_KEY` is set. Leave it unset to keep development fully local without external API calls. Replay parsing, prediction, history, player lookup, and deletion remain local.

An upload must be a non-empty `.replay` body no larger than 100 MB. Uploaded and parsed temporary files are removed after each attempt. Replay IDs remain available after later uploads and server restarts. Exact duplicate files and player scans are scoped to the authenticated Supabase user ID in `created_by`.

Set server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `REPLAY_PARSER_R2_SECRET_ID` to store metadata, analysis bundles, normalized mistakes, and jobs in Supabase. The parsed replay JSON remains in the private R2 bucket and only its object key is stored on `replays`; the optional AWS region/profile configure access to it. Never expose the secret key or R2 credentials through a `VITE_` variable. Apply the clean schema with `supabase db push` (or run `supabase/migrations/202608190001_initial_replay_persistence.sql` through an authorized migration workflow) before starting the server.

The browser uses direct R2 uploads when `/api/replay-uploads` is available. The local Vite API does not expose that endpoint, so development automatically falls back to its streamed upload route and local or Lambda parser adapter.

`GET /api/player-mistakes?username=...` returns disagreement mistakes from gameplay uploaded by the active creator, including mistakes that were not sustained across multiple analysis samples. `vite preview` is not a static-only deployment because it also installs the local replay API and therefore needs the external tools for real uploads.

## Mistake explanations

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to enable mistake explanations and player coaching, including in local test mode. The server uses `gpt-5.6-luna` by default; set `OPENAI_MISTAKE_MODEL` if the account uses a different OpenAI model ID. `OPENAI_MISTAKE_TIMEOUT_MS` optionally changes the 30-second request timeout. These values are server-only and must never use a `VITE_` prefix.

`POST /api/player-mistakes/:id/explanation` sends up to 12 seconds of goal-clipped replay context ending at the associated goal to the OpenAI Responses API. The prompt requests no more than two short coaching sentences grounded in the player's position, the ball, a named teammate, and a named opponent, followed by how the decision contributed to the goal. The first successful response for the current prompt version is stored on the active persistence adapter's mistake row with its model, generation time, and prompt version; later requests return that saved response without another model call. The endpoint returns 503 when no API key is configured.

## Vercel deployment

Apply all Supabase migrations before deployment. The serverless upload flow depends on the replay-job metadata and claim functions in `supabase/migrations/202608190002_serverless_replay_jobs.sql`.

Configure these Vercel variables:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser authentication.
- Account registration is enabled by default. Set `VITE_SIGNUPS_ENABLED=false` to close it without removing the signup flow.
- Server-only `SUPABASE_SECRET_KEY` for API functions. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` may be set explicitly; otherwise the API reuses the corresponding browser-safe `VITE_SUPABASE_*` values.
- `REPLAY_PARSER_QUEUE_URL`, `REPLAY_PARSER_R2_SECRET_ID`, and `AWS_REGION` for replay processing.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` with permission to read the configured Secrets Manager secret and send to the parser SQS queue. Do not set `AWS_PROFILE` on Vercel.

The private R2 bucket must allow browser `PUT` and `GET` requests from the deployed site. Configure bucket CORS with the actual production and preview origins:

```json
[
  {
    "AllowedOrigins": ["https://YOUR_APP.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type", "x-amz-meta-sha256"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replay source bodies and parsed replay JSON bypass Vercel request and response size limits through signed R2 URLs. Vercel functions only initialize uploads, dispatch SQS messages, reconcile output objects, and serve metadata.

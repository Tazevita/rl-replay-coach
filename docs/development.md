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

An upload must be a non-empty `.replay` body no larger than 100 MB. Uploaded and parsed temporary files are removed after each attempt. Replay IDs remain available after later uploads and server restarts. Exact duplicate files and player scans are scoped to the authenticated Supabase user ID in `created_by`.

Set server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `REPLAY_PARSER_R2_SECRET_ID` to store metadata, analysis bundles, normalized mistakes, and jobs in Supabase. The parsed replay JSON remains in the private R2 bucket and only its object key is stored on `replays`; the optional AWS region/profile configure access to it. Never expose the secret key or R2 credentials through a `VITE_` variable. Apply the clean schema with `supabase db push` (or run `supabase/migrations/202608190001_initial_replay_persistence.sql` through an authorized migration workflow) before starting the server.

The upload lock is process-wide. Running multiple Vite server processes against the same output path is unsupported.

`GET /api/player-mistakes?username=...` returns sustained mistakes from gameplay uploaded by the active creator. `vite preview` is not a static-only deployment because it also installs the local replay API and therefore needs the external tools for real uploads.

## Mistake explanations

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to enable the **Explain mistake** button. The server uses `gpt-5.6-luna` by default; set `OPENAI_MISTAKE_MODEL` if the account uses a different OpenAI model ID. `OPENAI_MISTAKE_TIMEOUT_MS` optionally changes the 30-second request timeout. These values are server-only and must never use a `VITE_` prefix.

`POST /api/player-mistakes/:id/explanation` sends the saved, goal-clipped replay context from the 12 seconds preceding the mistake to the OpenAI Responses API. The prompt requests no more than two short coaching sentences. The first successful response is stored on the active persistence adapter's mistake row with its model, generation time, and prompt version; later requests return that saved response without another model call. The endpoint returns 503 when no API key is configured.

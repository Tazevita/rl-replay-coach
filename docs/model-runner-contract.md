# Model Runner Contract

The sibling model emits structured goal analysis and player predictions together as JSON. `ReplayAnalysisRunnerJsonAdapter` validates that output at the analysis infrastructure boundary. React and the HTTP adapters never parse model output.

There are three distinct contracts:

- The external analysis runner emits the version 1 collection described below.
- The internal `AnalysisProvider` returns team analysis and player predictions to `ProcessReplay`.
- The public `ReplayAnalysisBundleV2` adds replay identity/data URL, timebase, provider provenance, generation time, all analyzed teams, and player predictions. Its Zod schema in `src/shared/contracts/replay-analysis-v2.ts` is authoritative. The runner schema version is validated but not nested in the public collection.

## Prediction Runner Output

```json
{
  "schemaVersion": 1,
  "sampleIntervalSeconds": 0.5,
  "players": [
    {
      "id": "stable-player-id",
      "displayName": "Player name",
      "team": "blue",
      "samples": [
        {
          "anchorSeconds": 12.5,
          "status": "available",
          "horizons": [
            {
              "window": { "startSeconds": 0, "endSeconds": 1 },
              "targetSeconds": 13.5,
              "position": { "x": 100, "y": -200, "z": 17 },
              "forward": { "x": 1, "y": 0, "z": 0 }
            }
          ]
        }
      ]
    }
  ]
}
```

Timestamps are factual seconds from replay start, vectors contain finite `x`, `y`, and `z` components, and sample status is either `available` or `unavailable`.

## Goal Runner Output

The adapter invokes `python -m replay_analysis_service <parsed-replay-path> --all-teams --prediction-interval 1`. The runner emits `{"schemaVersion":1,"teams":[...],"playerPredictions":{...}}`. It reconstructs the replay and runs batched endpoint/intent inference once, then derives both collections from those shared results. Every team already matches `teamAnalysisSchema`; findings include their semantic kind and tone, subject, navigation timestamps, and evidence at the source.

The composite provider identifies both adapters in public provenance. `modelVersion` remains optional when the current runners cannot report it.

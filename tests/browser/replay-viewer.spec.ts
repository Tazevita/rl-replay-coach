import { expect, test } from "@playwright/test";
import { smallReplayFixture } from "../../src/test/replay-fixture";
import { validBundle } from "../../src/test/fixtures";
import type { ReplayAnalysisBundleV2 } from "../../src/shared/contracts/replay-analysis-v2";
import { BALL_TRACKING_KEY } from "../../src/application/controllers/replay-viewer-controller";

test("loads, controls, uploads, analyzes, and navigates without browser errors", async ({ page }) => {
  const browserErrors: Error[] = [];
  page.on("pageerror", error => browserErrors.push(error));
  const replay = smallReplayFixture();
  const bundle: ReplayAnalysisBundleV2 = validBundle();
  bundle.analysis.teams[0].events[0].findings[0].navigation = { anchorSeconds: 12.5, preRollSeconds: 2.5 };
  bundle.analysis.teams[0].events[0].findings[0].subject = { displayName: "Alpha" };
  bundle.analysis.teams[0].events[0].findings[0].text += " (1-2s)";
  await page.route("**/api/replay-uploads", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ filename: "match.replay", size: 7 });
    await route.fulfill({ status: 201, json: {
      jobId: "job-id", status: "uploading", statusUrl: "/api/replay-jobs/job-id",
      dispatchUrl: "/api/replay-jobs/job-id/dispatch", uploadUrl: "https://uploads.example/job-id", uploadHeaders: {},
    } });
  });
  await page.route("https://uploads.example/job-id", route => route.fulfill({ status: 200 }));
  await page.route("**/api/replay-jobs/job-id/dispatch", route => route.fulfill({
    status: 202, json: { jobId: "job-id", status: "processing" },
  }));
  await page.route("**/api/replay-jobs/job-id", route => route.fulfill({
    json: { jobId: "job-id", status: "completed", result: bundle },
  }));
  await page.route("**/api/replays/opaque-id", route => route.fulfill({ json: bundle }));
  await page.route("**/api/replays/opaque-id/data", route => route.fulfill({ json: replay }));

  await page.goto("/?replay=opaque-id");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("DFH Stadium");
  await expect(page.getByLabel("Match score")).toContainText("BLUE");
  await expect(page.getByLabel("Overhead Rocket League field replay")).toBeVisible();
  await expect(page.locator(".render-surface:not(.hidden) canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Play replay" }).click();
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
  await page.getByRole("button", { name: "3D" }).click();
  await expect(page.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("3D Rocket League field replay")).toBeVisible();
  await expect(page.locator(".render-surface:not(.hidden) canvas")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Auto Cam" })).toHaveCount(0);
  await page.getByLabel("Autotrack").selectOption(BALL_TRACKING_KEY);
  await expect(page.getByLabel("Autotrack")).toHaveValue(BALL_TRACKING_KEY);
  await expect(page.locator(".render-surface:not(.hidden) canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "2D" }).click();
  await page.getByLabel("Upload replay").setInputFiles({ name: "match.replay", mimeType: "application/octet-stream", buffer: Buffer.from("fixture") });
  await expect(page.getByText("Blue team").last()).toBeVisible();
  await expect(page.getByText("Alpha finished the play.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Show projected cars" }).check();
  await page.getByLabel("Prediction timeframe").selectOption("2-3.5");
  await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Alpha" }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Alpha" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Show projected cars" }).uncheck();
  await page.getByRole("checkbox", { name: "Auto-switch projection" }).check();
  await page.getByRole("checkbox", { name: "Auto-switch camera" }).check();
  await page.getByRole("button", { name: /Alpha finished the play/ }).click();
  await expect(page.getByRole("checkbox", { name: "Show projected cars" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
  await expect(page.getByLabel("Prediction timeframe")).toHaveValue("1-2");
  await expect(page.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Autotrack")).toHaveValue("0:Alpha");
  expect(browserErrors).toEqual([]);
});

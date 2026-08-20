import { describe, expect, it } from "vitest";
import { awsCredentialOptions } from "./aws-credentials";

describe("awsCredentialOptions", () => {
  it("prefers explicit environment credentials over a local profile", () => {
    expect(awsCredentialOptions({
      AWS_ACCESS_KEY_ID: "access-key",
      AWS_SECRET_ACCESS_KEY: "secret-key",
      AWS_SESSION_TOKEN: "session-token",
      AWS_PROFILE: "rrrocket",
    })).toEqual({
      credentials: {
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        sessionToken: "session-token",
      },
    });
  });

  it("uses a profile when environment credentials are absent", () => {
    expect(awsCredentialOptions({ AWS_PROFILE: " rrrocket " })).toEqual({ profile: "rrrocket" });
  });

  it("rejects an incomplete environment credential pair", () => {
    expect(() => awsCredentialOptions({ AWS_ACCESS_KEY_ID: "access-key" })).toThrow(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be configured.",
    );
  });
});

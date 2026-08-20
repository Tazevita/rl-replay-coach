export interface StaticAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AwsCredentialOptions {
  credentials?: StaticAwsCredentials;
  profile?: string;
}

export function awsCredentialOptions(environment: Record<string, string | undefined>): AwsCredentialOptions {
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim();
  if (accessKeyId || secretAccessKey) {
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be configured.");
    }
    return {
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: environment.AWS_SESSION_TOKEN?.trim() || undefined,
      },
    };
  }
  return { profile: environment.AWS_PROFILE?.trim() || undefined };
}

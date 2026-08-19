import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  stdoutPath?: string;
  timeoutMs?: number;
}

export type ProcessRunner = (request: ProcessRequest) => Promise<string>;

export const runProcess: ProcessRunner = async ({ command, args, cwd, stdoutPath, timeoutMs }) => {
  const stdoutFile = stdoutPath ? await open(stdoutPath, "w") : undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", stdoutFile ? stdoutFile.fd : "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }, timeoutMs);
      child.stdout?.on("data", chunk => { stdout += chunk; });
      child.stderr?.on("data", chunk => { stderr += chunk; });
      child.on("error", error => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.on("close", code => {
        if (timeout) clearTimeout(timeout);
        if (timedOut) {
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
          return;
        }
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with status ${code}`));
      });
    });
  } finally {
    await stdoutFile?.close();
  }
};

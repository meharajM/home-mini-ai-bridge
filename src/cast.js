import { spawn } from "node:child_process";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const DEFAULT_SCRIPT = fileURLToPath(new URL("../python/cast_audio.py", import.meta.url));

export function createCastPlayer({
  ip,
  pythonCommand = "python3",
  scriptPath = DEFAULT_SCRIPT,
  spawnProcess = spawn,
  timeoutMs = 40_000,
}) {
  if (!ip || !isIP(ip)) throw new Error("CAST_DEVICE_IP must be an IP address when casting is enabled");

  return (audioUrl) => new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(audioUrl);
    } catch {
      reject(new Error("Cast audio URL must be an absolute HTTP URL"));
      return;
    }
    if (!(["http:", "https:"].includes(parsedUrl.protocol)) || parsedUrl.username || parsedUrl.password) {
      reject(new Error("Cast audio URL must be an absolute HTTP URL without credentials"));
      return;
    }

    const child = spawnProcess(pythonCommand, [scriptPath, ip, parsedUrl.toString()], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Cast playback timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }

    child.stderr?.on("data", (chunk) => {
      if (errorOutput.length < 1024) errorOutput += chunk.toString("utf8").slice(0, 1024 - errorOutput.length);
    });
    child.once("error", (error) => finish(new Error(`Could not start Cast helper: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (code === 0) return finish();
      const detail = errorOutput.trim().split("\n").at(-1);
      finish(new Error(`Cast helper exited ${code ?? signal ?? "unexpectedly"}${detail ? `: ${detail}` : ""}`));
    });
  });
}

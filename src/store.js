import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const summariesPath = path.join(config.dataDir, "summaries.json");
const rateLimitPath = path.join(config.dataDir, "rate-limit.json");

let slotLock = Promise.resolve();

export async function getSummary(clipId) {
  const summaries = await readJson(summariesPath, {});
  return summaries[clipId] || null;
}

export async function listSummaries() {
  return readJson(summariesPath, {});
}

export async function saveSummary(clipId, summaryRecord) {
  const summaries = await readJson(summariesPath, {});
  summaries[clipId] = summaryRecord;
  await writeJson(summariesPath, summaries);
  return summaryRecord;
}

export async function reserveSummaryGenerationSlot(now = Date.now()) {
  let releaseLock;
  const previousLock = slotLock;
  slotLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;

  try {
    const state = await readJson(rateLimitPath, {});
    const lastStartedAt = Number(state.lastStartedAt || 0);
    const elapsed = now - lastStartedAt;

    if (lastStartedAt && elapsed < config.summaryIntervalMs) {
      const retryAfterMs = config.summaryIntervalMs - elapsed;
      throw new RateLimitError(
        "A new summary can be generated only once per minute.",
        retryAfterMs
      );
    }

    await writeJson(rateLimitPath, {
      lastStartedAt: now,
      lastStartedAtIso: new Date(now).toISOString()
    });
  } finally {
    releaseLock();
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
}

export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  }
}

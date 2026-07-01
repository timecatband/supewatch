import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv(path.join(rootDir, ".env"));

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  publicDir: path.join(rootDir, "public"),
  port: numberFromEnv("PORT", 3000),
  granicusRssUrl:
    process.env.GRANICUS_RSS_URL ||
    "https://sanfrancisco.granicus.com/ViewPublisherRSS.php?view_id=10",
  granicusViewId: process.env.GRANICUS_VIEW_ID || "10",
  meetingCacheTtlMs: numberFromEnv("MEETING_CACHE_TTL_MS", 10 * 60 * 1000),
  summaryIntervalMs: numberFromEnv("SUMMARY_INTERVAL_MS", 60 * 1000),
  maxTranscriptChars: numberFromEnv("MAX_TRANSCRIPT_CHARS", 300000),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  openAiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  openAiReasoningEffort: process.env.OPENAI_REASONING_EFFORT || "low",
  openAiMaxOutputTokens: numberFromEnv("OPENAI_MAX_OUTPUT_TOKENS", 1800)
};

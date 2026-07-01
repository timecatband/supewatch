import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const meetingsCachePath = path.join(config.dataDir, "meetings-cache.json");

let inMemoryMeetings = null;
let inMemoryFetchedAt = 0;

export function transcriptUrlForClipId(clipId) {
  return `https://sanfrancisco.granicus.com/TranscriptViewer.php?view_id=${encodeURIComponent(
    config.granicusViewId
  )}&clip_id=${encodeURIComponent(clipId)}`;
}

export async function getKnownMeetings({ forceRefresh = false } = {}) {
  const now = Date.now();
  const cacheIsFresh =
    inMemoryMeetings && now - inMemoryFetchedAt < config.meetingCacheTtlMs;

  if (!forceRefresh && cacheIsFresh) {
    return inMemoryMeetings;
  }

  try {
    const response = await fetch(config.granicusRssUrl, {
      headers: {
        "User-Agent": "Supewatch/0.1 (+https://sanfrancisco.granicus.com)"
      }
    });

    if (!response.ok) {
      throw new Error(`Granicus RSS returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    const meetings = parseRssMeetings(xml);

    if (meetings.length === 0) {
      throw new Error("No meetings found in Granicus RSS");
    }

    inMemoryMeetings = meetings;
    inMemoryFetchedAt = now;
    await writeJson(meetingsCachePath, {
      fetchedAt: new Date(now).toISOString(),
      meetings
    });

    return meetings;
  } catch (error) {
    const cached = await readJson(meetingsCachePath, null);
    if (cached?.meetings?.length) {
      inMemoryMeetings = cached.meetings;
      inMemoryFetchedAt = now;
      return cached.meetings;
    }

    throw error;
  }
}

export async function findKnownMeeting(clipId) {
  if (!/^\d+$/.test(clipId)) return null;
  const meetings = await getKnownMeetings();
  return meetings.find((meeting) => meeting.clipId === clipId) || null;
}

export async function fetchTranscript(meeting) {
  const response = await fetch(meeting.transcriptUrl, {
    headers: {
      "User-Agent": "Supewatch/0.1 (+https://sanfrancisco.granicus.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`Transcript returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const transcript = extractTranscriptText(html);

  if (transcript.length < 100) {
    throw new Error("Transcript page did not contain enough text to summarize");
  }

  return transcript;
}

export function parseRssMeetings(xml) {
  const itemMatches = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];

  return itemMatches
    .map((match) => {
      const itemXml = match[1];
      const link = decodeEntities(extractTag(itemXml, "link"));
      const clipMatch = link.match(/[?&]clip_id=(\d+)/);
      if (!clipMatch) return null;

      const clipId = clipMatch[1];
      return {
        clipId,
        guid: decodeEntities(extractTag(itemXml, "guid")),
        title: decodeEntities(extractTag(itemXml, "title")),
        pubDate: decodeEntities(extractTag(itemXml, "pubDate")),
        mediaUrl: link,
        transcriptUrl: transcriptUrlForClipId(clipId)
      };
    })
    .filter(Boolean);
}

export function extractTranscriptText(html) {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withLineBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(withLineBreaks)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "") : "";
}

export function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16))
    );
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

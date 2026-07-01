import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { config } from "./config.js";
import {
  fetchTranscript,
  findKnownMeeting,
  getKnownMeetings
} from "./granicus.js";
import {
  SUMMARY_PROMPT_VERSION,
  summarizeTranscript,
  TranscriptTooLargeError
} from "./summarizer.js";
import {
  getSummary,
  listSummaries,
  RateLimitError,
  reserveSummaryGenerationSlot,
  saveSummary
} from "./store.js";

const inFlightSummaries = new Map();

const server = http.createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: "Something went wrong while handling the request."
    });
  }
});

server.listen(config.port, () => {
  console.log(`Supewatch listening on http://localhost:${config.port}`);
});

async function routeRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/api/meetings" && request.method === "GET") {
    const meetings = await getKnownMeetings({
      forceRefresh: url.searchParams.get("refresh") === "1"
    });
    const summaries = await listSummaries();

    return sendJson(response, 200, {
      meetings: meetings.map((meeting) => ({
        ...meeting,
        summaryGenerated: isCurrentSummary(summaries[meeting.clipId])
      }))
    });
  }

  const summaryMatch = url.pathname.match(/^\/api\/meetings\/(\d+)\/summary$/);
  if (summaryMatch && request.method === "POST") {
    return handleSummaryRequest(response, summaryMatch[1]);
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(response, 404, { error: "Not found" });
  }

  return serveStatic(response, url.pathname);
}

async function handleSummaryRequest(response, clipId) {
  const meeting = await findKnownMeeting(clipId);
  if (!meeting) {
    return sendJson(response, 404, {
      error: "Unknown meeting. Summaries can only be generated for clip IDs in the official Board of Supervisors feed."
    });
  }

  const cachedSummary = await getSummary(clipId);
  if (isCurrentSummary(cachedSummary)) {
    return sendJson(response, 200, {
      status: "cached",
      summary: cachedSummary
    });
  }

  if (inFlightSummaries.has(clipId)) {
    try {
      const summary = await inFlightSummaries.get(clipId);
      return sendJson(response, 200, {
        status: "generated",
        summary
      });
    } catch (error) {
      return sendSummaryError(response, error);
    }
  }

  const generationPromise = generateSummary(meeting);
  inFlightSummaries.set(clipId, generationPromise);

  try {
    const summary = await generationPromise;
    return sendJson(response, 200, {
      status: "generated",
      summary
    });
  } catch (error) {
    return sendSummaryError(response, error);
  } finally {
    inFlightSummaries.delete(clipId);
  }
}

function sendSummaryError(response, error) {
  if (error instanceof RateLimitError) {
    return sendJson(
      response,
      429,
      {
        error: error.message,
        retryAfterSeconds: error.retryAfterSeconds
      },
      {
        "Retry-After": String(error.retryAfterSeconds)
      }
    );
  }

  if (error instanceof TranscriptTooLargeError) {
    return sendJson(response, 413, {
      error: "Transcript is too large to summarize with the current server limit."
    });
  }

  throw error;
}

function isCurrentSummary(summary) {
  return summary?.promptVersion === SUMMARY_PROMPT_VERSION;
}

async function generateSummary(meeting) {
  await reserveSummaryGenerationSlot();
  const transcript = await fetchTranscript(meeting);
  const summaryRecord = await summarizeTranscript({ meeting, transcript });
  return saveSummary(meeting.clipId, summaryRecord);
}

async function serveStatic(response, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(config.publicDir, `.${normalizedPath}`);
  const relativePath = path.relative(config.publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return sendText(response, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      ...securityHeaders()
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return sendText(response, 404, "Not found");
    }
    throw error;
  }
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
    ...headers
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...securityHeaders()
  });
  response.end(body);
}

function securityHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' https://webcontent.granicusops.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml"
    }[extension] || "application/octet-stream"
  );
}

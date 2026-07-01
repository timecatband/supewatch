import crypto from "node:crypto";
import { config } from "./config.js";

export const SUMMARY_PROMPT_VERSION = 2;

const SYSTEM_PROMPT = `You summarize San Francisco Board of Supervisors meeting transcripts for residents.
Be concise, factual, and neutral. Do not add facts that are not in the transcript.
Call out agenda items, continuances, final votes, public-comment themes, and notable dates.
Speaker attribution is critical:
- Name the supervisor, official, invited guest, department representative, organization, or public commenter who said each substantive thing whenever the transcript makes that knowable.
- Avoid vague phrases like "members spoke at length" or "there was discussion" unless the speaker truly cannot be identified.
- For discussion and opinion bullets, start with a bold actor label, such as **Supervisor Chen:**, **President Mandelman:**, **Public commenters:**, or **Unidentified public commenter:**.
- When several people discussed a topic, use a parent bullet for the topic and nested bullets for each speaker's view or concern.
- Distinguish actions taken by the Board from opinions, questions, objections, and public-comment testimony.
When the transcript appears garbled by automated captions, preserve the likely meaning but do not overclaim.
Return Markdown with these sections:
## Overview
## Key Actions
## Who Said What
## Public Comment
## Votes and Dates`;

export async function summarizeTranscript({ meeting, transcript }) {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const transcriptChunks = chunkTranscript(transcript, config.maxTranscriptChars);
  if (transcriptChunks.length > config.maxTranscriptChunks) {
    throw new TranscriptTooLargeError(
      `Transcript requires ${transcriptChunks.length} chunks, above MAX_TRANSCRIPT_CHUNKS=${config.maxTranscriptChunks}`
    );
  }

  const summary =
    transcriptChunks.length === 1
      ? await summarizeWholeTranscript({ meeting, transcript })
      : await summarizeChunkedTranscript({ meeting, transcriptChunks });

  if (!summary) {
    throw new Error("OpenAI response did not include summary text");
  }

  return {
    clipId: meeting.clipId,
    meetingTitle: meeting.title,
    meetingPubDate: meeting.pubDate,
    mediaUrl: meeting.mediaUrl,
    transcriptUrl: meeting.transcriptUrl,
    summary,
    model: config.openAiModel,
    reasoningEffort: config.openAiReasoningEffort,
    transcriptSha256: crypto.createHash("sha256").update(transcript).digest("hex"),
    transcriptLength: transcript.length,
    chunkCount: transcriptChunks.length,
    chunkSizeLimit: config.maxTranscriptChars,
    promptVersion: SUMMARY_PROMPT_VERSION,
    generatedAt: new Date().toISOString()
  };
}

async function summarizeWholeTranscript({ meeting, transcript }) {
  return createOpenAiSummary({
    maxOutputTokens: config.openAiMaxOutputTokens,
    input: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Meeting title: ${meeting.title}
Meeting date: ${meeting.pubDate}
Clip ID: ${meeting.clipId}

Transcript:
${transcript}`
      }
    ]
  });
}

async function summarizeChunkedTranscript({ meeting, transcriptChunks }) {
  const partialSummaries = [];

  for (const [index, chunk] of transcriptChunks.entries()) {
    const chunkNumber = index + 1;
    const partialSummary = await createOpenAiSummary({
      maxOutputTokens: config.openAiChunkMaxOutputTokens,
      input: [
        {
          role: "system",
          content: `You summarize one chunk of a San Francisco Board of Supervisors transcript.
Be concise, factual, and neutral. Capture agenda items, actions, votes, speakers, public-comment themes, and dates that appear in this chunk.
Speaker attribution is critical. For each substantive discussion point, identify who said it and what position, concern, question, or rationale they expressed. Use bold actor labels in bullets, such as **Supervisor Chen:** or **Public commenters:**. Avoid generic phrases like "members discussed" when names or roles are available.
This is an intermediate summary that will be combined with other chunks, so preserve specifics and avoid conclusions that require the whole meeting.`
        },
        {
          role: "user",
          content: `Meeting title: ${meeting.title}
Meeting date: ${meeting.pubDate}
Clip ID: ${meeting.clipId}
Transcript chunk: ${chunkNumber} of ${transcriptChunks.length}

Transcript chunk:
${chunk}`
        }
      ]
    });

    partialSummaries.push(`Chunk ${chunkNumber} of ${transcriptChunks.length}:\n${partialSummary}`);
  }

  return createOpenAiSummary({
    maxOutputTokens: config.openAiMaxOutputTokens,
    input: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Meeting title: ${meeting.title}
Meeting date: ${meeting.pubDate}
Clip ID: ${meeting.clipId}

Combine these ordered partial transcript summaries into one resident-facing summary.
Do not invent facts, votes, or dates. If chunks repeat procedural material, merge it once.
Preserve speaker attribution. Do not collapse attributed statements into generic wording like "members spoke at length"; keep named speakers, roles, and the opinions or concerns attached to them. Use nested bullets when several people addressed the same issue.

Partial summaries:
${partialSummaries.join("\n\n")}`
      }
    ]
  });
}

async function createOpenAiSummary({ input, maxOutputTokens }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAiModel,
      reasoning: {
        effort: config.openAiReasoningEffort
      },
      max_output_tokens: maxOutputTokens,
      input
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    throw new Error(message);
  }

  const summary = extractOutputText(payload);
  if (!summary) {
    throw new Error("OpenAI response did not include summary text");
  }

  return summary;
}

export function chunkTranscript(transcript, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars < 1) {
    throw new RangeError("maxChars must be a positive number");
  }

  const normalized = transcript.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks = [];
  let current = "";

  for (const line of normalized.split(/\n+/)) {
    const block = line.trim();
    if (!block) continue;

    if (block.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongBlock(block, maxChars));
      continue;
    }

    const next = current ? `${current}\n${block}` : block;
    if (next.length > maxChars) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongBlock(block, maxChars) {
  const chunks = [];
  let current = "";

  for (const word of block.split(/\s+/)) {
    if (word.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let start = 0; start < word.length; start += maxChars) {
        chunks.push(word.slice(start, start + maxChars));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

export class TranscriptTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = "TranscriptTooLargeError";
  }
}

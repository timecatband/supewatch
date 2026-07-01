import crypto from "node:crypto";
import { config } from "./config.js";

const SYSTEM_PROMPT = `You summarize San Francisco Board of Supervisors meeting transcripts for residents.
Be concise, factual, and neutral. Do not add facts that are not in the transcript.
Call out agenda items, continuances, final votes, public-comment themes, and notable dates.
When the transcript appears garbled by automated captions, preserve the likely meaning but do not overclaim.
Return Markdown with these sections:
## Overview
## Key Actions
## Discussion Highlights
## Public Comment
## Votes and Dates`;

export async function summarizeTranscript({ meeting, transcript }) {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

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
      max_output_tokens: config.openAiMaxOutputTokens,
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
    generatedAt: new Date().toISOString()
  };
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

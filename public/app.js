import { escapeAttribute, escapeHtml, markdownToHtml } from "./markdown.js";

const meetingList = document.querySelector("#meeting-list");
const meetingCount = document.querySelector("#meeting-count");
const refreshButton = document.querySelector("#refresh");
const summaryEmpty = document.querySelector("#summary-empty");
const summaryEl = document.querySelector("#summary");

let meetings = [];

refreshButton.addEventListener("click", () => loadMeetings({ refresh: true }));

loadMeetings();

async function loadMeetings({ refresh = false } = {}) {
  meetingList.innerHTML = '<p class="meeting-meta">Loading meetings...</p>';
  meetingCount.textContent = "Loading meetings...";
  refreshButton.disabled = true;

  try {
    const response = await fetch(`/api/meetings${refresh ? "?refresh=1" : ""}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load meetings");

    meetings = payload.meetings;
    meetingCount.textContent = `${meetings.length} meetings from the official feed`;
    renderMeetings();
  } catch (error) {
    meetingCount.textContent = "Meetings unavailable";
    meetingList.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  } finally {
    refreshButton.disabled = false;
  }
}

function renderMeetings() {
  meetingList.innerHTML = "";

  for (const meeting of meetings) {
    const card = document.createElement("article");
    card.className = `meeting-card${meeting.summaryGenerated ? " is-cached" : ""}`;

    const title = document.createElement("h3");
    title.className = "meeting-title";
    title.textContent = meeting.title;

    const meta = document.createElement("p");
    meta.className = "meeting-meta";
    meta.textContent = formatDate(meeting.pubDate);

    const actions = document.createElement("div");
    actions.className = "meeting-actions";

    const sourceLink = document.createElement("a");
    sourceLink.href = meeting.mediaUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.textContent = "Meeting video";

    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.textContent = "View summary";
    button.addEventListener("click", () => viewSummary(meeting, button));

    const status = document.createElement("span");
    status.className = `status-pill${meeting.summaryGenerated ? " ready" : ""}`;
    status.textContent = meeting.summaryGenerated ? "Cached" : "Not summarized";

    actions.append(sourceLink, status, button);
    card.append(title, meta, actions);
    meetingList.append(card);
  }
}

async function viewSummary(meeting, button) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = meeting.summaryGenerated ? "Opening..." : "Generating...";

  showSummaryShell(meeting);

  try {
    const response = await fetch(`/api/meetings/${meeting.clipId}/summary`, {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      const retryText = payload.retryAfterSeconds
        ? ` Try again in ${payload.retryAfterSeconds} seconds.`
        : "";
      throw new Error(`${payload.error || "Could not load summary."}${retryText}`);
    }

    meeting.summaryGenerated = true;
    renderMeetings();
    renderSummary(payload.summary, payload.status);
  } catch (error) {
    summaryEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function showSummaryShell(meeting) {
  summaryEmpty.classList.add("hidden");
  summaryEl.classList.remove("hidden");
  summaryEl.innerHTML = `
    <h2>${escapeHtml(meeting.title)}</h2>
    <p class="summary-meta">${escapeHtml(formatDate(meeting.pubDate))}</p>
    <p>Preparing summary...</p>
  `;
}

function renderSummary(summary, status) {
  const chunkCount = Number(summary.chunkCount || 0);
  const chunkText =
    chunkCount > 1
      ? ` &middot; ${chunkCount} chunks`
      : "";

  summaryEl.innerHTML = `
    <h2>${escapeHtml(summary.meetingTitle)}</h2>
    <p class="summary-meta">
      ${escapeHtml(formatDate(summary.meetingPubDate))}
      &middot; ${status === "cached" ? "Cached" : "Generated"} with ${escapeHtml(summary.model)}
      &middot; ${escapeHtml(summary.reasoningEffort)} reasoning
      ${chunkText}
    </p>
    <p class="summary-meta">
      <a href="${escapeAttribute(summary.mediaUrl)}" target="_blank" rel="noreferrer">Meeting video</a>
      &middot;
      <a href="${escapeAttribute(summary.transcriptUrl)}" target="_blank" rel="noreferrer">Transcript</a>
    </p>
    ${markdownToHtml(summary.summary)}
  `;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

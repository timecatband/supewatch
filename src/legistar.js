import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { decodeEntities } from "./granicus.js";

const LEGISTAR_BASE_URL = "https://sfgov.legistar.com";
const GRANICUS_BASE_URL = "https://sanfrancisco.granicus.com";
const agendaCachePath = path.join(config.dataDir, "agendas-cache.json");

let inMemoryAgendas = null;

export function granicusAgendaUrlForClipId(clipId) {
  const params = new URLSearchParams({
    clip_id: clipId,
    view_id: config.granicusViewId,
    redirect: "true",
    embedded: "1"
  });
  return `${GRANICUS_BASE_URL}/AgendaViewer.php?${params.toString()}`;
}

export function legistarMeetingDetailUrl({ meetingId, guid, search = "" }) {
  const params = new URLSearchParams({
    ID: meetingId,
    GUID: guid,
    Options: "ID|",
    Search: search
  });
  return `${LEGISTAR_BASE_URL}/MeetingDetail.aspx?${params.toString()}`;
}

export function legistarMeetingFeedUrl({ meetingId, guid }) {
  const params = new URLSearchParams({
    M: "CalendarDetail",
    ID: meetingId,
    GUID: guid
  });
  return `${LEGISTAR_BASE_URL}/Feed.ashx?${params.toString()}`;
}

export function legistarAgendaPdfUrl({ meetingId, guid }) {
  const params = new URLSearchParams({
    M: "A",
    ID: meetingId,
    GUID: guid
  });
  return `${LEGISTAR_BASE_URL}/View.ashx?${params.toString()}`;
}

export function legistarLegislationDetailUrl({ id, guid, search = "" }) {
  const params = new URLSearchParams({
    ID: id,
    GUID: guid,
    Options: "ID|",
    Search: search
  });
  return `${LEGISTAR_BASE_URL}/LegislationDetail.aspx?${params.toString()}`;
}

export async function getMeetingAgenda(meeting, { forceRefresh = false } = {}) {
  const cache = await readAgendaCache();
  const cachedAgenda = cache[meeting.clipId] || null;

  if (!forceRefresh && cachedAgenda) {
    return cachedAgenda;
  }

  try {
    const agenda = await fetchMeetingAgenda(meeting);
    cache[meeting.clipId] = agenda;
    inMemoryAgendas = cache;
    await writeJson(agendaCachePath, cache);
    return agenda;
  } catch (error) {
    if (cachedAgenda) {
      return cachedAgenda;
    }

    console.warn(`Could not resolve agenda for clip ${meeting.clipId}: ${error.message}`);
    return null;
  }
}

async function fetchMeetingAgenda(meeting) {
  const granicusAgendaUrl = granicusAgendaUrlForClipId(meeting.clipId);
  const granicusHtml = await fetchText(granicusAgendaUrl);
  const granicusAgenda = parseGranicusAgenda(granicusHtml, {
    mediaUrl: meeting.mediaUrl
  });

  const fileNumbers = granicusAgenda.items
    .map((item) => item.fileNumber)
    .filter(Boolean);

  let meetingReference = null;
  let resolutionError = null;

  for (const fileNumber of fileNumbers.slice(0, 10)) {
    try {
      const legislation = await resolveLegislationByFileNumber(fileNumber);
      const detailHtml = await fetchText(legislation.detailUrl);
      meetingReference = parseLegislationDetailMeetingReference(
        detailHtml,
        legistarDateForMeeting(meeting),
        { bodyName: "Board of Supervisors" }
      );

      if (meetingReference) {
        break;
      }
    } catch (error) {
      resolutionError = error;
    }
  }

  if (!meetingReference) {
    const fallback = buildGranicusOnlyAgenda(meeting, granicusAgenda);
    fallback.warning = resolutionError
      ? `Could not resolve Legistar meeting: ${resolutionError.message}`
      : "Could not resolve Legistar meeting from agenda file numbers.";
    return fallback;
  }

  const feedUrl = legistarMeetingFeedUrl(meetingReference);
  const feedXml = await fetchText(feedUrl);
  const legistarItems = parseLegistarMeetingFeed(feedXml);
  const itemNumbersByFile = new Map(
    granicusAgenda.items
      .filter((item) => item.fileNumber && item.itemNumber)
      .map((item) => [item.fileNumber, item.itemNumber])
  );
  const granicusItemsByFile = new Map(
    granicusAgenda.items
      .filter((item) => item.fileNumber)
      .map((item) => [item.fileNumber, item])
  );

  const items = legistarItems.map((item, index) => {
    const granicusItem = granicusItemsByFile.get(item.fileNumber) || {};
    const itemNumber = itemNumbersByFile.get(item.fileNumber) || item.agendaNumber || index + 1;

    return {
      ...item,
      itemNumber,
      shortTitle: granicusItem.title || item.shortTitle || "",
      videoTimeSeconds: granicusItem.videoTimeSeconds ?? null,
      videoUrl: granicusItem.videoUrl || null
    };
  });

  return {
    clipId: meeting.clipId,
    source: "legistar-calendar-detail",
    resolvedAt: new Date().toISOString(),
    granicusAgendaUrl,
    meetingId: meetingReference.meetingId,
    meetingGuid: meetingReference.guid,
    meetingDate: legistarDateForMeeting(meeting),
    meetingDetailUrl: legistarMeetingDetailUrl(meetingReference),
    meetingFeedUrl: feedUrl,
    agendaUrl: legistarAgendaPdfUrl(meetingReference),
    items
  };
}

function buildGranicusOnlyAgenda(meeting, granicusAgenda) {
  return {
    clipId: meeting.clipId,
    source: "granicus-agenda",
    resolvedAt: new Date().toISOString(),
    granicusAgendaUrl: granicusAgendaUrlForClipId(meeting.clipId),
    items: granicusAgenda.items.map((item) => ({
      itemNumber: item.itemNumber,
      fileNumber: item.fileNumber,
      title: item.title,
      shortTitle: item.title,
      type: "",
      status: "",
      action: "",
      result: "",
      detailUrl: "",
      videoTimeSeconds: item.videoTimeSeconds ?? null,
      videoUrl: item.videoUrl || null
    }))
  };
}

async function resolveLegislationByFileNumber(fileNumber) {
  const initialResponse = await fetch(`${LEGISTAR_BASE_URL}/Legislation.aspx`, {
    headers: {
      "User-Agent": "Supewatch/0.1 (+https://sanfrancisco.granicus.com)"
    }
  });

  if (!initialResponse.ok) {
    throw new Error(`Legistar legislation search returned HTTP ${initialResponse.status}`);
  }

  const cookie = (initialResponse.headers.get("set-cookie") || "").split(";")[0];
  const initialHtml = await initialResponse.text();
  const form = new URLSearchParams({
    __VIEWSTATE: extractHiddenInput(initialHtml, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: extractHiddenInput(initialHtml, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: extractHiddenInput(initialHtml, "__EVENTVALIDATION"),
    "ctl00$ContentPlaceHolder1$txtSearch": fileNumber,
    "ctl00$ContentPlaceHolder1$chkID": "on",
    "ctl00$ContentPlaceHolder1$btnSearch": "Search Legislation"
  });

  const searchResponse = await fetch(`${LEGISTAR_BASE_URL}/Legislation.aspx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      "User-Agent": "Supewatch/0.1 (+https://sanfrancisco.granicus.com)"
    },
    body: form.toString()
  });

  if (!searchResponse.ok) {
    throw new Error(`Legistar file ${fileNumber} search returned HTTP ${searchResponse.status}`);
  }

  const searchHtml = await searchResponse.text();
  return parseLegislationSearchResult(searchHtml, fileNumber);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Supewatch/0.1 (+https://sanfrancisco.granicus.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.text();
}

export function parseGranicusAgenda(html, { mediaUrl = "" } = {}) {
  const items = [];
  const divMatches = [
    ...String(html).matchAll(/<div\b[^>]*class=["'][^"']*\bagenda\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)
  ];
  let nextItemNumber = 1;
  let pendingRange = null;

  for (const match of divMatches) {
    const rawHtml = match[0];
    const text = normalizeText(stripTags(match[1]));
    if (!text || /^page break$/i.test(text)) continue;

    const range = text.match(/^Items?\s+(\d+)\s+through\s+(\d+)/i);
    if (range) {
      pendingRange = {
        next: Number(range[1]),
        end: Number(range[2])
      };
      nextItemNumber = pendingRange.next;
      continue;
    }

    const file = text.match(/^(\d{6})\s+(.+)$/);
    if (!file) continue;

    const videoIndexId = extractVideoIndexId(rawHtml);
    const videoTimeSeconds = extractVideoTimeSeconds(rawHtml);
    const itemNumber = pendingRange ? pendingRange.next : nextItemNumber;
    if (pendingRange) {
      pendingRange.next += 1;
      if (pendingRange.next > pendingRange.end) {
        nextItemNumber = pendingRange.end + 1;
        pendingRange = null;
      }
    } else {
      nextItemNumber += 1;
    }

    items.push({
      itemNumber,
      fileNumber: file[1],
      title: normalizeAgendaTitle(file[2]),
      videoIndexId,
      videoTimeSeconds,
      videoUrl: mediaUrl && videoIndexId
        ? `${mediaUrl}&meta_id=${encodeURIComponent(videoIndexId)}`
        : ""
    });
  }

  return { items };
}

export function parseLegistarMeetingFeed(xml) {
  const itemMatches = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];

  return itemMatches.map((match, index) => {
    const itemXml = match[1];
    const link = decodeEntities(extractTag(itemXml, "link"));
    const ids = extractLegistarIds(link);
    const description = descriptionFields(extractTag(itemXml, "description"));
    const fileNumber = description["File #"] || decodeEntities(extractTag(itemXml, "title"));

    return {
      itemNumber: parseOptionalNumber(description["Agenda #"]) || index + 1,
      agendaNumber: parseOptionalNumber(description["Agenda #"]),
      fileNumber,
      version: description["Ver."] || "",
      type: description.Type || decodeEntities(extractTag(itemXml, "category")),
      title: description.Title || "",
      shortTitle: "",
      status: "",
      action: description.Action || "",
      result: description.Result || "",
      detailId: ids?.id || "",
      detailGuid: ids?.guid || "",
      detailUrl: ids ? legistarLegislationDetailUrl(ids) : link
    };
  });
}

export function parseLegislationSearchResult(html, fileNumber) {
  const links = [
    ...String(html).matchAll(/href=["']([^"']*LegislationDetail\.aspx[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)
  ];

  for (const link of links) {
    const text = normalizeText(stripTags(link[2]));
    if (text !== fileNumber) continue;

    const href = decodeEntities(link[1]);
    const ids = extractLegistarIds(href);
    if (!ids) continue;

    return {
      fileNumber,
      id: ids.id,
      guid: ids.guid,
      detailUrl: legistarLegislationDetailUrl({
        id: ids.id,
        guid: ids.guid,
        search: fileNumber
      })
    };
  }

  throw new Error(`Legistar did not return a detail link for file ${fileNumber}`);
}

export function parseLegislationDetailMeetingReference(
  html,
  meetingDate,
  { bodyName = "" } = {}
) {
  const rows = [
    ...String(html).matchAll(/<tr\b[^>]*class=["'][^"']*\brg(?:Alt)?Row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)
  ];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const rowText = normalizeText(stripTags(rowHtml));
    if (!rowText.includes(meetingDate)) continue;
    if (bodyName && !rowText.includes(bodyName)) continue;

    const link = rowHtml.match(/href=["']([^"']*MeetingDetail\.aspx[^"']*)["']/i);
    if (!link) continue;

    const ids = extractLegistarIds(decodeEntities(link[1]));
    if (!ids) continue;

    return {
      meetingId: ids.id,
      guid: ids.guid,
      search: ""
    };
  }

  return null;
}

export function agendaContextForPrompt(agenda) {
  if (!agenda?.items?.length) {
    return "No agenda item map was available.";
  }

  const rows = agenda.items
    .filter((item) => item.itemNumber && item.fileNumber)
    .slice(0, 80)
    .map((item) => {
      const parts = [
        `Item ${item.itemNumber}`,
        `File ${item.fileNumber}`,
        item.type || "",
        item.shortTitle || item.title || ""
      ].filter(Boolean);
      return `- ${parts.join(" - ")}`;
    });

  return `Use this official agenda map to resolve transcript references like "Item 11" or "File 260502":\n${rows.join(
    "\n"
  )}`;
}

function descriptionFields(descriptionHtml) {
  const text = decodeEntities(descriptionHtml)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const fields = {};
  for (const line of text.split(/\n+/)) {
    const match = line.trim().match(/^([^:]+):\s*([\s\S]*)$/);
    if (match) {
      fields[match[1].trim()] = normalizeText(match[2]);
    }
  }
  return fields;
}

function extractVideoTimeSeconds(html) {
  const match = String(html).match(/SetPlayerPosition\('0:(\d+)'/);
  return match ? Number(match[1]) : null;
}

function extractVideoIndexId(html) {
  const match = String(html).match(/\bname=["']agenda(\d+)["']/i);
  return match ? match[1] : "";
}

function normalizeAgendaTitle(title) {
  return normalizeText(title.replace(/\[[^\]]+\]/g, " "));
}

function normalizeText(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, " ");
}

function extractHiddenInput(html, name) {
  const match = String(html).match(
    new RegExp(`name=["']${escapeRegExp(name)}["'][^>]*value=["']([^"']*)`, "i")
  );
  return match ? decodeEntities(match[1]) : "";
}

function extractTag(xml, tagName) {
  const match = String(xml).match(
    new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  return match ? match[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "") : "";
}

function extractLegistarIds(url) {
  const id = String(url).match(/[?&]ID=(\d+)/i)?.[1];
  const guid = String(url).match(/[?&]GUID=([A-Z0-9-]+)/i)?.[1];
  return id && guid ? { id, guid } : null;
}

function parseOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function legistarDateForMeeting(meeting) {
  const date = new Date(meeting.pubDate);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "numeric",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readAgendaCache() {
  if (inMemoryAgendas) return inMemoryAgendas;
  inMemoryAgendas = await readJson(agendaCachePath, {});
  return inMemoryAgendas;
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

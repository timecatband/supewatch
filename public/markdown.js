export function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  const listStack = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeLists(html, listStack);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeLists(html, listStack);
      const level = Math.min(heading[1].length + 1, 5);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeLists(html, listStack);
      html.push("<hr>");
      continue;
    }

    const listItem = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      const rawLevel = Math.floor(listItem[1].replace(/\t/g, "  ").length / 2);
      const type = listItem[2].endsWith(".") ? "ol" : "ul";
      const level = Math.min(rawLevel, listStack.length);
      openListItem(html, listStack, level, type, listItem[3]);
      continue;
    }

    closeLists(html, listStack);
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  closeLists(html, listStack);
  return html.join("");
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function openListItem(html, listStack, level, type, content) {
  const targetDepth = level + 1;

  while (listStack.length > targetDepth) {
    closeTopList(html, listStack);
  }

  if (listStack.length === targetDepth && listStack.at(-1).type !== type) {
    closeTopList(html, listStack);
  }

  while (listStack.length < targetDepth) {
    html.push(`<${type}>`);
    listStack.push({ type, itemOpen: false });
  }

  const topList = listStack.at(-1);
  if (topList.itemOpen) {
    html.push("</li>");
  }

  html.push(`<li>${inlineMarkdown(content.trim())}`);
  topList.itemOpen = true;
}

function closeLists(html, listStack) {
  while (listStack.length) {
    closeTopList(html, listStack);
  }
}

function closeTopList(html, listStack) {
  const topList = listStack.pop();
  if (topList.itemOpen) {
    html.push("</li>");
  }
  html.push(`</${topList.type}>`);
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, label, url) =>
      `<a href="${escapeAttribute(normalizeEscapedUrl(url))}" target="_blank" rel="noreferrer">${label}</a>`
  );
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return html;
}

function normalizeEscapedUrl(url) {
  return url.replace(/&amp;/g, "&");
}

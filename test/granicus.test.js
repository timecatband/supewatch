import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTranscriptText,
  parseRssMeetings,
  transcriptUrlForClipId
} from "../src/granicus.js";

test("parseRssMeetings extracts known clip IDs and transcript URLs", () => {
  const xml = `<?xml version="1.0" ?>
  <rss><channel>
    <item>
      <guid isPermaLink="false">abc</guid>
      <title>BOS Board of Supervisors - Regular Meeting - Jun 30, 2026</title>
      <pubDate>Tue, 30 Jun 2026 02:15:00 -0800</pubDate>
      <link>https://sanfrancisco.granicus.com/MediaPlayer.php?view_id=10&amp;clip_id=52756</link>
    </item>
  </channel></rss>`;

  assert.deepEqual(parseRssMeetings(xml), [
    {
      clipId: "52756",
      guid: "abc",
      title: "BOS Board of Supervisors - Regular Meeting - Jun 30, 2026",
      pubDate: "Tue, 30 Jun 2026 02:15:00 -0800",
      mediaUrl: "https://sanfrancisco.granicus.com/MediaPlayer.php?view_id=10&clip_id=52756",
      transcriptUrl: transcriptUrlForClipId("52756")
    }
  ]);
});

test("extractTranscriptText removes tags and keeps readable transcript lines", () => {
  const html = `<html><style>body { color: red; }</style><body>
    <table><tr><td>Header</td></tr></table>
    GOOD AFTERNOON<br><br>
    <b>415</b>: &nbsp; 554-5184.<br>
    <script>ignore()</script>
  </body></html>`;

  assert.equal(
    extractTranscriptText(html),
    "Header\nGOOD AFTERNOON\n415 : 554-5184."
  );
});

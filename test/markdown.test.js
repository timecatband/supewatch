import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHtml } from "../public/markdown.js";

test("markdownToHtml renders bold actor labels", () => {
  assert.equal(
    markdownToHtml("- **Supervisor Chen:** Raised concerns."),
    "<ul><li><strong>Supervisor Chen:</strong> Raised concerns.</li></ul>"
  );
});

test("markdownToHtml preserves nested list hierarchy", () => {
  assert.equal(
    markdownToHtml("- Topic\n  - **Supervisor Walton:** Asked why.\n  - **Public commenters:** Supported it."),
    "<ul><li>Topic<ul><li><strong>Supervisor Walton:</strong> Asked why.</li><li><strong>Public commenters:</strong> Supported it.</li></ul></li></ul>"
  );
});

test("markdownToHtml escapes unsafe html", () => {
  assert.equal(
    markdownToHtml("## <script>alert(1)</script>"),
    "<h3>&lt;script&gt;alert(1)&lt;/script&gt;</h3>"
  );
});

test("markdownToHtml preserves query parameters in links", () => {
  assert.equal(
    markdownToHtml(
      "[File 260502](https://sfgov.legistar.com/LegislationDetail.aspx?ID=8008869&GUID=2429F850-FD15-460E-B110-3C82EEB22498&Options=ID%7C&Search=)"
    ),
    '<p><a href="https://sfgov.legistar.com/LegislationDetail.aspx?ID=8008869&amp;GUID=2429F850-FD15-460E-B110-3C82EEB22498&amp;Options=ID%7C&amp;Search=" target="_blank" rel="noreferrer">File 260502</a></p>'
  );
});

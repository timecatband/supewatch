import assert from "node:assert/strict";
import test from "node:test";
import {
  agendaContextForPrompt,
  parseGranicusAgenda,
  parseLegislationDetailMeetingReference,
  parseLegislationSearchResult,
  parseLegistarMeetingFeed
} from "../src/legistar.js";

test("parseGranicusAgenda assigns item numbers across grouped and single file items", () => {
  const html = `
    <div class="agenda agenda0"><a name="agenda1250884">Items 1 through 4</a></div>
    <div class="agenda agenda1">260483 Settlement of Lawsuit - Amaryllis Cruz and Elias Jimenez - $3,000,000</div>
    <div class="agenda agenda1">260484 Settlement of Lawsuit - David M. Kennedy-Phelps - $50,000</div>
    <div class="agenda agenda1">260566 Settlement of Lawsuit - Elise Williams and Zachary Williams - $35,000</div>
    <div class="agenda agenda1">260485 Settlement of Unlitigated Claim - Craig Banks - $100,000</div>
    <div class="agenda agenda0">5 UNFINISHED BUSINESS</div>
    <div class="agenda agenda1"><a name="agenda1250893" onClick="top.SetPlayerPosition('0:417',null);return false;">250720 Administrative Code - Domestic Violence Shelter-Based Program Fund</a></div>
    <div class="agenda agenda1">250630 Various Codes - Streamlining Reporting Requirements</div>
    <div class="agenda agenda1">260540 Police Code - Expanding Protections - Fair Chance Ordinance</div>
    <div class="agenda agenda1">260467 Assessment Ballots for City Parcels - Downtown Community Benefit District</div>
    <div class="agenda agenda1">260626 Law Enforcement Equipment Use Policy - 2025 Annual Report</div>
    <div class="agenda agenda1">260535 Charter Amendment - Municipal Finance Corporation and Public Bank</div>
    <div class="agenda agenda1">260502 Commemorative Street Name Designation - &quot;Art Agnos Way&quot; - 500 and 600 Blocks of Connecticut Street</div>
    <div class="agenda agenda1">260563 Rules of Order - Public Comment - Disruption Policies</div>
    <div class="agenda agenda0"><a name="agenda1250914">Items 15 through 19</a></div>
    <div class="agenda agenda1">260740 Coors Boycott Commemoration Day - June 26, 2026</div>
    <div class="agenda agenda1">260741 Designating the San Francisco Arts Commission as the State-Local Partner with the California Arts Council</div>
  `;

  const agenda = parseGranicusAgenda(html, {
    mediaUrl: "https://sanfrancisco.granicus.com/MediaPlayer.php?view_id=10&clip_id=52756"
  });

  assert.equal(agenda.items.find((item) => item.fileNumber === "260483").itemNumber, 1);
  assert.equal(agenda.items.find((item) => item.fileNumber === "250720").itemNumber, 5);
  assert.equal(agenda.items.find((item) => item.fileNumber === "260502").itemNumber, 11);
  assert.equal(agenda.items.find((item) => item.fileNumber === "260563").itemNumber, 12);
  assert.equal(agenda.items.find((item) => item.fileNumber === "260740").itemNumber, 15);
  assert.equal(agenda.items.find((item) => item.fileNumber === "260741").itemNumber, 16);
  assert.equal(agenda.items.find((item) => item.fileNumber === "250720").videoTimeSeconds, 417);
  assert.equal(
    agenda.items.find((item) => item.fileNumber === "250720").videoUrl,
    "https://sanfrancisco.granicus.com/MediaPlayer.php?view_id=10&clip_id=52756&meta_id=1250893"
  );
});

test("parseLegistarMeetingFeed extracts file metadata and canonical detail links", () => {
  const xml = `<rss><channel>
    <item>
      <title>260502</title>
      <link>https://sfgov.legistar.com/Gateway.aspx?M=LD&amp;From=RSS&amp;ID=8008869&amp;GUID=2429F850-FD15-460E-B110-3C82EEB22498</link>
      <description>File #: 260502&lt;br /&gt;Ver.: 1&lt;br /&gt;Agenda #: &lt;br /&gt;Type: Resolution&lt;br /&gt;Title: Resolution adding the commemorative street name “Art Agnos Way” to the 500 and 600 blocks of Connecticut Street.&lt;br /&gt;Action: &lt;br /&gt;Result: </description>
      <category>Resolution</category>
    </item>
  </channel></rss>`;

  assert.deepEqual(parseLegistarMeetingFeed(xml), [
    {
      itemNumber: 1,
      agendaNumber: null,
      fileNumber: "260502",
      version: "1",
      type: "Resolution",
      title: "Resolution adding the commemorative street name “Art Agnos Way” to the 500 and 600 blocks of Connecticut Street.",
      shortTitle: "",
      status: "",
      action: "",
      result: "",
      detailId: "8008869",
      detailGuid: "2429F850-FD15-460E-B110-3C82EEB22498",
      detailUrl:
        "https://sfgov.legistar.com/LegislationDetail.aspx?ID=8008869&GUID=2429F850-FD15-460E-B110-3C82EEB22498&Options=ID%7C&Search="
    }
  ]);
});

test("parseLegislationSearchResult finds the exact file detail link", () => {
  const html = `
    <a href="LegislationDetail.aspx?ID=7455036&amp;GUID=9BF2A7AA-CA69-47ED-BA26-9BC942F7BA66&amp;Options=ID|&amp;Search=250720">250720</a>
  `;

  assert.deepEqual(parseLegislationSearchResult(html, "250720"), {
    fileNumber: "250720",
    id: "7455036",
    guid: "9BF2A7AA-CA69-47ED-BA26-9BC942F7BA66",
    detailUrl:
      "https://sfgov.legistar.com/LegislationDetail.aspx?ID=7455036&GUID=9BF2A7AA-CA69-47ED-BA26-9BC942F7BA66&Options=ID%7C&Search=250720"
  });
});

test("parseLegislationDetailMeetingReference chooses the matching Board meeting row", () => {
  const html = `
    <tr class="rgRow">
      <td>6/23/2026</td><td>Board of Supervisors</td>
      <td><a href="MeetingDetail.aspx?ID=111&amp;GUID=AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA&amp;Options=ID|&amp;Search=250720">Meeting details</a></td>
    </tr>
    <tr class="rgAltRow">
      <td>6/30/2026</td><td>Board of Supervisors</td>
      <td><a href="MeetingDetail.aspx?ID=1425873&amp;GUID=8FA19BCE-C3E8-4D06-9FCF-A33F3BCEED45&amp;Options=ID|&amp;Search=250720">Meeting details</a></td>
    </tr>
  `;

  assert.deepEqual(
    parseLegislationDetailMeetingReference(html, "6/30/2026", {
      bodyName: "Board of Supervisors"
    }),
    {
      meetingId: "1425873",
      guid: "8FA19BCE-C3E8-4D06-9FCF-A33F3BCEED45",
      search: ""
    }
  );
});

test("agendaContextForPrompt formats item, file, type, and title", () => {
  const context = agendaContextForPrompt({
    items: [
      {
        itemNumber: 11,
        fileNumber: "260502",
        type: "Resolution",
        shortTitle: "Commemorative Street Name Designation - Art Agnos Way"
      }
    ]
  });

  assert.match(
    context,
    /Item 11 - File 260502 - Resolution - Commemorative Street Name Designation - Art Agnos Way/
  );
});

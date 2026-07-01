# Supewatch

Supewatch is a small public-facing site for summarizing San Francisco Board of Supervisors meeting transcripts from the official Granicus feed.

It lists known meetings from:

```text
https://sanfrancisco.granicus.com/ViewPublisherRSS.php?view_id=10
```

When a visitor clicks **View summary**, the backend validates the meeting against that feed, fetches the official transcript, summarizes it with the OpenAI Responses API, and caches the generated summary for future visitors.

## Requirements

- Node.js 20 or newer
- An OpenAI API key

## Run

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Start the server:

```bash
npm start
```

The app reads `OPENAI_API_KEY` from `.env` or the process environment. By default it serves on:

```text
http://localhost:3000
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | Server-side API key for OpenAI. |
| `PORT` | `3000` | HTTP server port. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Summarization model. |
| `OPENAI_REASONING_EFFORT` | `low` | Reasoning effort for summaries. |
| `SUMMARY_INTERVAL_MS` | `60000` | Global minimum time between new summary generations. |
| `MAX_TRANSCRIPT_CHARS` | `300000` | Maximum transcript size sent to OpenAI. |
| `MEETING_CACHE_TTL_MS` | `600000` | RSS feed cache lifetime. |

`gpt-5.4-mini` with low reasoning is the default because meeting summarization is mostly extraction and condensation, where cost and latency matter more than frontier-level reasoning.

## API

- `GET /api/health` returns a simple health check.
- `GET /api/meetings` returns the validated meeting list from the official RSS feed.
- `POST /api/meetings/:clipId/summary` returns a cached summary or generates one if the clip ID is known and the rate limit allows it.

## Safety Controls

- The frontend never sends transcript text or transcript URLs.
- The backend only accepts numeric `clipId` values that appear in the official Board of Supervisors RSS feed.
- Transcript URLs are constructed server-side from the known Granicus host and `view_id=10`.
- A summary is generated at most once per minute globally. Cached summaries do not count against the throttle.
- Generated summaries are cached in `data/summaries.json` and served without another OpenAI API call.
- Transcript size is capped by `MAX_TRANSCRIPT_CHARS` to avoid accidental oversized model calls.
- `.env` and `data/` are ignored by Git so API keys and generated cache files are not committed.

For multi-instance deployments, replace the local JSON cache and rate-limit state with a shared store such as Redis or Postgres so the one-per-minute rule is enforced across all instances.

## Test

```bash
npm test
```

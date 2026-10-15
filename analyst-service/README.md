# AI Analyst service

Runs [TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0) for OpenStock's
**AI Analyst** panel. A run takes 5–15 minutes and dozens of LLM calls, which is longer than a Vercel
function can live, so this service runs on its own host and OpenStock polls it through Inngest.

## API

All routes except `/` need the `X-Analyst-Key` header.

| Route | |
|---|---|
| `GET /` | health check |
| `POST /analyses` `{"ticker": "AAPL", "date": "2026-10-15"}` | queues a run, returns `{"id", "status"}` |
| `GET /analyses/{id}` | `status` is `queued`, `running`, `done` (with `rating`, `report_html`, `report_md`) or `error` |

Jobs live in memory for 24 hours; one run at a time by default (`ANALYST_CONCURRENCY`).

## Environment

| Variable | |
|---|---|
| `ANALYST_API_KEY` | shared secret; OpenStock sends the same value |
| `GOOGLE_API_KEY` | Gemini key from https://aistudio.google.com/apikey |
| `TRADINGAGENTS_QUICK_THINK_LLM` | optional, default `gemini-3.5-flash-lite` |
| `TRADINGAGENTS_DEEP_THINK_LLM` | optional, default `gemini-3.8-flash` |

Any other `TRADINGAGENTS_*` variable from TradingAgents works too (another provider, debate rounds, ...).

## Hosting on Hugging Face Spaces (free)

1. https://huggingface.co/new-space → SDK **Docker**, template **Blank**, hardware **CPU basic (free)**.
2. In the Space, **Files → Add file → Create a new file** named `Dockerfile` with the contents of
   [`huggingface.Dockerfile`](huggingface.Dockerfile).
3. **Settings → Variables and secrets**: add the secrets `ANALYST_API_KEY` and `GOOGLE_API_KEY`.
4. The Space URL is `https://<user>-<space>.hf.space`. In Vercel set `ANALYST_SERVICE_URL` to it and
   `ANALYST_API_KEY` to the same secret, then redeploy. For a private Space also set
   `ANALYST_HF_TOKEN` to a Hugging Face read token.

To pick up changes pushed to this folder, use **Settings → Factory rebuild** in the Space.

## Running locally

```bash
docker build -t openstock-analyst analyst-service
docker run -p 7860:7860 -e ANALYST_API_KEY=... -e GOOGLE_API_KEY=... openstock-analyst
```

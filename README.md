# Redex: Semantic Reddit Search Engine

Redex is a premium, open-source semantic search engine built exclusively for Reddit. Unlike traditional keyword search, Redex uses **AI vector embeddings** to understand the *meaning* behind your query — surfacing hyper-specific discussions, niche opinions, and deep technical solutions across Reddit in real time.

What makes Redex special: **it indexes itself.** Every search automatically discovers and persists new content, so the database grows smarter and faster purely based on what people search for — no manual curation required.

---

## Features

* **Optimized Single-Roundtrip Pipeline:** Every query runs in a parallelized pipeline. The second-pass Hugging Face reranker is disabled by default to cut search latency and save token costs, but can be enabled on-demand via the `ENABLE_RERANKER` feature flag.
* **Google-Powered Discovery (SerpApi):** Capped at 20 results per search to balance precision and SerpApi monthly quota.
* **ArcticShift Fallback & Recall Boost:** Runs in parallel with Google to supplement results from Reddit's historical archive — giving a combined pool of up to 35 top candidates per query.
* **Organic Self-Growing Index:** Every user search triggers a background pipeline that saves fresh, high-quality Reddit posts to Pinecone. Only posts with ≥50 upvotes are persisted (up to a hard cap of 25,000 posts in the index) to protect the index storage limits.
* **Token-Efficient Architecture:** Subsequent filter changes (All/Posts/Comments, Any Time/Recent) are performed **client-side** at zero token cost. The AI pipeline is only invoked for new queries.
* **Client-Side Filtering:** Tab switching (All, Posts, Comments) and Time Range (Any time, Recent) filters operate purely in the browser on already-loaded results — 0 extra API calls.
* **User Trust Signals:** Search result cards display core trust signals (subreddit tags, upvotes, relative time-ago stamps, comment counts) alongside visual source badges (`Live` vs `Semantic Index`) for complete data origin transparency.
* **Zero-Auth Bookmark System:** Built-in client-side bookmarking with LocalStorage persistence. A sticky Bookmarks panel persists in the sidebar to keep track of curated threads.
* **Search History Dropdown:** Access previous searches instantly via a history dropdown that floats below the search bar when focused empty.
* **Relevance Guard:** Content marked `[removed]` is filtered from results. NSFW content is shown by default to ensure maximum result breadth.
* **Sub-10ms Caching:** Integrates Upstash Redis to cache hybrid search results — repeat queries go from ~7000ms → <10ms.
* **Radar Loading UX:** A premium Neural Scan animation with live status messages communicates search progress.

---

## How It Works

```
User searches "best mechanical keyboard"
        │
        ▼
[0] Environment & Input Validation (API key guard)
        │
        ▼
[1] Hugging Face: Single query embedding (shared by both lanes)
        │
        ┌────┴──────────────────────────────┐
        ▼                                    ▼
DB Lane (Pinecone)              Google + ArcticShift (Live)
Semantic cosine search          SerpApi: top 20 Google results
on indexed posts+comments       ArcticShift: top 15 archive posts
                                → Merge + Deduplicate → top 35
                                → Hugging Face embed each → cosine score
        └────────────┬─────────────────────┘
                     ▼
   Merge + deduplicate (ID-based)
   Sort: Upvotes → Similarity
                     │
                     ▼
    (Hugging Face Reranker Pass 2 is bypassed by default to keep search instant)
                     │
                     ▼
             Return results to user
                    │
                    ▼ (background — after response sent)
   QStash → persist-live worker
     → Redis Dedup Cache check (skips Pinecone fetch if ID already indexed)
     → Filter: only posts with ≥50 upvotes saved to Pinecone (up to 25K total posts)
     → Trigger ArcticShift full index for new subreddits
```

The next time someone searches the same topic, it's instant from cache (<10ms), and the index has already grown with newly discovered communities.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16 (App Router)](https://nextjs.org/) |
| Vector Database | [Pinecone](https://pinecone.io/) |
| AI Embeddings | [Hugging Face](https://huggingface.co/) `BAAI/bge-base-en-v1.5` (768 dims) |
| AI Reranking | Hugging Face Reranker (Disabled by default; toggleable via ENABLE_RERANKER) |
| Google Search | [SerpApi](https://serpapi.com/) `site:reddit.com` strategy |
| Message Queue | [Upstash QStash](https://upstash.com/) |
| Caching & Metadata | [Upstash Redis](https://upstash.com/) |
| Bulk Indexing | [Arctic Shift API](https://arctic-shift.photon-reddit.com) — no credentials |
| Styling | Vanilla CSS + Tailwind (Neutral-950 Dark Premium) |

---

## Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/redex.git
cd redex
npm install
```

### 2. Configure Environment Variables
Copy the example environment file and fill in your API keys. **Do not wrap values in quotes.**
```env
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
SERPAPI_API_KEY=your_serpapi_key
HF_API_KEY=your_jina_key
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
APP_URL=https://your-deployment-url.vercel.app
```

### 3. Start the Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3000` to use the search engine.

> **Note:** The live lane and background persistence work immediately with no pre-indexed data — Redex produces results on day one.

> **QStash local testing:** QStash cannot reach `localhost`. Use [ngrok](https://ngrok.com/) and set `APP_URL` to your ngrok tunnel URL for the `persist-live` background worker to function locally.

---

## Environment Variables

All services have generous free tiers — running Redex costs $0.

| Variable | Where to get it | Purpose |
|---|---|---|
| `PINECONE_API_KEY` | [Pinecone Console](https://app.pinecone.io/) | Pinecone API key |
| `PINECONE_INDEX` | [Pinecone Console](https://app.pinecone.io/) | Pinecone index name |
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com) | Google Search via SerpApi (100 free searches/month) |
| `HF_API_KEY` | [huggingface.co](https://huggingface.co) | Hugging Face embeddings + reranking (2M free tokens) |
| `UPSTASH_REDIS_REST_URL` | [upstash.com](https://upstash.com) | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | [upstash.com](https://upstash.com) | Redis REST token |
| `QSTASH_TOKEN` | [upstash.com](https://upstash.com) | QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook verification |
| `QSTASH_NEXT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook fallback key |
| `APP_URL` | Your deployment URL | Required for QStash to call your workers |

> **Important:** Do not wrap any environment variable value in double quotes in your `.env` file or in the Vercel dashboard.

---

## API Overview

### Public (no auth required)
| Endpoint | Description |
|---|---|
| `GET /api/search?q=...` | Deep Scan search — Google + ArcticShift + Hugging Face Rerank, merged and ranked |
| `GET /api/search?q=...&refresh=true` | Force a fresh live scan, bypassing cache |
| `GET /api/subreddits` | List all indexed subreddits |

### Search Query Parameters
| Parameter | Default | Description |
|---|---|---|
| `q` | *(required)* | Search query (min 2 chars) |
| `sort` | `relevance` | `relevance` or `top` |
| `type` | `all` | `all`, `post`, or `comment` |
| `dateRange` | `all` | `all`, `week`, `month`, or `year` |
| `minUpvotes` | `0` | Minimum upvote filter |
| `refresh` | `false` | Bypass Redis cache |

> **Client-Side Note:** `type` and `dateRange` filtering after the first search is done purely in the browser at zero token cost. Only new `q` values trigger a new API call.

### Workers (called by QStash only)
| Endpoint | Description |
|---|---|
| `POST /api/worker/persist-live` | Saves live search results (≥50 upvotes, capped at 25K total posts) to Pinecone |

---

## 🧠 Token Budget & Cost & Smart Optimizations

Redex is designed to maximize free-tier AI token and API usage with built-in resource control:

| Operation | Estimated Token Cost |
|---|---|
| Query Embedding (Hugging Face) | ~50 tokens (24h cache-backed) |
| Live Post Embeddings (15 posts × ~200 tokens) | ~3,000 tokens |
| Hugging Face Reranking (Toggleable feature flag) | 0 tokens (Default: disabled) |
| **Total per Deep Scan** | **~3,050 tokens** |

With Hugging Face's **2,000,000 free token** allowance, this gives you approximately **650+ cold Deep Scans** per month. With cache hit optimizations, this extends to **800+ searches/month**.

### ⚡ Built-in Smart Optimizations:
- **Reduced Indexer Truncation**: Bulk subreddit indexing slices text to `2,000` characters (down from `8,000`), reducing token burn by up to 75% without sacrificing vector quality.
- **Tiered Cache TTL**: Search caching TTL matches the query frequency profile (30 minutes for `week`, 2 hours for `month`, and 24 hours for evergreen `all`/`year` queries).
- **Reduced Google Search Cost**: SerpApi results are capped at `20` (down from `30`) to prolong the 100 free searches/month quota.
- **Redis Deduplication Cache**: The background worker performs a fast check against `pinecone:indexed_ids` in Redis before triggering Pinecone fetch operations.
- **Reranker Feature Flag**: Toggle second-pass reranking on/off via `ENABLE_RERANKER` inside your environment variables.

---

## 📁 Project Structure

```
redex/
└── src/
    ├── app/
    │   ├── page.tsx             # Search UI (landing → results, client-side filtering)
    │   └── api/
    │       ├── search/          # Deep Scan orchestrator (Google + ArcticShift + Hugging Face)
    │       ├── subreddits/      # Public subreddit list
    │       └── worker/
    │           └── persist-live/      # Organic Index saver (upvote-filtered)
    │
    └── lib/
        ├── arcticShift.ts       # Arctic Shift historical archive client (15s timeout)
        ├── googleSearch.ts      # SerpApi Google search client (site:reddit.com)
        ├── search.ts            # mergeAndRank(), vectorSearch()
        ├── embeddings.ts        # Hugging Face embedding + reranking client (with console logs)
        ├── cache.ts             # Redis cache helpers
        ├── pinecone.ts          # Pinecone client configuration (lazy)
        ├── redis.ts             # Redis singleton
        └── qstash.ts            # QStash client + signature verification
```

---

## Deployment Checklist (Vercel + Pinecone)

1. **Add all environment variables** to Vercel dashboard (no quotes around values)
2. **Set `APP_URL`** to your Vercel deployment URL (e.g. `https://redex.vercel.app`)
3. **Build test:** Run `npm run build` locally before deploying — must exit with code 0
4. **QStash:** Update your QStash allowed domains to include your Vercel URL

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.

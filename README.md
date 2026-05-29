# Redex: Semantic Reddit Search Engine

Redex is a premium, open-source semantic search engine built exclusively for Reddit. Unlike traditional keyword search, Redex uses **AI vector embeddings** to understand the *meaning* behind your query — surfacing hyper-specific discussions, niche opinions, and deep technical solutions across Reddit in real time.

What makes Redex special: **it indexes itself.** Every search automatically discovers and persists new content, so the database grows smarter and faster purely based on what people search for — no manual curation required.

---

## Features

* **Permanent Deep Scan Mode:** Every search uses the full Google Discovery + Hugging Face Reranking pipeline — no "Normal" vs "Hybrid" choice needed. Maximum precision, always.
* **Google-Powered Discovery (SerpApi):** Instead of hitting Reddit's own search, Redex uses SerpApi to run a `site:reddit.com` Google search, finding the highest-quality threads Google already knows about.
* **ArcticShift Fallback:** Runs in parallel with Google to supplement results from Reddit's historical archive — giving a combined pool of 30–45 top candidates per query.
* **Hugging Face Reranker:** After merging, the top 25 results are re-scored by Hugging Face's cross-encoder reranker, ensuring the absolute most relevant results are surfaced at the top.
* **Organic Self-Growing Index:** Every user search triggers a background pipeline that saves fresh, high-quality Reddit posts to Prisma Postgres. Only posts with ≥50 upvotes are persisted (up to a hard cap of 25,000 posts in the DB) to protect the database storage limits.
* **Token-Efficient Architecture:** Subsequent filter changes (All/Posts/Comments, Any Time/Recent) are performed **client-side** at zero token cost. The AI pipeline is only invoked for new queries.
* **Client-Side Filtering:** Tab switching (All, Posts, Comments) and Time Range (Any time, Recent) filters operate purely in the browser on already-loaded results — 0 extra API calls.
* **Relevance Guard:** Content marked `[removed]` is filtered from results. NSFW content is shown by default to ensure maximum result breadth.
* **Sub-10ms Caching:** Integrates Upstash Redis to cache hybrid search results — repeat queries go from ~7000ms → <10ms.
* **Radar Loading UX:** A premium Neural Scan animation with live status messages communicates search progress.
* **Secure Admin Console:** Password-protected dashboard to trigger subreddit indexing, monitor background jobs, and inspect the vector database.

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
DB Lane (pgvector)              Google + ArcticShift (Live)
Semantic cosine search          SerpApi: top 30 Google results
on indexed posts+comments       ArcticShift: top 15 archive posts
                                → Merge + Deduplicate → top 35
                                → Hugging Face embed each → cosine score
   └────────────┬─────────────────────┘
                ▼
   Merge + deduplicate (ID-based)
   Sort: Upvotes → Similarity
                │
                ▼
   [PASS 2] Hugging Face Reranker on top 25 results
   (Cross-encoder for precision ranking)
                │
                ▼
        Return results to user
                │
                ▼ (background — after response sent)
   QStash → persist-live worker
     → Filter: only posts with ≥50 upvotes saved to Prisma Postgres (up to 25K total posts)
     → Trigger ArcticShift full index for new subreddits
```

The next time someone searches the same topic, it's instant from cache (<10ms), and the index has already grown with newly discovered communities.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16 (App Router)](https://nextjs.org/) |
| Database | [Prisma Postgres (PostgreSQL)](https://www.prisma.io/postgres) + `pgvector` HNSW |
| ORM | [Prisma 6](https://www.prisma.io/) |
| AI Embeddings | [Hugging Face](https://huggingface.co/) `jina-embeddings-v3` (768 dims) |
| AI Reranking | [Hugging Face Reranker](https://huggingface.co/reranker) `jina-reranker-v2-base-multilingual` |
| Google Search | [SerpApi](https://serpapi.com/) `site:reddit.com` strategy |
| Message Queue | [Upstash QStash](https://upstash.com/) |
| Caching | [Upstash Redis](https://upstash.com/) |
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
DATABASE_URL=postgres://... (pooled connection, e.g. pooled.db.prisma.io)
DIRECT_URL=postgres://... (direct connection, e.g. db.prisma.io)
SERPAPI_API_KEY=your_serpapi_key
HF_API_KEY=your_jina_key
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
ADMIN_SECRET=your_password
APP_URL=https://your-deployment-url.vercel.app
```

### 3. Setup the Database & Vector Extension
Push the Prisma schema to your Prisma Postgres database, then enable the pgvector extension:
```bash
npx prisma db push
npx tsx prisma/setup-vectors.ts
```

### 4. Start the Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3000` to use the search engine, or `http://localhost:3000/admin` to trigger your first subreddit index.

> **Note:** The live lane and background persistence work immediately with no pre-indexed data — Redex produces results on day one.

> **QStash local testing:** QStash cannot reach `localhost`. Use [ngrok](https://ngrok.com/) and set `APP_URL` to your ngrok tunnel URL for the `persist-live` background worker to function locally.

---

## Environment Variables

All services have generous free tiers — running Redex costs $0.

| Variable | Where to get it | Purpose |
|---|---|---|
| `DATABASE_URL` | [Prisma Console](https://console.prisma.io/) | Prisma Postgres Pooled connection URL (no quotes) |
| `DIRECT_URL` | [Prisma Console](https://console.prisma.io/) | Prisma Postgres Direct connection URL (no quotes) |
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com) | Google Search via SerpApi (100 free searches/month) |
| `HF_API_KEY` | [huggingface.co](https://huggingface.co) | Hugging Face embeddings + reranking (2M free tokens) |
| `UPSTASH_REDIS_REST_URL` | [upstash.com](https://upstash.com) | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | [upstash.com](https://upstash.com) | Redis REST token |
| `QSTASH_TOKEN` | [upstash.com](https://upstash.com) | QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook verification |
| `QSTASH_NEXT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook fallback key |
| `ADMIN_SECRET` | Your choice | Protects the `/admin` console |
| `APP_URL` | Your deployment URL | Required for QStash to call your workers |

> **Important:** Do not wrap any environment variable value in double quotes in your `.env` file or in the Vercel dashboard. This causes Prisma's schema validator to fail with error `P1012`.

---

## API Overview

### Public (no auth required)
| Endpoint | Description |
|---|---|
| `GET /api/search?q=...` | Deep Scan search — Google + ArcticShift + Hugging Face Rerank, merged and ranked |
| `GET /api/search?q=...&refresh=true` | Force a fresh live scan, bypassing cache |
| `GET /api/subreddits` | List all indexed subreddits |
| `GET /api/suggest?q=...` | Auto-suggestions from indexed post titles |

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

### Admin (requires `Authorization: Bearer <ADMIN_SECRET>`)
| Endpoint | Description |
|---|---|
| `POST /api/admin/index` | Trigger bulk indexing for a subreddit |
| `GET /api/jobs/:jobId` | Poll indexing job status |

### Workers (called by QStash only)
| Endpoint | Description |
|---|---|
| `POST /api/worker/index-subreddit` | Processes one time-based page from Arctic Shift |
| `POST /api/worker/persist-live` | Saves live search results (≥50 upvotes, capped at 25K total posts) to Prisma Postgres |

---

## Token Budget & Cost

Redex is designed to maximize your free-tier AI token usage:

| Operation | Estimated Token Cost |
|---|---|
| Query Embedding (Hugging Face) | ~50 tokens |
| Live Post Embeddings (35 posts × ~200 tokens) | ~7,000 tokens |
| Hugging Face Reranking (top 25 results) | ~25,000 tokens |
| **Total per Deep Scan** | **~32,000–35,000 tokens** |

With Hugging Face's **2,000,000 free token** allowance, this gives you approximately **57–62 full Deep Scans** before needing a top-up.

**Token Savings:**
- Switching tabs (All/Posts/Comments): **0 tokens** (client-side)
- Switching time range (Any time/Recent): **0 tokens** (client-side)
- Repeat search of same query: **0 tokens** (Redis cache, <10ms)
- Background persistence: tokens already recycled from search embeddings

---

## Project Structure

```
redex/
├── prisma/
│   ├── schema.prisma           # Subreddit, Post, Comment, IndexingJob
│   └── setup-vectors.ts        # Enable pgvector + HNSW indexes
│
└── src/
    ├── app/
    │   ├── page.tsx             # Search UI (landing → results, client-side filtering)
    │   ├── admin/page.tsx       # Admin dashboard
    │   └── api/
    │       ├── search/          # Deep Scan orchestrator (Google + ArcticShift + Hugging Face)
    │       ├── subreddits/      # Public subreddit list
    │       ├── suggest/         # Search suggestions
    │       ├── admin/           # Protected admin routes
    │       └── worker/
    │           ├── index-subreddit/   # Arctic Shift bulk indexer
    │           └── persist-live/      # Organic Index saver (upvote-filtered)
    │
    └── lib/
        ├── arcticShift.ts       # Arctic Shift historical archive client (15s timeout)
        ├── googleSearch.ts      # SerpApi Google search client (site:reddit.com)
        ├── search.ts            # mergeAndRank(), semanticSearchWithVector()
        ├── embeddings.ts        # Hugging Face embedding + reranking client (with console logs)
        ├── cache.ts             # Redis cache helpers
        ├── prisma.ts            # Prisma singleton
        ├── redis.ts             # Redis singleton
        └── qstash.ts            # QStash client + signature verification
```

---

## Deployment Checklist (Vercel + Prisma Postgres)

1. **Push schema:** `npx prisma db push`
2. **Add all environment variables** to Vercel dashboard (no quotes around values)
3. **Set `APP_URL`** to your Vercel deployment URL (e.g. `https://redex.vercel.app`)
4. **Verify Prisma:** Ensure `DATABASE_URL` starts with `postgres://` and `DIRECT_URL` is set properly
5. **Build test:** Run `npm run build` locally before deploying — must exit with code 0
6. **QStash:** Update your QStash allowed domains to include your Vercel URL

> **Vercel Function Timeout:** The search API is tuned to complete within 8–9 seconds (well within the 10s Hobby plan limit). The pipeline processes 35 candidates + reranks 25 results.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

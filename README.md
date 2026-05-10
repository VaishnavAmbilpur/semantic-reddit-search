# Redex: Semantic Reddit Search Engine

Redex is a premium, open-source semantic search engine built exclusively for Reddit. Unlike traditional keyword search, Redex uses **AI vector embeddings** to understand the *meaning* behind your query — surfacing hyper-specific discussions, niche opinions, and deep technical solutions across Reddit in real time.

What makes Redex special: **it indexes itself.** Every search automatically discovers and persists new content, so the database grows smarter and faster purely based on what people search for — no manual curation required.

---

## 🚀 Features

* **Organic Self-Growing Index:** Every user search triggers a background pipeline that saves fresh Reddit posts to the database and queues full subreddit indexing for newly discovered communities — the index grows itself based on real usage.
* **Hybrid Dual-Lane Search:** Each query simultaneously runs a pgvector semantic search on the database *and* a live semantic search on Reddit, with results merged, deduplicated, and semantically re-ranked in real time.
* **Semantic Vector Search:** Powered by Jina AI `jina-embeddings-v3` (768-dim) and PostgreSQL `pgvector` HNSW indexes — finds contextual matches, not just keyword overlaps.
* **Relevance Guard:** A 35% cosine similarity threshold filters out off-topic high-upvote posts that would otherwise contaminate results — quality over popularity.
* **Smart Ranking:** Results sorted by Upvotes → Recency → Similarity, so the most popular and freshest relevant content always wins.
* **Live / Indexed Badges:** Every result card shows whether the result came from the live Reddit lane (🔵 pulsing) or from the indexed database (🟣 stable), so users can see the system learning in real time.
* **Deep Indexing Pipeline:** Uses Upstash QStash to manage background worker queues — Arctic Shift API bulk-indexes entire subreddits (posts + comments) without hitting serverless execution limits.
* **Sub-10ms Caching:** Integrates Upstash Redis to cache hybrid search results — repeat queries go from ~2000ms → <10ms.
* **Interactive Loading UX:** Dynamic loading status messages ("Scouring Reddit archives...", "Embedding results with Jina AI...") make the 1–2s search feel premium, not slow.
* **Google-Grade UI:** A minimalist interface that morphs from landing page into a full search dashboard with Sort, Date Range, and Multi-Subreddit filters.
* **Secure Admin Console:** Password-protected dashboard to trigger subreddit indexing, monitor background jobs, and inspect the vector database.

---

## 🏗️ How It Works

```
User searches "best mechanical keyboard"
        │
        ▼
Single Jina AI embedding (shared by both lanes)
        │
   ┌────┴────────────────────┐
   ▼                         ▼
DB Lane                   Live Lane
pgvector cosine search    reddit.com/search.json → 40 posts
(indexed posts+comments)  → Jina embed → cosine score locally
   └────────────┬────────────┘
                ▼
   Merge + deduplicate (DB wins on URL conflict)
   Filter: similarity ≥ 35%
   Sort: Upvotes DESC → Recency DESC → Similarity DESC
                │
                ▼
       Return results to user
                │
                ▼ (background — after response sent)
   QStash → persist-live worker
     → Save live posts to DB
     → Trigger Arctic Shift full index for new subreddits
```

The next time someone searches the same topic, it's faster, deeper, and already cached.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16 (App Router)](https://nextjs.org/) |
| Database | [PostgreSQL (Neon)](https://neon.tech/) + `pgvector` |
| ORM | [Prisma](https://www.prisma.io/) |
| AI Embeddings | [Jina AI](https://jina.ai/) `jina-embeddings-v3` (768 dims) |
| Message Queue | [Upstash QStash](https://upstash.com/) |
| Caching | [Upstash Redis](https://upstash.com/) |
| Live Search | Reddit JSON API (`reddit.com/search.json`) — no credentials |
| Bulk Indexing | [Arctic Shift API](https://arctic-shift.photon-reddit.com) — no credentials |
| Styling | Tailwind CSS (Neutral-900 Premium Aesthetic) |

**Zero credential Reddit access:** Both the Reddit JSON API and Arctic Shift are used without any API registration, OAuth, or credentials.

---

## 💻 Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/redex.git
cd redex
npm install
```

### 2. Configure Environment Variables
Copy the example environment file and fill in your API keys.
```bash
cp .env.example .env
```

### 3. Setup the Database & Vector Extension
Push the Prisma schema to your Neon PostgreSQL database, then run the vector setup script to enable `pgvector` and create HNSW indexes:
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

## 🔑 Environment Variables

All services have generous free tiers — running Redex costs $0.

| Variable | Where to get it | Purpose |
|---|---|---|
| `DATABASE_URL` | [neon.tech](https://neon.tech) | Neon PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` | [upstash.com](https://upstash.com) | Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | [upstash.com](https://upstash.com) | Redis REST token |
| `QSTASH_TOKEN` | [upstash.com](https://upstash.com) | QStash publish token |
| `QSTASH_CURRENT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook verification |
| `QSTASH_NEXT_SIGNING_KEY` | [upstash.com](https://upstash.com) | QStash webhook fallback key |
| `JINA_API_KEY` | [jina.ai](https://jina.ai) | Jina AI embeddings (1M free tokens/month) |
| `ADMIN_SECRET` | Your choice | Protects the `/admin` console |
| `APP_URL` | Your deployment URL | Required for QStash to call your workers |

---

## 🔌 API Overview

### Public (no auth required)
| Endpoint | Description |
|---|---|
| `GET /api/search?q=...` | Hybrid semantic search — DB + live lane, merged and ranked |
| `GET /api/subreddits` | List all indexed subreddits |
| `GET /api/suggest?q=...` | Auto-suggestions from indexed post titles |

### Admin (requires `Authorization: Bearer <ADMIN_SECRET>`)
| Endpoint | Description |
|---|---|
| `POST /api/admin/index` | Trigger bulk indexing for a subreddit |
| `GET /api/jobs/:jobId` | Poll indexing job status |
| `DELETE /api/admin/subreddits/:id` | Remove a subreddit and all its data |

### Workers (called by QStash only)
| Endpoint | Description |
|---|---|
| `POST /api/worker/index-subreddit` | Processes one time-based page from Arctic Shift |
| `POST /api/worker/persist-live` | Saves live search results to DB, triggers organic indexing |

---

## 📁 Project Structure

```
redex/
├── prisma/
│   ├── schema.prisma           # Subreddit, Post, Comment, IndexingJob
│   └── setup-vectors.ts        # Enable pgvector + HNSW indexes
│
└── src/
    ├── app/
    │   ├── page.tsx             # Public search page (landing + results)
    │   ├── admin/page.tsx       # Admin dashboard
    │   └── api/
    │       ├── search/          # Hybrid search orchestrator
    │       ├── subreddits/      # Public subreddit list
    │       ├── suggest/         # Search suggestions
    │       ├── admin/           # Protected admin routes
    │       └── worker/
    │           ├── index-subreddit/   # Arctic Shift bulk indexer
    │           └── persist-live/      # Organic Index saver
    │
    └── lib/
        ├── arcticShift.ts       # Arctic Shift + Reddit JSON API client
        ├── liveSearch.ts        # Live lane: fetch → embed → score
        ├── search.ts            # mergeAndRank(), semanticSearchWithVector()
        ├── embeddings.ts        # Jina AI embedding client
        ├── cache.ts             # Redis cache helpers
        ├── prisma.ts            # Prisma singleton
        ├── redis.ts             # Redis singleton
        └── qstash.ts            # QStash client + signature verification
```

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.

# Redex: Semantic Reddit Search Engine

Redex is a premium, open-source semantic search engine built exclusively for Reddit. It bypasses traditional keyword search by using **AI vector embeddings** to understand the *meaning* behind your query, allowing you to find hyper-specific discussions, niche opinions, and deep technical solutions across thousands of Reddit threads instantly.

![Redex Search UI Placeholder](https://via.placeholder.com/1000x500?text=Redex+Search+Engine)

## 🚀 Features

* **Semantic Vector Search:** Powered by Jina AI 768-dimensional embeddings and PostgreSQL `pgvector`, finding exact contextual matches instead of just keyword overlaps.
* **Deep Indexing Pipeline:** Uses Upstash QStash to manage background worker queues, securely indexing massive subreddits (both posts and their top comments) without hitting serverless execution limits.
* **Sub-Millisecond Caching:** Integrates Upstash Redis to cache complex semantic queries, delivering near-instant search results for popular queries.
* **Google-Grade UX/UI:** A completely custom, minimalist interface that dynamically morphs from a clean landing page into a highly functional, data-rich search dashboard with advanced filtering (Sort, Date Range, Multi-Subreddit selection).
* **Secure Admin Console:** A built-in, password-protected telemetry dashboard to monitor ongoing ingestion jobs, trigger bulk batch indexing, and manage the vector database.

## 🛠️ Technology Stack

* **Framework:** [Next.js 16 (App Router)](https://nextjs.org/)
* **Database:** [PostgreSQL (Neon)](https://neon.tech/) with `pgvector`
* **ORM:** [Prisma](https://www.prisma.io/)
* **AI Embeddings:** [Jina AI](https://jina.ai/)
* **Message Queue / Workers:** [Upstash QStash](https://upstash.com/)
* **Caching:** [Upstash Redis](https://upstash.com/)
* **Styling:** Tailwind CSS (Neutral-900 Premium Aesthetic)
* **Data Source:** Official Reddit API & Arctic Shift API

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
*(See the [Environment Variables](#environment-variables) section below for details).*

### 3. Setup the Database & Vector Extension
Push the Prisma schema to your Neon PostgreSQL database, then manually execute the raw SQL script to generate the `pgvector` columns and HNSW indexes:
```bash
npx prisma db push
npx tsx prisma/setup-vectors.ts
```

### 4. Start the Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3000` to view the search engine, or `http://localhost:3000/admin` to start indexing your first subreddit.

---

## 🔑 Environment Variables

To run Redex, you will need to provision free tiers of Neon DB, Upstash (Redis + QStash), and Jina AI. 

| Variable | Description |
|---|---|
| `DATABASE_URL` | Your Neon PostgreSQL connection string. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token. |
| `QSTASH_TOKEN` | Upstash QStash authentication token. |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash webhook signing key. |
| `QSTASH_NEXT_SIGNING_KEY` | QStash webhook fallback signing key. |
| `JINA_API_KEY` | API Key from Jina AI for generating embeddings. |
| `ADMIN_SECRET` | A secure password you create to lock the `/admin` console. |
| `APP_URL` | The public URL of your app (e.g., your Ngrok URL in dev, or Vercel URL in prod) required for QStash callbacks. |

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.

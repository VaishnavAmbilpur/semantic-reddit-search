/**
 * reset-db.ts
 *
 * Clears ALL data from the database AND flushes the Redis cache.
 * Run this with: npx tsx prisma/reset-db.ts
 *
 * After running, re-add only the subreddits you want via the /admin console.
 */

import { PrismaClient } from '@prisma/client';
import { Redis } from '@upstash/redis';

// Load env manually without dotenv
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  Starting full reset (DB + Redis cache)...\n');

  // ── 1. Database ──────────────────────────────────────────────
  const deletedComments = await prisma.comment.deleteMany({});
  console.log(`✅ DB: Deleted ${deletedComments.count} comments`);

  const deletedPosts = await prisma.post.deleteMany({});
  console.log(`✅ DB: Deleted ${deletedPosts.count} posts`);

  const deletedJobs = await prisma.indexingJob.deleteMany({});
  console.log(`✅ DB: Deleted ${deletedJobs.count} indexing jobs`);

  const deletedSubs = await prisma.subreddit.deleteMany({});
  console.log(`✅ DB: Deleted ${deletedSubs.count} subreddits`);

  // ── 2. Redis Cache (search history + suggestions) ────────────
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.flushdb();
    console.log(`✅ Redis: Cache flushed (all search history cleared)`);
  } else {
    console.warn('⚠️  Redis env vars not found — skipping Redis flush.');
    console.warn('    Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your shell to flush Redis.');
  }

  console.log('\n🎉 Full reset complete. DB and Redis are empty.');
  console.log('👉 Go to /admin and re-index only the subreddits you want.');
}

main()
  .catch((err) => {
    console.error('❌ Reset failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

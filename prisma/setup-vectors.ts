import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function setup() {
  console.log('🚀 Starting vector setup...');

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);

  // Drop old indexes first
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "posts_embedding_idx";`);
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "comments_embedding_idx";`);

  // Drop old columns and recreate with 768 dims (truncated from gemini-embedding-001's 3072)
  await prisma.$executeRawUnsafe(`ALTER TABLE "Post" DROP COLUMN IF EXISTS "embedding";`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Comment" DROP COLUMN IF EXISTS "embedding";`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN "embedding" vector(768);`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Comment" ADD COLUMN "embedding" vector(768);`);

  // HNSW indexes (max 2000 dims on Prisma Postgres, 768 is well within limit)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "posts_embedding_idx" ON "Post" USING hnsw ("embedding" vector_cosine_ops);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "comments_embedding_idx" ON "Comment" USING hnsw ("embedding" vector_cosine_ops);`);

  console.log('✅ Vector setup complete (768 dimensions, truncated from gemini-embedding-001)');
  await prisma.$disconnect();
}

setup().catch((e) => {
  console.error('❌ Setup failed:', e);
  process.exit(1);
});

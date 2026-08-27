import { Pinecone } from "@pinecone-database/pinecone";

const globalForPinecone = globalThis;

function getPineconeClient() {
  if (!globalForPinecone.pinecone) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error("PINECONE_API_KEY environment variable is not defined.");
    }
    globalForPinecone.pinecone = new Pinecone({ apiKey });
  }
  return globalForPinecone.pinecone;
}

export function getPineconeIndex() {
  if (!globalForPinecone.pineconeIndex) {
    const indexName = process.env.PINECONE_INDEX;
    if (!indexName) {
      throw new Error("PINECONE_INDEX environment variable is not defined.");
    }
    const client = getPineconeClient();
    globalForPinecone.pineconeIndex = client.index(indexName);
  }
  return globalForPinecone.pineconeIndex;
}

export async function upsertVectors(records) {
  const index = getPineconeIndex();
  // Pinecone recommends upserting in batches of 100 or less
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await index.upsert({ records: batch });
  }
}

export async function queryVectors(vector, options) {
  const filter = {};
  const optsFilter = options.filter || {};

  if (optsFilter.minUpvotes && optsFilter.minUpvotes > 0) {
    filter.upvotes = { $gte: optsFilter.minUpvotes };
  }

  if (optsFilter.subreddits && optsFilter.subreddits.length > 0) {
    filter.subreddit = { $in: optsFilter.subreddits };
  }

  if (optsFilter.type && optsFilter.type !== "all") {
    filter.type = { $eq: optsFilter.type };
  }

  if (optsFilter.dateRange && optsFilter.dateRange !== "all") {
    const now = new Date();
    const startDate = new Date();
    if (optsFilter.dateRange === "week") startDate.setDate(now.getDate() - 7);
    else if (optsFilter.dateRange === "month")
      startDate.setMonth(now.getMonth() - 1);
    else if (optsFilter.dateRange === "year")
      startDate.setFullYear(now.getFullYear() - 1);
    filter.redditCreatedAt = { $gte: Math.floor(startDate.getTime() / 1000) };
  }

  const index = getPineconeIndex();
  const response = await index.query({
    vector,
    topK: options.topK,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    includeMetadata: true,
  });

  return response.matches || [];
}

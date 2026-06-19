import { Pinecone, Index } from '@pinecone-database/pinecone';

const globalForPinecone = globalThis as unknown as { 
  pinecone?: Pinecone;
  pineconeIndex?: Index;
};

function getPineconeClient(): Pinecone {
  if (!globalForPinecone.pinecone) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error('PINECONE_API_KEY environment variable is not defined.');
    }
    globalForPinecone.pinecone = new Pinecone({ apiKey });
  }
  return globalForPinecone.pinecone;
}

export function getPineconeIndex(): Index {
  if (!globalForPinecone.pineconeIndex) {
    const indexName = process.env.PINECONE_INDEX;
    if (!indexName) {
      throw new Error('PINECONE_INDEX environment variable is not defined.');
    }
    const client = getPineconeClient();
    globalForPinecone.pineconeIndex = client.index(indexName);
  }
  return globalForPinecone.pineconeIndex;
}

export interface PineconeRecord {
  id: string;
  values: number[];
  metadata: {
    type: 'post' | 'comment';
    title?: string;
    content?: string;
    url: string;
    upvotes: number;
    commentCount: number;
    author: string;
    subreddit: string;
    redditCreatedAt: number; // Unix timestamp in seconds
    isNsfw: boolean;
  };
}

export async function upsertVectors(records: PineconeRecord[]) {
  const index = getPineconeIndex();
  // Pinecone recommends upserting in batches of 100 or less
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await index.upsert({ records: batch });
  }
}

export interface QueryOptions {
  topK: number;
  filter?: {
    type?: string;
    minUpvotes?: number;
    subreddits?: string[];
    dateRange?: string;
  };
}

export async function queryVectors(vector: number[], options: QueryOptions) {
  const filter: any = {};
  const optsFilter = options.filter || {};

  if (optsFilter.minUpvotes && optsFilter.minUpvotes > 0) {
    filter.upvotes = { $gte: optsFilter.minUpvotes };
  }

  if (optsFilter.subreddits && optsFilter.subreddits.length > 0) {
    filter.subreddit = { $in: optsFilter.subreddits };
  }

  if (optsFilter.type && optsFilter.type !== 'all') {
    filter.type = { $eq: optsFilter.type };
  }

  if (optsFilter.dateRange && optsFilter.dateRange !== 'all') {
    const now = new Date();
    const startDate = new Date();
    if (optsFilter.dateRange === 'week') startDate.setDate(now.getDate() - 7);
    else if (optsFilter.dateRange === 'month') startDate.setMonth(now.getMonth() - 1);
    else if (optsFilter.dateRange === 'year') startDate.setFullYear(now.getFullYear() - 1);
    
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

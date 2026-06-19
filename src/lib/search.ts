import { generateQueryEmbedding, generateSearchEmbeddings } from './embeddings';
import { searchPostsGlobal } from './arcticShift';
import { cosineSimilarity } from './utils';
import { queryVectors } from './pinecone';

export interface SearchFilters {
  subreddits?: string[];
  type?: 'post' | 'comment' | 'all';
  minUpvotes?: number;
  limit?: number;
  sort?: 'relevance' | 'top';
  dateRange?: 'week' | 'month' | 'year' | 'all';
}

export interface SearchResult {
  id: string;
  type: 'post' | 'comment';
  title: string | null;
  content: string | null;
  url: string;
  upvotes: number;
  commentCount: number;
  author: string;
  redditCreatedAt: string;
  subreddit: string;
  similarity: number;
  isLive?: boolean; 
  embedding?: number[]; // ← Keep the vector for recycling
}

/**
 * Optimized for speed and token efficiency.
 * Truncates content to 500 chars to save 80% tokens and 2x speed.
 */
export async function fetchAndScoreLivePosts(query: string, queryVector: number[]): Promise<SearchResult[]> {
  // 40 posts × ~500-char truncation ≈ 6K tokens per live search — Safe for 4M budget
  const livePosts = await searchPostsGlobal(query, 40); 
  if (livePosts.length === 0) return [];

  const texts = livePosts.map(p => {
    // 1,000 chars provides better semantic context for long threads
    const content = p.selftext ? p.selftext.slice(0, 1000) : '';
    return `[POST] ${p.title} ${content}`.trim();
  });

  const postVectors = await generateSearchEmbeddings(texts);

  return livePosts.map((p, i) => ({
    id: p.id,
    type: 'post',
    title: p.title,
    content: p.selftext,
    url: `https://reddit.com${p.permalink}`,
    upvotes: p.score,
    commentCount: p.num_comments || 0,
    author: p.author,
    subreddit: p.subreddit,
    redditCreatedAt: new Date(p.created_utc * 1000).toISOString(),
    similarity: cosineSimilarity(queryVector, postVectors[i]),
    isLive: true,
    embedding: postVectors[i] // ← RECYCLE: Store the vector
  }));
}

export async function vectorSearch(
  queryVector: number[],
  filters: SearchFilters
): Promise<SearchResult[]> {
  const limit = filters.limit ?? 20;
  const minUpvotes = filters.minUpvotes ?? 0;
  const subreddits = filters.subreddits ?? [];
  const type = filters.type ?? 'all';
  const dateRange = filters.dateRange ?? 'all';
  const sort = filters.sort ?? 'relevance';

  // Retrieve enough candidates to ensure we can satisfy the limit after sorting/filtering
  const topK = Math.max(limit, 100);

  try {
    const matches = await queryVectors(queryVector, {
      topK,
      filter: {
        type,
        minUpvotes,
        subreddits,
        dateRange,
      },
    });

    const results: SearchResult[] = matches.map(match => {
      const metadata = (match.metadata || {}) as any;
      return {
        id: match.id,
        type: metadata.type as 'post' | 'comment',
        title: metadata.title || null,
        content: metadata.content || null,
        url: metadata.url || '',
        upvotes: Number(metadata.upvotes || 0),
        commentCount: Number(metadata.commentCount || 0),
        author: metadata.author || '',
        redditCreatedAt: typeof metadata.redditCreatedAt === 'number'
          ? new Date(metadata.redditCreatedAt * 1000).toISOString()
          : new Date().toISOString(),
        subreddit: metadata.subreddit || '',
        similarity: match.score || 0,
        isLive: false,
      };
    });

    if (sort === 'top') {
      results.sort((a, b) => b.upvotes - a.upvotes || new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime());
    } else {
      results.sort((a, b) => b.similarity - a.similarity);
    }

    return results.slice(0, limit);
  } catch (error) {
    console.error('[Pinecone Search Error]:', error);
    return [];
  }
}

export function mergeAndRank(
  dbResults:   SearchResult[],
  liveResults: SearchResult[],
  limit:       number,
  sort:        'relevance' | 'top',
  dateRange:   string = 'all'
): SearchResult[] {

  const seen = new Map<string, SearchResult>();
  
  for (const post of liveResults) {
    seen.set(post.id, post);
  }

  for (const post of dbResults) {
    if (seen.has(post.id)) {
      const existing = seen.get(post.id)!;
      seen.set(post.id, { ...existing, similarity: Math.max(existing.similarity, post.similarity) });
    } else {
      seen.set(post.id, post);
    }
  }

  const allMerged = [...seen.values()];
  
  // DYNAMIC THRESHOLD:
  // BAAI/bge-base-en-v1.5 typical cosine similarities:
  // - >= 0.25 is a good semantic match.
  // - >= 0.20 is acceptable for high upvote posts (>= 100 upvotes).
  let merged = allMerged.filter(r => {
    if (r.upvotes >= 100) return r.similarity >= 0.20;
    return r.similarity >= 0.25;
  });

  // Fallback: If ANY results were filtered out, use full pool as fallback
  if (merged.length < allMerged.length && allMerged.length > 0) {
    merged = allMerged.sort((a, b) => b.similarity - a.similarity);
  }


  if (dateRange === 'all') {
    // ANYTIME: Ordered by relevance or top upvotes
    if (sort === 'relevance') {
      merged.sort((a, b) => b.similarity - a.similarity);
    } else {
      merged.sort((a, b) => b.upvotes - a.upvotes);
    }
  } else {
    // RECENT: Ordered purely by recency (newest first)
    merged.sort((a, b) => new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime());
  }

  return merged.slice(0, limit);
}

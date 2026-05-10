import { searchPostsGlobal, ArcticPost } from './arcticShift';
import { generateEmbeddings } from './embeddings';
import { SearchResult, SearchFilters } from './search';

export async function fetchAndScoreLivePosts(
  query: string,
  queryVector: number[],
  filters: SearchFilters
): Promise<SearchResult[]> {
  // 1. Fetch live posts
  const livePosts = await searchPostsGlobal(query, 40); 
  if (livePosts.length === 0) return [];

  // 2. Filter by upvotes
  const filtered = livePosts.filter(p => p.score >= (filters.minUpvotes ?? 0));

  // 3. Embed the live content with Jina
  const texts = filtered.map(p => `[POST] ${p.title} ${p.selftext ?? ''}`.trim());
  const vectors = await generateEmbeddings(texts);

  // 4. Calculate similarity scores locally
  return filtered.map((post, i) => ({
    id: post.id,
    type: 'post',
    title: post.title,
    content: post.selftext,
    url: `https://reddit.com${post.permalink}`,
    upvotes: post.score,
    author: post.author,
    redditCreatedAt: new Date(post.created_utc * 1000).toISOString(),
    subreddit: post.subreddit,
    similarity: cosineSimilarity(queryVector, vectors[i]), // Local math
    isLive: true,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

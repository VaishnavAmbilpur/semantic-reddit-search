const BASE = 'https://arctic-shift.photon-reddit.com';

export interface ArcticPost {
  id: string;
  title: string;
  selftext: string | null;
  permalink: string;
  score: number;
  num_comments: number;
  author: string;
  over_18: boolean;
  created_utc: number;
  subreddit: string;
}

export interface ArcticComment {
  id: string;
  body: string;
  score: number;
  author: string;
  link_id: string;
  created_utc: number;
}

/**
 * 1. Check if a subreddit exists
 */
export async function validateSubreddit(name: string) {
  try {
    const res = await fetch(`${BASE}/api/posts/search?subreddit=${name}&limit=1`);
    const data = await res.json();
    if (res.ok && data.data && data.data.length > 0) {
      return { display_name: data.data[0].subreddit };
    }
    return { display_name: name };
  } catch {
    return { display_name: name };
  }
}

/**
 * 2. Fetch posts (Arctic Shift) - Used for deep indexing
 */
export async function fetchPosts(
  subreddit: string,
  before?: number,
  limit = 100
): Promise<ArcticPost[]> {
  const params = new URLSearchParams({ subreddit, limit: String(limit), sort: 'desc' });
  if (before) params.set('before', String(before));
  const res = await fetch(`${BASE}/api/posts/search?${params}`);
  const data = await res.json();
  
  if (data.error) throw new Error(`Arctic Shift Error: ${data.error}`);
  return data.data ?? [];
}

/**
 * 3. Fetch comments (Arctic Shift) - Used for deep indexing
 */
export async function fetchComments(postId: string, limit = 100): Promise<ArcticComment[]> {
  const res = await fetch(`${BASE}/api/comments/search?link_id=${postId}&limit=${limit}`);
  const data = await res.json();
  
  if (data.error) throw new Error(`Arctic Shift Error: ${data.error}`);
  return data.data ?? [];
}

interface PullPushPost {
  id: string;
  title: string;
  selftext?: string;
  permalink: string;
  score?: number;
  num_comments?: number;
  author: string;
  over_18?: boolean;
  created_utc: number;
  subreddit: string;
}

/**
 * 4. Search posts across ALL of Reddit (Global Search)
 * VERIFIED: Switched to PullPush API for global keyword search.
 * This provider allows 'q' globally and works in both Local and Production.
 */
export async function searchPostsGlobal(
  query: string,
  limit = 40
): Promise<ArcticPost[]> {
  const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=${limit}`;
  console.log(`[LiveSearch] Global Search (PullPush): ${url}`);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Search provider returned ${res.status}`);
    }

    const data = await res.json();
    const posts = (data?.data as PullPushPost[]) || [];

    return posts.map((p) => ({
      id:           p.id,
      title:        p.title,
      selftext:     p.selftext || null,
      permalink:    p.permalink,
      score:        p.score || 0,
      num_comments: p.num_comments || 0,
      author:       p.author,
      over_18:      p.over_18 || false,
      created_utc:  p.created_utc,
      subreddit:    p.subreddit,
    })).filter(
      (p: ArcticPost) => p.selftext !== '[removed]'
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Search Error]:', message);
    return [];
  }
}

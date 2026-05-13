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
  subreddit: string; // ← ADD THIS
}

export interface ArcticComment {
  id: string;
  body: string;
  score: number;
  author: string;
  link_id: string;
  created_utc: number;
}

// 1. Check if a subreddit exists
export async function validateSubreddit(name: string) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${name}/about.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Redex/1.0' }
    });
    const data = await res.json();
    if (data?.data?.display_name) {
      return { display_name: data.data.display_name };
    }
  } catch (e) {
    console.error('Validation error:', e);
  }
  return null;
}

// 2. Fetch posts (time-based pagination)
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

// 3. Fetch comments for a specific post
export async function fetchComments(postId: string, limit = 100): Promise<ArcticComment[]> {
  const res = await fetch(`${BASE}/api/comments/search?link_id=${postId}&limit=${limit}`);
  const data = await res.json();

  if (data.error) throw new Error(`Arctic Shift Error: ${data.error}`);
  return data.data ?? [];
}

/**
 * Search posts across ALL of Reddit using a text query.
 * Unlike fetchPosts() which requires a specific subreddit name,
 * this uses Arctic Shift's q= parameter to search globally.
 *
 * Used by the live search lane on every query.
 */
export async function searchPostsGlobal(
  query: string,
  limit = 20,
  afterTimestamp?: number
): Promise<ArcticPost[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    sort: 'relevance',
    type: 'link',
    t: 'all',
  });

  const url = `https://www.reddit.com/search.json?${params}`;
  console.log(`[LiveSearch] Fetching from Reddit: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Redex/1.0'
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Reddit API blocked or failed: ${res.status}. Your production IP might be rate-limited.`);
    }

    const data = await res.json();
    const children = data?.data?.children || [];

    return children.map((c: any) => ({
      id: c.data.id,
      title: c.data.title,
      selftext: c.data.selftext || null,
      permalink: c.data.permalink,
      score: c.data.score,
      num_comments: c.data.num_comments,
      author: c.data.author,
      over_18: c.data.over_18,
      created_utc: c.data.created_utc,
      subreddit: c.data.subreddit,
    })).filter(
      (p: ArcticPost) => !p.over_18 && p.selftext !== '[removed]'
    );

  } catch (err) {
    console.warn('[Reddit] Search error:', err);
    return [];
  }
}

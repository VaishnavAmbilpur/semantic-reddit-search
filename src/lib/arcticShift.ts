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

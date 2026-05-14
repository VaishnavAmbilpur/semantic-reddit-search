import { ArcticPost } from './arcticShift';

interface SerpResult {
  link: string;
  title: string;
  snippet: string;
}

interface PullPushPost {
  id: string;
  score: number;
  author: string;
  created_utc: number;
  selftext?: string;
  num_comments?: number;
  over_18?: boolean;
}

export async function searchGoogleReddit(query: string, limit: number = 10): Promise<ArcticPost[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.warn('[GoogleSearch] No SERPAPI_API_KEY found.');
    return [];
  }

  try {
    const params = new URLSearchParams({
      engine: "google",
      q: `site:reddit.com ${query}`,
      api_key: apiKey,
      num: limit.toString(),
    });

    const response = await fetch(`https://serpapi.com/search?${params.toString()}`);
    if (!response.ok) throw new Error(`SerpApi error: ${response.status}`);

    const data = await response.json();
    const organic = (data.organic_results as SerpResult[]) || [];

    // 1. Map basic info and extract IDs
    const results: ArcticPost[] = organic.map((r, index) => {
      // Robust ID extraction for various Reddit URL formats
      const commentMatch = r.link.match(/comments\/([a-z0-9]+)/);
      const shareMatch = r.link.match(/\/s\/([a-z0-9]+)/);
      const shortMatch = r.link.match(/reddit\.com\/([a-z0-9]+)$/);
      const redditId = commentMatch?.[1] || shareMatch?.[1] || shortMatch?.[1] || null;
      
      return {
        id: redditId || r.link, 
        title: r.title.replace(' - Reddit', '').replace(' : r/', ' - '),
        selftext: r.snippet,
        permalink: r.link.replace('https://www.reddit.com', '').replace('https://reddit.com', ''),
        score: Math.max(0, 1000 - (index * 50)), 
        author: 'Reddit User',
        subreddit: r.link.split('/r/')[1]?.split('/')[0] || 'reddit',
        created_utc: Math.floor(Date.now() / 1000),
        num_comments: 0,
        over_18: false,
      };
    }).filter(r => r.permalink.length > 0); // Ensure it's at least a valid relative link

    // 2. ENRICHMENT PHASE: Fetch real scores for extracted IDs
    const idsToFetch = results.map(r => r.id).join(',');
    if (idsToFetch) {
      try {
        const enrichRes = await fetch(`https://api.pullpush.io/reddit/search/submission/?ids=${idsToFetch}`);
        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          const posts = (enrichData.data as PullPushPost[]) || [];
          const postMap = new Map(posts.map((p) => [p.id, p]));

          for (const res of results) {
            if (postMap.has(res.id)) {
              const live = postMap.get(res.id);
              if (live) {
                res.score = live.score || 0;
                res.author = live.author || res.author;
                res.created_utc = live.created_utc || res.created_utc;
                res.num_comments = live.num_comments || 0;
                res.over_18 = live.over_18 || false;
                if (live.selftext && live.selftext !== '[removed]') {
                  res.selftext = live.selftext.slice(0, 1000);
                }
              }
            }
          }
        }
      } catch {
        console.warn('[GoogleSearch] Enrichment failed, using snippets.');
      }
    }

    return results;
  } catch (error) {
    console.error('[GoogleSearch Error]:', error);
    return [];
  }
}

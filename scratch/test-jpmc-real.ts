import { generateQueryEmbedding } from '../src/lib/embeddings';
import { searchGoogleReddit } from '../src/lib/googleSearch';
import { vectorSearch, mergeAndRank } from '../src/lib/search';
import { cosineSimilarity } from '../src/lib/utils';

async function main() {
  const q = 'JPMC';
  console.log(`[Test] Generating query embedding for "${q}"...`);
  const queryVector = await generateQueryEmbedding(q);

  console.log(`[Test] Running Google search for live posts...`);
  const livePosts = await searchGoogleReddit(q, 6);
  console.log(`[Test] Live posts found: ${livePosts.length}`);

  console.log(`[Test] Generating live post embeddings...`);
  const texts = livePosts.map(p => `${p.title} ${p.selftext || ''}`.slice(0, 400));
  
  let liveResults: any[] = [];
  if (livePosts.length > 0) {
    const { generateQueryAndPostEmbeddings } = await import('../src/lib/embeddings');
    const { queryVector: qVec, postVectors } = await generateQueryAndPostEmbeddings(q, texts);
    
    liveResults = livePosts.map((p, i) => ({
      id: p.id,
      type: 'post' as const,
      title: p.title,
      content: p.selftext,
      url: `https://reddit.com${p.permalink}`,
      upvotes: p.score,
      author: p.author,
      subreddit: p.subreddit,
      redditCreatedAt: new Date(p.created_utc * 1000).toISOString(),
      similarity: cosineSimilarity(qVec, postVectors[i]),
      isLive: true,
      embedding: postVectors[i]
    }));
  }

  console.log(`[Test] Querying DB semantic search...`);
  const dbResults = await vectorSearch(queryVector, { limit: 20 });
  console.log(`[Test] DB results found: ${dbResults.length}`);
  dbResults.forEach(r => {
    console.log(`  - DB Post: [${(r.similarity*100).toFixed(1)}%] [Subreddit: ${r.subreddit}] ${r.title}`);
  });

  console.log(`[Test] Merging results...`);
  const merged = mergeAndRank(dbResults, liveResults, 25, 'relevance');
  console.log(`[Test] Merged results count: ${merged.length}`);
  merged.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.isLive ? 'LIVE' : 'DB'}] [Match: ${(r.similarity*100).toFixed(1)}%] [Subreddit: ${r.subreddit}] ${r.title}`);
  });
}

main().catch(console.error);

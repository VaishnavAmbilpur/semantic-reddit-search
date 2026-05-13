import { generateQueryEmbedding } from '../src/lib/embeddings';
import { fetchAndScoreLivePosts } from '../src/lib/liveSearch';
import { mergeAndRank } from '../src/lib/search';

async function simulateSearch() {
  const q = 'Help';
  const filters = {
    minUpvotes: 0,
    limit: 40,
    sort: 'relevance' as const,
    type: 'all' as const,
    dateRange: 'all' as const,
    subreddits: []
  };

  console.log(`Simulating search for "${q}"...`);
  
  try {
    const queryVector = await generateQueryEmbedding(q);
    console.log('Query embedded.');

    const liveResults = await fetchAndScoreLivePosts(q, queryVector, filters);
    console.log(`Live results found: ${liveResults.length}`);

    const results = mergeAndRank([], liveResults, filters.limit, filters.sort);
    console.log(`Final merged results: ${results.length}`);

    if (results.length > 0) {
      console.log('First result:', results[0].title);
      console.log('Similarity:', results[0].similarity);
    } else {
      console.log('No results passed the threshold.');
      if (liveResults.length > 0) {
         const maxSim = Math.max(...liveResults.map(r => r.similarity));
         console.log('Max similarity found:', maxSim);
      }
    }
  } catch (e: any) {
    console.error('Search failed:', e.message);
  }
}

simulateSearch().catch(console.error);

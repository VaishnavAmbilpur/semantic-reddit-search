import { generateQueryEmbedding } from '../src/lib/embeddings';
import { fetchAndScoreLivePosts, mergeAndRank } from '../src/lib/search';

async function simulateSearch() {
  const q = 'JPMC';
  const filters = {
    minUpvotes: 0,
    limit: 20, // Updated to match optimized speed
    sort: 'relevance' as const,
    type: 'all' as const,
    dateRange: 'all' as const,
    subreddits: []
  };

  console.log(`Simulating search for "${q}"...`);
  
  try {
    const queryVector = await generateQueryEmbedding(q);
    console.log('✅ Query embedded successfully.');

    // Updated to match the new 2-argument signature
    const liveResults = await fetchAndScoreLivePosts(q, queryVector);
    console.log(`✅ Live results found: ${liveResults.length}`);

    const results = mergeAndRank([], liveResults, filters.limit, filters.sort);
    console.log(`✅ Final merged results: ${results.length}`);

    if (results.length > 0) {
      console.log('--- Top Result ---');
      console.log('Title:', results[0].title);
      console.log('Similarity:', (results[0].similarity * 100).toFixed(2) + '%');
      console.log('Upvotes:', results[0].upvotes);
    } else {
      console.log('⚠️ No results found (Similarity threshold: 35%)');
    }
  } catch (e: any) {
    console.error('❌ Search failed:', e.message);
  }
}

simulateSearch().catch(console.error);

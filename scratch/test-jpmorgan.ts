import { generateQueryEmbedding } from '../src/lib/embeddings';
import { fetchAndScoreLivePosts } from '../src/lib/search';
import { mergeAndRank } from '../src/lib/search';

async function simulateSearch() {
  const q = 'JPMorgan';
  console.log(`Simulating search for "${q}"...`);
  
  try {
    const queryVector = await generateQueryEmbedding(q);
    const liveResults = await fetchAndScoreLivePosts(q, queryVector);
    console.log(`Live results found: ${liveResults.length}`);
    const results = mergeAndRank([], liveResults, 40, 'relevance');
    console.log(`Final merged results: ${results.length}`);
  } catch (e: any) {
    console.error('Search failed:', e.message);
  }
}

simulateSearch().catch(console.error);

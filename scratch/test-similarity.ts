import { fetchAndScoreLivePosts } from '../src/lib/search';
import { generateQueryEmbedding } from '../src/lib/embeddings';

async function test() {
  const q = 'JPMC';
  console.log(`Searching for "${q}" and scoring similarity...`);
  
  const queryVector = await generateQueryEmbedding(q);
  const results = await fetchAndScoreLivePosts(q, queryVector);
  
  console.log(`\nFound ${results.length} live results:`);
  results.forEach(r => {
    console.log(`- [${r.similarity.toFixed(4)}] ${r.title}`);
  });

  const passed = results.filter(r => r.similarity >= 0.35);
  console.log(`\nResults >= 0.35: ${passed.length}`);
}

test().catch(console.error);

import { generateQueryEmbedding } from '../src/lib/embeddings';

async function test() {
  const q = 'JPMC';
  console.log(`Testing with original key...`);
  try {
    const v1 = await generateQueryEmbedding(q);
    console.log('Original key worked!');
  } catch (e: any) {
    console.log(`Original key failed: ${e.message}`);
  }

  console.log(`\nTesting with corrected key (removing "i")...`);
  const originalKey = process.env.JINA_API_KEY;
  process.env.JINA_API_KEY = originalKey?.replace('825i_', '825_');
  
  try {
    const v2 = await generateQueryEmbedding(q);
    console.log('Corrected key worked!');
  } catch (e: any) {
    console.log(`Corrected key failed: ${e.message}`);
  }
}

test().catch(console.error);

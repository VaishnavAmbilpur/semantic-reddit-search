/**
 * Jina AI Embeddings Client
 * 
 * Token budget: 10M tokens
 * - Indexing: ~200 tokens/post × 50 posts/batch = ~10K tokens/batch → can index ~50,000 posts
 * - Searching: ~10 tokens/query × 30 searches = ~300 tokens (negligible)
 * - Redis cache (5 min TTL) prevents duplicate search embeddings
 * 
 * Jina outputs 768 dims natively — perfect match for our pgvector setup.
 */

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Jina supports large batches — process up to 50 at once (500 RPM limit is generous)
  const BATCH_SIZE = 50;
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let retries = 0;
    const MAX_RETRIES = 3;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await fetch('https://api.jina.ai/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'jina-embeddings-v3',
            input: batch.map(t => t.slice(0, 8000)), // Cap text length
            dimensions: 768,
            task: 'retrieval.passage', // Optimized for search indexing
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 && retries < MAX_RETRIES) {
            retries++;
            const waitTime = 5000 * retries; // 5s, 10s, 15s
            console.log(`⏳ Jina rate limited. Retry ${retries}/${MAX_RETRIES} in ${waitTime / 1000}s...`);
            await sleep(waitTime);
            continue;
          }
          throw new Error(`Jina API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const vectors = data.data.map((item: any) => item.embedding);
        allVectors.push(...vectors);
        break; // Success

      } catch (error: any) {
        if (retries >= MAX_RETRIES) throw error;
        retries++;
        await sleep(5000 * retries);
      }
    }

    // Brief pause between batches (Jina is generous, 1s is enough)
    if (i + BATCH_SIZE < texts.length) {
      console.log(`📦 Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      await sleep(1000);
    }
  }

  console.log(`✅ Embedded ${allVectors.length} texts via Jina`);
  return allVectors;
}

/**
 * Optimized embedding for search queries (uses 'retrieval.query' task type).
 * Separated from indexing to use the correct Jina task type for better results.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [query.slice(0, 8000)],
      dimensions: 768,
      task: 'retrieval.query', // Optimized for search queries (different from passage!)
    }),
  });

  if (!response.ok) {
    throw new Error(`Jina API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

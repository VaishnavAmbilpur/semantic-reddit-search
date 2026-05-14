/**
 * Jina AI Embeddings Client
 * 
 * Free tier: 100,000 tokens/minute hard cap.
 * Token budget estimation:
 * - Indexing: ~200 tokens/post × 10 posts/batch = ~2K tokens/batch — safe headroom
 * - Searching: 10 posts × 500-char truncation ≈ 2K tokens per search
 * - Redis cache (5 min TTL) prevents duplicate search embeddings
 * 
 * Jina outputs 768 dims natively — perfect match for our pgvector setup.
 * 
 * Error types handled:
 *   429 + RATE_TOKEN_LIMIT_EXCEEDED → wait 62s (rate window resets every 60s)
 *   429 + Concurrency               → random jitter 2–5s, stagger retries
 *   429 (other)                     → exponential backoff
 */

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // BATCH_SIZE = 10: keeps each batch well under the 100K token/min limit.
    // (10 posts × ~500-char truncation ≈ 2K tokens — leaves 98K headroom for
    // concurrent searches and other workers running at the same time)
    const BATCH_SIZE = 10;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        let retries = 0;
        const MAX_RETRIES = 5;

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
                        input: batch.map(t => t.slice(0, 8000)), // hard cap per-text
                        dimensions: 768,
                        task: 'retrieval.passage',
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();

                    // Non-retryable: 401 (bad key), 402/403 (no balance / authz).
                    // Throw immediately — retrying will never fix these.
                    if (response.status === 401 || response.status === 402 || response.status === 403) {
                        const isBalance = errorText.includes('AUTHZ_INSUFFICIENT_BALANCE') ||
                                          errorText.includes('Insufficient account balance');
                        const isBadKey  = errorText.includes('Unauthorized') ||
                                          errorText.includes('invalid_token');
                        if (isBalance) {
                            throw new Error('JINA_NO_BALANCE: Jina AI account balance is empty. Top up at https://jina.ai/api-dashboard/key-manager.');
                        }
                        if (isBadKey) {
                            throw new Error('JINA_BAD_KEY: Jina AI API key is invalid or expired. Check your JINA_API_KEY environment variable.');
                        }
                        throw new Error(`JINA_AUTH_ERROR: Jina returned ${response.status}. ${errorText}`);
                    }

                    if (response.status === 429 && retries < MAX_RETRIES) {
                        retries++;

                        const isTokenLimit  = errorText.includes('RATE_TOKEN_LIMIT_EXCEEDED') ||
                                              errorText.includes('Token rate limit');
                        const isConcurrency = errorText.includes('Concurrency');

                        let waitTime: number;
                        if (isTokenLimit) {
                            // Token window resets every 60 s — wait out the full window
                            waitTime = 62_000;
                            console.warn(`[Jina] Token rate limit hit. Waiting 62s for window reset... (retry ${retries}/${MAX_RETRIES})`);
                        } else if (isConcurrency) {
                            // Random jitter to avoid thundering-herd on concurrent requests
                            waitTime = (Math.random() * 3000) + 2000;
                            console.warn(`[Jina] Concurrency limit. Retry ${retries}/${MAX_RETRIES} in ${Math.round(waitTime/1000)}s...`);
                        } else {
                            // Generic 429 — exponential backoff
                            waitTime = Math.pow(2, retries - 1) * 5000;
                            console.warn(`[Jina] Rate limit. Retry ${retries}/${MAX_RETRIES} in ${Math.round(waitTime/1000)}s...`);
                        }

                        await sleep(waitTime);
                        continue;
                    }
                    throw new Error(`Jina API error ${response.status}: ${errorText}`);
                }

                const data = await response.json() as { data: { embedding: number[] }[] };
                const vectors = data.data.map((item) => item.embedding);
                allVectors.push(...vectors);
                break; // success

            } catch (error: unknown) {
                // Only retry on unknown/transient errors, NOT on our tagged permanent errors
                const msg = error instanceof Error ? error.message : '';
                const isPermanent = msg.startsWith('JINA_NO_BALANCE') ||
                                    msg.startsWith('JINA_BAD_KEY') ||
                                    msg.startsWith('JINA_AUTH_ERROR');
                if (retries >= MAX_RETRIES || isPermanent) throw error;
                retries++;
                await sleep(5000 * retries);
            }
        }

        // Inter-batch pause — gives Jina's token counter time to breathe
        if (i + BATCH_SIZE < texts.length) {
            console.log(`📦 Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}`);
            await sleep(2000); // 2 s between batches
        }
    }

    console.log(`✅ Embedded ${allVectors.length} texts via Jina`);
    return allVectors;
}

/**
 * HIGH-SPEED EMBEDDING FOR SEARCH
 * Uses larger batch size (40) and NO sleeps to prevent Vercel timeouts.
 * Each search for 40 live posts will complete in ONE Jina request (~2s).
 */
export async function generateSearchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    // 40 truncated posts ≈ 4,000 to 8,000 tokens. 
    // Well under 100k/min limit. No need to sleep or split.
    const response = await fetch('https://api.jina.ai/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'jina-embeddings-v3',
            input: texts.map(t => t.slice(0, 2000)), // Search truncation is already 500
            dimensions: 768,
            task: 'retrieval.passage',
        }),
    });

    console.log(`[Jina AI] Embedding request sent (${texts.length} items)...`);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jina API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as { data: { embedding: number[] }[] };
    console.log(`[Jina AI] Successfully embedded ${data.data.length} items.`);
    return data.data.map((item) => item.embedding);
}

/**
 * Optimized embedding for search queries (uses 'retrieval.query' task type).
 * Separated from indexing to use the correct Jina task type for better results.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
    let retries = 0;
    const MAX_RETRIES = 5;

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
                    input: [query.slice(0, 8000)],
                    dimensions: 768,
                    task: 'retrieval.query',
                }),
            });
            
            console.log(`[Jina AI] Query embedding request sent...`);

            if (!response.ok) {
                const errorText = await response.text();

                // Non-retryable: 401 (bad key), 402/403 (no balance / authz).
                if (response.status === 401 || response.status === 402 || response.status === 403) {
                    const isBalance = errorText.includes('AUTHZ_INSUFFICIENT_BALANCE') ||
                                      errorText.includes('Insufficient account balance');
                    const isBadKey  = errorText.includes('Unauthorized') ||
                                      errorText.includes('invalid_token');
                    if (isBalance) {
                        throw new Error('JINA_NO_BALANCE: Jina AI account balance is empty. Top up at https://jina.ai/api-dashboard/key-manager.');
                    }
                    if (isBadKey) {
                        throw new Error('JINA_BAD_KEY: Jina AI API key is invalid or expired. Check your JINA_API_KEY environment variable.');
                    }
                    throw new Error(`JINA_AUTH_ERROR: Jina returned ${response.status}. ${errorText}`);
                }

                if (response.status === 429 && retries < MAX_RETRIES) {
                    retries++;

                    const isTokenLimit  = errorText.includes('RATE_TOKEN_LIMIT_EXCEEDED') ||
                                          errorText.includes('Token rate limit');
                    const isConcurrency = errorText.includes('Concurrency');

                    let waitTime: number;
                    if (isTokenLimit) {
                        waitTime = 62_000; // wait out the 60-s token window
                        console.warn(`[Jina Query] Token rate limit. Waiting 62s... (retry ${retries}/${MAX_RETRIES})`);
                    } else if (isConcurrency) {
                        waitTime = (Math.random() * 2000) + 1000;
                        console.warn(`[Jina Query] Concurrency limit. Retry ${retries}/${MAX_RETRIES} in ${Math.round(waitTime/1000)}s...`);
                    } else {
                        waitTime = Math.pow(2, retries - 1) * 2000;
                        console.warn(`[Jina Query] Rate limit. Retry ${retries}/${MAX_RETRIES} in ${Math.round(waitTime/1000)}s...`);
                    }

                    await sleep(waitTime);
                    continue;
                }
                throw new Error(`Jina API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return data.data[0].embedding;

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : '';
            const isPermanent = msg.startsWith('JINA_NO_BALANCE') ||
                                msg.startsWith('JINA_BAD_KEY') ||
                                msg.startsWith('JINA_AUTH_ERROR');
            if (retries >= MAX_RETRIES || isPermanent) throw error;
            retries++;
            await sleep(2000 * retries);
        }
    }
    throw new Error('Failed to generate query embedding after retries');
}

interface JinaRerankResult {
    index: number;
    relevance_score: number;
}

/**
 * JINA RERANKER V2
 * This is the 'Master Auditor'. It takes a list of results and re-orders them
 * with much higher precision than standard vector search.
 */
export async function rerankResults(query: string, documents: { id: string; text: string }[]): Promise<{ id: string; score: number }[]> {
    if (documents.length === 0) return [];

    try {
        const response = await fetch('https://api.jina.ai/v1/rerank', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'jina-reranker-v2-base-multilingual',
                query: query,
                documents: documents.map(d => d.text.slice(0, 2000)), // Cross-encoder needs context
                top_n: documents.length,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Rerank Error]', errorText);
            // Fallback: If reranker fails, return original order with neutral scores
            return documents.map(d => ({ id: d.id, score: 0 }));
        }

        const data = await response.json() as { results: JinaRerankResult[] };
        console.log(`[Jina AI] Successfully reranked ${data.results.length} results.`);
        return data.results.map((r) => ({
            id: documents[r.index].id,
            score: r.relevance_score
        }));
    } catch (error) {
        console.error('[Rerank Exception]', error);
        return documents.map(d => ({ id: d.id, score: 0 }));
    }
}

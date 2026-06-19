/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Hugging Face Serverless Inference API Client
 * 
 * Hugging Face client library.
 * - Embeddings: BAAI/bge-base-en-v1.5 (768 dimensions)
 * - Reranker: BAAI/bge-reranker-base
 */

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function hfFetch(url: string, body: any, retries = 3) {
    const apiKey = process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
        throw new Error("HF_API_KEY environment variable is missing.");
    }

    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(6000), // 6s max per HF call
            });

            if (response.ok) {
                return await response.json();
            }

            const errorText = await response.text();
            let parsedError: any = {};
            try { parsedError = JSON.parse(errorText); } catch {}

            if (response.status === 503 && parsedError.error?.includes('loading')) {
                const waitTime = parsedError.estimated_time ? parsedError.estimated_time * 1000 : 5000;
                console.log(`[HF] Model is loading... Waiting ${Math.round(waitTime / 1000)}s`);
                await sleep(waitTime);
                continue;
            }

            if (response.status === 429) {
                const waitTime = Math.min(500 * Math.pow(2, i), 8000); // 500ms, 1s, 2s, 4s, 8s cap
                console.warn(`[HF] Rate limited. Retrying in ${waitTime}ms...`);
                await sleep(waitTime);
                continue;
            }

            throw new Error(`HF API error ${response.status}: ${errorText}`);
        } catch (fetchError: any) {
            if (fetchError.name === 'TimeoutError') {
                console.warn(`[HF] Fetch timed out. Retrying... (${i + 1}/${retries})`);
                continue;
            }
            throw fetchError;
        }
    }
    throw new Error(`HF API failed after ${retries} retries.`);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    const BATCH_SIZE = 10;
    const allVectors: number[][] = [];
    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const data = await hfFetch(url, { inputs: batch.map(t => t.slice(0, 2000)) });
        allVectors.push(...data);
        
        if (i + BATCH_SIZE < texts.length) {
            console.log(`📦 Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}`);
            await sleep(1000); // 1s breather between batches for rate limits
        }
    }

    console.log(`✅ Embedded ${allVectors.length} texts`);
    return allVectors;
}

export async function generateSearchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';
    console.log(`[HF] Generating embeddings for ${texts.length} search items...`);
    const data = await hfFetch(url, { inputs: texts.map(t => t.slice(0, 1000)) });
    return data;
}

export async function generateQueryEmbedding(query: string): Promise<number[]> {
    const cacheKey = `qvec:${query.toLowerCase().trim().slice(0, 100)}`;
    try {
        const redis = (await import('./redis')).redis;
        const cached = await redis.get<number[]>(cacheKey);
        if (cached) {
            console.log(`[Redis Cache] Found cached query embedding for "${query}"`);
            return cached;
        }
    } catch (redisError) {
        console.warn(`[Redis] Failed to read cached query embedding:`, redisError);
    }

    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';
    console.log(`[HF] Generating query embedding...`);
    
    const data = await hfFetch(url, { inputs: [query.slice(0, 1000)] });
    const vector = data[0];

    try {
        const redis = (await import('./redis')).redis;
        await redis.set(cacheKey, vector, { ex: 86400 }); // 24h TTL
    } catch (redisError) {
        console.warn(`[Redis] Failed to cache query embedding:`, redisError);
    }

    return vector;
}

export async function generateQueryAndPostEmbeddings(
    query: string,
    postTexts: string[]
): Promise<{ queryVector: number[]; postVectors: number[][] }> {
    const cacheKey = `qvec:${query.toLowerCase().trim().slice(0, 100)}`;
    let cachedQueryVector: number[] | null = null;
    try {
        const redis = (await import('./redis')).redis;
        cachedQueryVector = await redis.get<number[]>(cacheKey);
    } catch (redisError) {
        console.warn(`[Redis] Failed to read cached query embedding in batch flow:`, redisError);
    }

    if (cachedQueryVector) {
        console.log(`[Redis Cache] Found cached query embedding for batch flow: "${query}"`);
        const postVectors = await generateSearchEmbeddings(postTexts);
        return {
            queryVector: cachedQueryVector,
            postVectors,
        };
    }

    if (postTexts.length === 0) {
        const queryVector = await generateQueryEmbedding(query);
        return { queryVector, postVectors: [] };
    }

    const allTexts = [query, ...postTexts.map(t => t.slice(0, 1000))];
    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';
    console.log(`[HF] Generating batch embeddings for query + ${postTexts.length} posts...`);
    
    const data = await hfFetch(url, { inputs: allTexts });
    const queryVector = data[0];
    const postVectors = data.slice(1);

    try {
        const redis = (await import('./redis')).redis;
        await redis.set(cacheKey, queryVector, { ex: 86400 }); // 24h TTL
    } catch (redisError) {
        console.warn(`[Redis] Failed to cache query embedding:`, redisError);
    }

    return {
        queryVector,
        postVectors,
    };
}

export async function rerankResults(query: string, documents: { id: string; text: string }[]): Promise<{ id: string; score: number }[]> {
    if (documents.length === 0) return [];

    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-base';
    const inputs = documents.map(d => ({ text: query, text_pair: d.text.slice(0, 1000) }));
    
    console.log(`[HF] Reranking ${documents.length} items...`);
    const data = await hfFetch(url, { inputs });

    const resultsArray = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];

    return documents.map((d, index) => {
        const score = resultsArray[index]?.score ?? 0;
        return { id: d.id, score };
    });
}


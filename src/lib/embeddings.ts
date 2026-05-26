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
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
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
            const waitTime = (i + 1) * 3000;
            console.warn(`[HF] Rate limited. Retrying in ${waitTime}ms...`);
            await sleep(waitTime);
            continue;
        }

        throw new Error(`HF API error ${response.status}: ${errorText}`);
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
        try {
            const data = await hfFetch(url, { inputs: batch.map(t => t.slice(0, 8000)) });
            allVectors.push(...data);
        } catch (error) {
            console.warn(`[HF API Failed for batch] Falling back to local transformers... (${(error as Error).message})`);
            const localData = await generateLocalEmbeddings(batch);
            allVectors.push(...localData);
        }
        
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
    try {
        const data = await hfFetch(url, { inputs: texts.map(t => t.slice(0, 1000)) });
        return data;
    } catch (error) {
        console.warn(`[HF API Failed] Falling back to local transformers for ${texts.length} items... (${(error as Error).message})`);
        return await generateLocalEmbeddings(texts);
    }
}

export async function generateQueryEmbedding(query: string): Promise<number[]> {
    const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5';
    console.log(`[HF] Generating query embedding...`);
    try {
        const data = await hfFetch(url, { inputs: [query.slice(0, 1000)] });
        return data[0];
    } catch (error) {
        console.warn(`[HF API Failed] Falling back to local transformers... (${(error as Error).message})`);
        return await generateLocalQueryEmbedding(query);
    }
}

export async function rerankResults(query: string, documents: { id: string; text: string }[]): Promise<{ id: string; score: number }[]> {
    if (documents.length === 0) return [];

    try {
        const url = 'https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-base';
        const inputs = documents.map(d => ({ text: query, text_pair: d.text.slice(0, 1000) }));
        
        console.log(`[HF] Reranking ${documents.length} items...`);
        const data = await hfFetch(url, { inputs });

        // data format for list of text pairs: [[{ label: "LABEL_0", score: X }, { label: "LABEL_0", score: Y }]]
        const resultsArray = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];

        return documents.map((d, index) => {
            const score = resultsArray[index]?.score ?? 0;
            return { id: d.id, score };
        });
    } catch (error) {
        console.warn(`[HF API Failed] Falling back to local reranking for ${documents.length} items... (${(error as Error).message})`);
        return await localRerankResults(query, documents);
    }
}

// --- Local Fallback Implementation using @huggingface/transformers ---
let _extractor: any = null;
let _reranker: any = null;

async function getLocalExtractor() {
    if (!_extractor) {
        const { pipeline } = await import('@huggingface/transformers');
        _extractor = await pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5');
    }
    return _extractor;
}

async function getLocalReranker() {
    if (!_reranker) {
        const { pipeline } = await import('@huggingface/transformers');
        _reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base');
    }
    return _reranker;
}

async function generateLocalEmbeddings(texts: string[]): Promise<number[][]> {
    const extractor = await getLocalExtractor();
    const results: number[][] = [];
    for (const text of texts) {
        const output = await extractor(text, { pooling: 'cls', normalize: true });
        results.push(Array.from(output.data) as number[]);
    }
    return results;
}

async function generateLocalQueryEmbedding(query: string): Promise<number[]> {
    const extractor = await getLocalExtractor();
    const output = await extractor(query, { pooling: 'cls', normalize: true });
    return Array.from(output.data) as number[];
}

async function localRerankResults(query: string, documents: { id: string; text: string }[]): Promise<{ id: string; score: number }[]> {
    if (documents.length === 0) return [];
    try {
        const reranker = await getLocalReranker();
        const results = await Promise.all(
            documents.map(async (d) => {
                try {
                    const out = await reranker([query, d.text.slice(0, 1000)]);
                    const score = Array.isArray(out) ? out[0]?.score ?? 0 : out?.score ?? 0;
                    return { id: d.id, score };
                } catch (err) {
                    return { id: d.id, score: 0 };
                }
            })
        );
        return results;
    } catch (e) {
        console.error('[Local Rerank Exception]', e);
        return documents.map(d => ({ id: d.id, score: 0 }));
    }
}


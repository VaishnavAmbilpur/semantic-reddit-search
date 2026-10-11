/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Embeddings & Reranker Service
 *
 * Primary Provider: Cloudflare Workers AI (10,000 Neurons/day free)
 * - Embeddings: @cf/baai/bge-base-en-v1.5 (768 dimensions)
 * - Reranker: @cf/baai/bge-reranker-base
 *
 * Fallback Provider: Hugging Face Serverless Inference API
 * - Embeddings: BAAI/bge-base-en-v1.5 (768 dimensions)
 * - Reranker: BAAI/bge-reranker-base
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCloudflare() {
  return !!(
    (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) &&
    (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID)
  );
}

function getCloudflareCreds() {
  const token =
    process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "";
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";
  return { token, accountId };
}

// ----------------------------------------------------
// Cloudflare Workers AI Implementation
// ----------------------------------------------------

async function cfFetchEmbeddings(texts, retries = 3) {
  const { token, accountId } = getCloudflareCreds();
  if (!token || !accountId) {
    throw new Error(
      "Cloudflare credentials missing (CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID).",
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5`;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: texts }),
        signal: AbortSignal.timeout(8000), // 8s timeout
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.data) {
          return data.result.data;
        }
        throw new Error(
          `Cloudflare AI error: ${JSON.stringify(data.errors || data)}`,
        );
      }

      const errorText = await response.text();
      let parsedError = {};
      try {
        parsedError = JSON.parse(errorText);
      } catch {}

      if (response.status === 429) {
        const waitTime = Math.min(500 * Math.pow(2, i), 8000);
        console.warn(`[Cloudflare AI] Rate limited. Retrying in ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }

      throw new Error(`Cloudflare AI error ${response.status}: ${errorText}`);
    } catch (fetchError) {
      if (fetchError.name === "TimeoutError") {
        console.warn(`[Cloudflare AI] Fetch timed out. Retrying... (${i + 1}/${retries})`);
        continue;
      }
      throw fetchError;
    }
  }
  throw new Error(`Cloudflare AI failed after ${retries} retries.`);
}

async function cfRerank(query, documents, retries = 2) {
  const { token, accountId } = getCloudflareCreds();
  if (!token || !accountId) {
    throw new Error("Cloudflare credentials missing.");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-reranker-base`;
  const contexts = documents.map((d) => ({
    text: d.text.slice(0, 1000),
  }));

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, contexts }),
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.result?.response) {
          const resArray = data.result.response;
          return documents.map((d, index) => {
            const item = resArray.find((r) => r.id === index);
            const score = item ? item.score : resArray[index]?.score ?? 0;
            return { id: d.id, score };
          });
        }
      }
      const errorText = await response.text();
      throw new Error(`Cloudflare Rerank error ${response.status}: ${errorText}`);
    } catch (err) {
      if (i === retries) throw err;
      await sleep(500);
    }
  }
  return documents.map((d) => ({ id: d.id, score: 0 }));
}

// ----------------------------------------------------
// Hugging Face Fallback Implementation
// ----------------------------------------------------

async function hfFetch(url, body, retries = 3) {
  const apiKey = process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error("HF_API_KEY environment variable is missing.");
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        return await response.json();
      }

      const errorText = await response.text();
      let parsedError = {};
      try {
        parsedError = JSON.parse(errorText);
      } catch {}

      if (response.status === 503 && parsedError.error?.includes("loading")) {
        const waitTime = parsedError.estimated_time
          ? parsedError.estimated_time * 1000
          : 5000;
        console.log(`[HF] Model is loading... Waiting ${Math.round(waitTime / 1000)}s`);
        await sleep(waitTime);
        continue;
      }

      if (response.status === 429) {
        const waitTime = Math.min(500 * Math.pow(2, i), 8000);
        console.warn(`[HF] Rate limited. Retrying in ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }

      throw new Error(`HF API error ${response.status}: ${errorText}`);
    } catch (fetchError) {
      if (fetchError.name === "TimeoutError") {
        console.warn(`[HF] Fetch timed out. Retrying... (${i + 1}/${retries})`);
        continue;
      }
      throw fetchError;
    }
  }
  throw new Error(`HF API failed after ${retries} retries.`);
}

// ----------------------------------------------------
// Universal Embedding & Rerank Exports
// ----------------------------------------------------

export async function generateEmbeddings(texts) {
  if (texts.length === 0) return [];

  if (hasCloudflare()) {
    console.log(`[Cloudflare AI] Generating embeddings for ${texts.length} texts...`);
    const BATCH_SIZE = 20;
    const allVectors = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 2000));
      const data = await cfFetchEmbeddings(batch);
      allVectors.push(...data);
      if (i + BATCH_SIZE < texts.length) {
        await sleep(300);
      }
    }
    return allVectors;
  }

  // Hugging Face Fallback
  const BATCH_SIZE = 10;
  const allVectors = [];
  const url =
    "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5";

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const data = await hfFetch(url, {
      inputs: batch.map((t) => t.slice(0, 2000)),
    });
    allVectors.push(...data);
    if (i + BATCH_SIZE < texts.length) {
      await sleep(1000);
    }
  }

  return allVectors;
}

export async function generateSearchEmbeddings(texts) {
  if (texts.length === 0) return [];
  const inputs = texts.map((t) => t.slice(0, 1000));

  if (hasCloudflare()) {
    console.log(`[Cloudflare AI] Generating embeddings for ${texts.length} search items...`);
    return await cfFetchEmbeddings(inputs);
  }

  const url =
    "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5";
  console.log(`[HF] Generating embeddings for ${texts.length} search items...`);
  return await hfFetch(url, { inputs });
}

export async function generateQueryEmbedding(query) {
  const cacheKey = `qvec:${query.toLowerCase().trim().slice(0, 100)}`;
  try {
    const redis = (await import("./redis")).redis;
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[Redis Cache] Found cached query embedding for "${query}"`);
      return cached;
    }
  } catch (redisError) {
    console.warn(`[Redis] Failed to read cached query embedding:`, redisError);
  }

  let vector;
  const input = query.slice(0, 1000);

  if (hasCloudflare()) {
    console.log(`[Cloudflare AI] Generating query embedding...`);
    const data = await cfFetchEmbeddings([input]);
    vector = data[0];
  } else {
    const url =
      "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5";
    console.log(`[HF] Generating query embedding...`);
    const data = await hfFetch(url, { inputs: [input] });
    vector = data[0];
  }

  try {
    const redis = (await import("./redis")).redis;
    await redis.set(cacheKey, vector, { ex: 86400 }); // 24h TTL
  } catch (redisError) {
    console.warn(`[Redis] Failed to cache query embedding:`, redisError);
  }

  return vector;
}

export async function generateQueryAndPostEmbeddings(query, postTexts) {
  const cacheKey = `qvec:${query.toLowerCase().trim().slice(0, 100)}`;
  let cachedQueryVector = null;
  try {
    const redis = (await import("./redis")).redis;
    cachedQueryVector = await redis.get(cacheKey);
  } catch (redisError) {
    console.warn(
      `[Redis] Failed to read cached query embedding in batch flow:`,
      redisError,
    );
  }

  if (cachedQueryVector) {
    console.log(
      `[Redis Cache] Found cached query embedding for batch flow: "${query}"`,
    );
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

  const allTexts = [query, ...postTexts.map((t) => t.slice(0, 1000))];

  let queryVector;
  let postVectors;

  if (hasCloudflare()) {
    console.log(
      `[Cloudflare AI] Generating batch embeddings for query + ${postTexts.length} posts...`,
    );
    const data = await cfFetchEmbeddings(allTexts);
    queryVector = data[0];
    postVectors = data.slice(1);
  } else {
    const url =
      "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5";
    console.log(
      `[HF] Generating batch embeddings for query + ${postTexts.length} posts...`,
    );
    const data = await hfFetch(url, { inputs: allTexts });
    queryVector = data[0];
    postVectors = data.slice(1);
  }

  try {
    const redis = (await import("./redis")).redis;
    await redis.set(cacheKey, queryVector, { ex: 86400 }); // 24h TTL
  } catch (redisError) {
    console.warn(`[Redis] Failed to cache query embedding:`, redisError);
  }

  return {
    queryVector,
    postVectors,
  };
}

export async function rerankResults(query, documents) {
  if (documents.length === 0) return [];

  if (hasCloudflare()) {
    console.log(`[Cloudflare AI] Reranking ${documents.length} items...`);
    return await cfRerank(query, documents);
  }

  // Hugging Face Fallback
  const url =
    "https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-base";
  const inputs = documents.map((d) => ({
    text: query,
    text_pair: d.text.slice(0, 1000),
  }));
  console.log(`[HF] Reranking ${documents.length} items...`);
  const data = await hfFetch(url, { inputs });

  const resultsArray =
    Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];

  return documents.map((d, index) => {
    const score = resultsArray[index]?.score ?? 0;
    return { id: d.id, score };
  });
}

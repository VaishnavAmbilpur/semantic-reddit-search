import { redis } from "@/lib/redis";
import { getPineconeIndex } from "@/lib/pinecone";

export async function GET() {
  // Determine which AI provider to health-check
  const useCloudflare = !!(
    (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) &&
    (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID)
  );

  const aiHealthCheck = useCloudflare
    ? // Cloudflare Workers AI health check
      (() => {
        const token =
          process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
        const accountId =
          process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
        return fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: ["ping"] }),
            signal: AbortSignal.timeout(5000),
          },
        ).then(async (r) => {
          if (r.ok) {
            const data = await r.json();
            return {
              service: "ai_embeddings",
              provider: "cloudflare",
              status: data.success ? "ok" : "error",
            };
          }
          return {
            service: "ai_embeddings",
            provider: "cloudflare",
            status: `error_${r.status}`,
          };
        });
      })()
    : // Hugging Face Fallback health check
      fetch(
        "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: ["ping"] }),
          signal: AbortSignal.timeout(5000),
        },
      ).then((r) => ({
        service: "ai_embeddings",
        provider: "huggingface",
        status: r.ok ? "ok" : `error_${r.status}`,
      }));

  const checks = await Promise.allSettled([
    // 1. Redis Check
    redis.ping().then(() => ({ service: "redis", status: "ok" })),

    // 2. Pinecone Check
    getPineconeIndex()
      .describeIndexStats()
      .then(() => ({ service: "pinecone", status: "ok" })),

    // 3. PullPush Status (from arcticShift status stored in Redis)
    redis.get("pullpush:status").then((s) => ({
      service: "pullpush",
      status: s ?? "unknown",
    })),

    // 4. AI Embedding Service (Cloudflare or Hugging Face)
    aiHealthCheck,
  ]);

  const results = checks.map((c, i) =>
    c.status === "fulfilled"
      ? c.value
      : {
          service: ["redis", "pinecone", "pullpush", "ai_embeddings"][i],
          status: "error",
          error: c.reason?.message,
        },
  );

  const allOk = results.every(
    (r) => r.status === "ok" || r.service === "pullpush",
  );
  return Response.json(
    { healthy: allOk, checks: results },
    { status: allOk ? 200 : 503 },
  );
}

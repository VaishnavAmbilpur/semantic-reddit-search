import { redis } from '@/lib/redis';
import { getPineconeIndex } from '@/lib/pinecone';

export async function GET() {
  const checks = await Promise.allSettled([
    // 1. Redis Check
    redis.ping().then(() => ({ service: 'redis', status: 'ok' })),

    // 2. Pinecone Check
    getPineconeIndex().describeIndexStats().then(() => ({ service: 'pinecone', status: 'ok' })),

    // 3. PullPush Status (from arcticShift status stored in Redis)
    redis.get('pullpush:status').then(s => ({
      service: 'pullpush',
      status: s ?? 'unknown',
    })),

    // 4. Hugging Face API connectivity
    fetch('https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ inputs: ['ping'] }),
      signal: AbortSignal.timeout(5000),
    }).then(r => ({ service: 'huggingface', status: r.ok ? 'ok' : `error_${r.status}` })),
  ]);

  const results = checks.map((c, i) =>
    c.status === 'fulfilled' 
      ? c.value 
      : { service: ['redis', 'pinecone', 'pullpush', 'huggingface'][i], status: 'error', error: c.reason?.message }
  );

  const allOk = results.every(r => r.status === 'ok' || (r.service === 'pullpush' && r.status === 'ok'));
  return Response.json(
    { healthy: allOk, checks: results }, 
    { status: allOk ? 200 : 503 }
  );
}

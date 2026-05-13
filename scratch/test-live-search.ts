import { searchPostsGlobal } from '../src/lib/arcticShift';

async function test() {
  console.log('Searching for JPMC...');
  const results = await searchPostsGlobal('JPMC', 10);
  console.log(`Found ${results.length} results`);
  results.forEach(r => console.log(`- ${r.title}`));
}

test().catch(console.error);

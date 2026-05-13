async function testArcticSearch() {
  const q = 'Narendra Modi';
  const url = `https://arctic-shift.photon-reddit.com/api/posts/search?q=${encodeURIComponent(q)}&limit=40`;
  console.log(`Testing: ${url}`);
  
  try {
    const res = await fetch(url);
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    if (!res.ok) {
      console.log('Error Data:', data);
    } else {
      console.log(`Success! Found ${data.data?.length || 0} posts.`);
    }
  } catch (e: any) {
    console.error('Fetch failed:', e.message);
  }
}

testArcticSearch();

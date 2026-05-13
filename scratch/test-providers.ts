async function testProviders() {
  const query = 'Pizza';
  const providers = [
    {
      name: 'PullPush (Archive)',
      url: `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=10`
    },
    {
      name: 'Arctic Shift (Archive - Term)',
      url: `https://arctic-shift.photon-reddit.com/api/posts/search?term=${encodeURIComponent(query)}&limit=10`
    },
    {
      name: 'Reddit JSON (Direct)',
      url: `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=10`
    }
  ];

  for (const provider of providers) {
    console.log(`\n--- Testing ${provider.name} ---`);
    try {
      const res = await fetch(provider.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0' },
        signal: AbortSignal.timeout(5000)
      });
      console.log(`Status: ${res.status}`);
      const data = await res.json();
      
      if (res.ok) {
        let count = 0;
        if (data.data) count = data.data.length; // PullPush/Arctic
        if (data.children) count = data.children.length; // Reddit
        if (data.data?.children) count = data.data.children.length; // Reddit Nested
        
        console.log(`✅ Success! Found ${count} results.`);
      } else {
        console.log(`❌ Failed: ${data.error || res.statusText}`);
      }
    } catch (e: any) {
      console.log(`❌ Error: ${e.message}`);
    }
  }
}

testProviders();

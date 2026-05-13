async function inspectPullPush() {
  const query = 'Pizza';
  const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(query)}&size=3`;
  
  const res = await fetch(url);
  const data = await res.json();
  console.log('Sample Result:', JSON.stringify(data.data[0], null, 2));
}

inspectPullPush();

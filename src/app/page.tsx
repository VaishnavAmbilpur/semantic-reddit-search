"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface SearchResult {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  url: string;
  upvotes: number;
  author: string;
  redditCreatedAt: string;
  subreddit: string;
  similarity: number;
  isLive: boolean;
}

interface SearchInputProps {
  compact?: boolean;
  query: string;
  setQuery: (q: string) => void;
  onSearch: (e?: React.FormEvent, overrideParams?: { q?: string; sort?: string; type?: string; dateRange?: string }) => void;
  loading: boolean;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  suggestions: string[];
}

const SearchInputUI = ({ 
  compact, 
  query, 
  setQuery, 
  onSearch, 
  loading, 
  showSuggestions, 
  setShowSuggestions, 
  suggestions 
}: SearchInputProps) => (
  <form onSubmit={onSearch} className={`relative w-full ${compact ? 'max-w-3xl' : 'max-w-2xl'}`}>
    <div className={`relative flex items-center bg-white border border-neutral-300 hover:border-neutral-400 focus-within:shadow-md focus-within:border-neutral-900 transition-all ${compact ? 'rounded-full px-4 py-1.5 shadow-sm' : 'rounded-full px-6 py-3 shadow-md'}`}>
      <div className={`${compact ? 'text-neutral-900' : 'text-neutral-400'}`}>
        <svg width={compact ? "18" : "22"} height={compact ? "18" : "22"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth="2.5"/><path d="M21 21l-4.35-4.35" strokeWidth="2.5" strokeLinecap="round"/></svg>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={(e) => {
          e.target.select();
          !compact && query.length >= 2 && setShowSuggestions(true);
        }}
        placeholder="Ask anything..."
        className={`flex-1 w-full bg-transparent border-none outline-none text-neutral-900 placeholder:text-neutral-400 ml-3 ${compact ? 'text-[15px]' : 'text-[18px]'}`}
      />
      {!compact && (
        <button 
          type="submit" 
          disabled={loading} 
          className="ml-2 bg-neutral-900 text-white px-6 py-2.5 rounded-full font-medium text-[15px] hover:bg-neutral-800 transition-colors focus-ring disabled:opacity-50 shadow-sm"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      )}
      {compact && loading && (
        <div className="w-5 h-5 border-2 border-neutral-900 border-t-transparent rounded-full animate-spin"></div>
      )}
    </div>

    {!compact && showSuggestions && suggestions.length > 0 && (
      <div className="absolute top-full left-0 right-0 mt-3 bg-white border border-neutral-200 rounded-2xl shadow-xl overflow-hidden z-50 py-2">
        {suggestions.map((s, i) => (
          <button type="button" key={i} onClick={() => { setQuery(s); onSearch(undefined, { q: s }); }} className="w-full text-left px-6 py-3 text-[15px] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors flex items-center gap-3">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-neutral-400"><circle cx="11" cy="11" r="8" strokeWidth="2"/><path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round"/></svg>
            {s}
          </button>
        ))}
      </div>
    )}
  </form>
);

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Core State
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!searchParams.get("q"));
  
  // Filters State
  const [sort, setSort] = useState(searchParams.get("sort") || "relevance");
  const [type, setType] = useState(searchParams.get("type") || "all");
  const [dateRange, setDateRange] = useState(searchParams.get("dateRange") || "all");
  const [selectedSubs, setSelectedSubs] = useState<string[]>(searchParams.get("subreddits")?.split(",") || []);
  
  // UI State
  const [subreddits, setSubreddits] = useState<{name: string}[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [meta, setMeta] = useState<{ time: number; cached: boolean } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState("Scouring Reddit archives...");
  const [error, setError] = useState<string | null>(null);

  // Initial Data
  useEffect(() => {
    fetch("/api/subreddits")
      .then((res) => res.json())
      .then((data) => setSubreddits(data.subreddits || []));
  }, []);

  // Search Logic
  const onSearch = useCallback(async (e?: React.FormEvent, overrideParams?: { q?: string; sort?: string; type?: string; dateRange?: string }) => {
    e?.preventDefault();
    const q = overrideParams?.q || query;
    if (!q.trim() || q.length < 2) return;

    setLoading(true);
    setHasSearched(true);
    setShowSuggestions(false);
    
    const params = new URLSearchParams({
      q,
      sort: overrideParams?.sort || sort,
      type: overrideParams?.type || type,
      dateRange: overrideParams?.dateRange || dateRange,
      minUpvotes: "0",
      ...(selectedSubs.length > 0 && { subreddits: selectedSubs.join(",") })
    });

    router.push(`?${params.toString()}`, { scroll: false });

    try {
      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.details || data.error || 'Search failed');
      }

      setResults(data.results || []);
      setMeta({ time: data.queryTime, cached: data.cached });
      setError(null);
    } catch (err: any) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, sort, type, dateRange, selectedSubs, router]);

  // Handle initial search from URL
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      // Small timeout to avoid setState in effect warning if needed, 
      // but wrapping in a check is usually enough.
      onSearch(undefined, { q });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggestion Logic
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length >= 2 && !hasSearched) {
        try {
          const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions(data.suggestions?.length > 0);
        } catch { setSuggestions([]); }
      } else { setShowSuggestions(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, hasSearched]);

  // Loading Status Logic
  useEffect(() => {
    if (!loading) return;
    
    const messages = [
      "Scouring Reddit archives...",
      "Fetching global communities...",
      "Embedding results with Jina AI...",
      "Computing semantic relevance...",
      "Finalizing ranking..."
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setLoadingStatus(messages[i]);
    }, 800);
    
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Navigation / Header */}
      <header className={`w-full flex items-center justify-between transition-all duration-300 sticky top-0 z-40 bg-white ${hasSearched ? 'border-b border-neutral-200 px-6 py-4' : 'px-8 py-6'}`}>
        <div className="flex items-center gap-6 flex-1">
          <div 
            onClick={() => { setHasSearched(false); setQuery(""); router.push("/"); }}
            className="cursor-pointer flex items-center gap-2.5 group shrink-0"
          >
            <div className={`bg-neutral-900 flex items-center justify-center text-white font-bold font-display transition-all ${hasSearched ? 'w-8 h-8 rounded-[8px] text-lg' : 'w-10 h-10 rounded-[10px] text-xl'}`}>
              R
            </div>
            <span className={`font-display font-bold tracking-tight text-neutral-900 ${hasSearched ? 'text-xl' : 'text-2xl'}`}>Redex</span>
          </div>
          
          {/* Top Search Bar (Google Style) */}
          {hasSearched && (
            <div className="hidden md:block flex-1 max-w-3xl ml-4">
              <SearchInputUI compact={true} query={query} setQuery={setQuery} onSearch={onSearch} loading={loading} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} suggestions={suggestions} />
            </div>
          )}
        </div>
        <a href="/admin" className="text-[13px] font-semibold text-neutral-500 hover:text-neutral-900 transition-colors shrink-0">
          Admin Console
        </a>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        
        {/* LANDING PAGE STATE */}
        {!hasSearched && (
          <div className="w-full flex flex-col items-center justify-center pt-[15vh] px-6 animate-in fade-in duration-700">
            <h1 className="text-5xl md:text-[64px] font-display font-bold text-neutral-900 mb-8 tracking-tight text-center">
              Search the hive mind.
            </h1>
            <SearchInputUI query={query} setQuery={setQuery} onSearch={onSearch} loading={loading} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} suggestions={suggestions} />
            <p className="mt-8 text-[15px] font-medium text-neutral-400">
              Powered by pgvector and Jina AI
            </p>
          </div>
        )}

        {/* RESULTS PAGE STATE */}
        {hasSearched && (
          <div className="w-full max-w-5xl mx-auto px-6 py-6 animate-in fade-in duration-500">
            
            {/* Mobile Search Bar (Only visible on small screens) */}
            <div className="md:hidden mb-6 w-full">
              <SearchInputUI compact={true} query={query} setQuery={setQuery} onSearch={onSearch} loading={loading} showSuggestions={showSuggestions} setShowSuggestions={setShowSuggestions} suggestions={suggestions} />
            </div>

            <div className="flex flex-col lg:flex-row gap-10">
              {/* Left Column: Results */}
              <div className="flex-1 max-w-3xl">
                {/* Meta & Tabs */}
                <div className="flex items-center gap-6 border-b border-neutral-200 mb-6 pb-2">
                  <div className="flex gap-6">
                    {[{id: 'all', label: 'All'}, {id: 'post', label: 'Posts'}, {id: 'comment', label: 'Comments'}].map(opt => (
                      <button 
                        key={opt.id} 
                        onClick={() => {setType(opt.id); onSearch(undefined, {type: opt.id});}} 
                        className={`text-[14px] font-medium pb-2 border-b-2 transition-all ${type === opt.id ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {meta && !loading && (
                    <span className="text-[13px] text-neutral-400 ml-auto">
                      {results.length} results ({meta.time}ms)
                    </span>
                  )}
                </div>

                {loading ? (
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 text-neutral-500 font-medium animate-in fade-in slide-in-from-bottom-2">
                      <div className="w-5 h-5 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin"></div>
                      <span className="text-[15px]">{loadingStatus}</span>
                    </div>

                    {[1,2,3,4].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 bg-neutral-100 rounded-full"></div>
                          <div className="h-3 w-24 bg-neutral-100 rounded"></div>
                        </div>
                        <div className="h-5 w-3/4 bg-neutral-200 rounded mb-2"></div>
                        <div className="h-3 w-full bg-neutral-100 rounded mb-1"></div>
                        <div className="h-3 w-2/3 bg-neutral-100 rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : error ? (
                  <div className="py-20 text-center px-6 bg-red-50 rounded-2xl border border-red-100">
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <h3 className="text-[18px] font-semibold text-red-900 mb-2">Search Error</h3>
                    <p className="text-[15px] text-red-700 max-w-md mx-auto">{error}</p>
                    <button 
                      onClick={() => onSearch()}
                      className="mt-6 text-[14px] font-bold text-red-600 hover:text-red-800 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                ) : results.length === 0 ? (
                  <div className="py-20 text-center">
                    <h3 className="text-[18px] font-semibold text-neutral-900 mb-2">No results found for &quot;{query}&quot;</h3>
                    <p className="text-[15px] text-neutral-500">Make sure all words are spelled correctly, or try more general keywords.</p>
                  </div>
                ) : (
                  <div className="space-y-8 pb-20">
                    {results.map((r) => (
                      <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="block group">
                        {/* URL / Subreddit Context */}
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <div className="w-7 h-7 bg-neutral-100 rounded-full flex items-center justify-center text-[13px] font-bold text-neutral-600">
                            r/
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[13px] font-medium text-neutral-900 line-clamp-1 hover:underline">
                              reddit.com/r/{r.subreddit}
                            </span>
                            <span className="text-[11px] text-neutral-500 line-clamp-1">
                              u/{r.author} &bull; {new Date(r.redditCreatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric'})}
                            </span>
                          </div>
                        </div>
                        
                        {/* Title (Link) */}
                        <h3 className="text-[20px] text-[#1a0dab] group-hover:underline font-medium leading-snug mb-1">
                          {r.type === 'post' ? r.title : `Comment on: ${r.url.split('/').pop()?.replace(/_/g, ' ') || 'Thread'}`}
                        </h3>

                        {/* Snippet */}
                        {r.content && r.content !== "[removed]" && (
                          <p className="text-[14px] text-[#4d5156] leading-relaxed line-clamp-2">
                            {r.content}
                          </p>
                        )}
                        
                        {/* Tags */}
                        <div className="mt-2 flex gap-3 text-[12px] font-medium">
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            {(r.similarity*100).toFixed(0)}% Match
                          </span>

                          {/* NEW: Source Badges */}
                          {r.isLive ? (
                            <span 
                              title="Fetched live from Reddit — being saved to index"
                              className="text-sky-700 bg-sky-50 px-2 py-0.5 rounded flex items-center gap-1 cursor-help"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block animate-pulse" />
                              Live
                            </span>
                          ) : (
                            <span 
                              title="From semantic index — instant recall"
                              className="text-violet-700 bg-violet-50 px-2 py-0.5 rounded flex items-center gap-1 cursor-help"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                              Indexed
                            </span>
                          )}

                          <span className="text-neutral-500 flex items-center gap-1">👍 {r.upvotes}</span>
                          {r.type === 'comment' && (
                            <span className="text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">Comment</span>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Advanced Filters */}
              <div className="w-full lg:w-[240px] shrink-0 space-y-6 hidden lg:block">
                <div>
                  <h4 className="text-[13px] font-bold uppercase tracking-wider text-neutral-400 mb-3">Time Range</h4>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { id: 'all', label: 'Any time' },
                      { id: 'week', label: 'Recent' }
                    ].map(opt => (
                      <button 
                        key={opt.id} 
                        onClick={() => {setDateRange(opt.id); onSearch(undefined, {dateRange: opt.id});}} 
                        className={`text-left text-[14px] px-3 py-2 rounded-lg transition-colors ${dateRange === opt.id ? 'bg-neutral-100 text-neutral-900 font-semibold' : 'text-neutral-600 hover:bg-neutral-50'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-neutral-900 rounded-full animate-spin"></div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}

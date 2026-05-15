"use client";
import { useState, useEffect, useCallback, Suspense, useRef } from "react";
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
  isLive?: boolean;
}

interface SearchInputProps {
  compact?: boolean;
  query: string;
  setQuery: (q: string) => void;
  onSearch: (e?: React.FormEvent, overrideParams?: { q?: string; sort?: string; type?: string; dateRange?: string; refresh?: boolean }) => void;
  loading: boolean;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  suggestions: string[];
  tokensRemaining: number;
  searchesRemaining: number;
}

const SearchInputUI = ({ 
  compact, 
  query, 
  setQuery, 
  onSearch, 
  loading, 
  showSuggestions, 
  setShowSuggestions, 
  suggestions,
  tokensRemaining,
  searchesRemaining
}: SearchInputProps) => (
  <div className={`relative w-full ${compact ? 'max-w-3xl' : 'max-w-2xl'}`}>
    <div className={`relative flex items-center bg-neutral-900 border border-neutral-800 hover:border-neutral-700 focus-within:shadow-[0_0_20px_rgba(255,255,255,0.05)] focus-within:border-white transition-all ${compact ? 'rounded-full px-4 py-1.5' : 'rounded-full px-6 py-3 shadow-2xl'}`}>
      <div className={`${compact ? 'text-white' : 'text-neutral-500'}`}>
        <svg width={compact ? "18" : "22"} height={compact ? "18" : "22"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth="2.5"/><path d="M21 21l-4.35-4.35" strokeWidth="2.5" strokeLinecap="round"/></svg>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault(); 
          }
        }}
        onFocus={(e) => {
          e.target.select();
          if (!compact && query.length >= 2) setShowSuggestions(true);
        }}
        placeholder="Ask anything..."
        className={`flex-1 w-full bg-transparent border-none outline-none text-white placeholder:text-neutral-600 ml-3 ${compact ? 'text-[15px]' : 'text-[18px]'}`}
      />
      {compact && (
        <div className="flex items-center gap-2">
          <button 
            onClick={() => { onSearch(undefined); }}
            disabled={loading} 
            className="px-4 py-1.5 bg-white text-black rounded-full font-bold text-[12px] hover:bg-neutral-200 transition-colors"
          >
            SEARCH
          </button>
        </div>
      )}
      {loading && (
        <div className="ml-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      )}
    </div>

    {!compact && (
      <div className="mt-6 flex flex-col items-center gap-4">
        <button 
          onClick={() => { onSearch(undefined); }}
          disabled={loading} 
          className="bg-white text-black px-12 py-3.5 rounded-full font-bold text-[16px] hover:bg-neutral-100 transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)] uppercase tracking-widest"
        >
          {loading ? 'Analyzing...' : 'Begin Search'}
        </button>
        
        <div className="flex flex-col items-center text-center max-w-md">
          <div className="flex items-center gap-6 bg-neutral-900/50 border border-neutral-800 px-5 py-2.5 rounded-2xl">
             <div className="flex flex-col items-center">
               <span className="text-white font-bold text-[15px]">{(tokensRemaining / 1000).toFixed(0)}k</span>
               <span className="text-[9px] text-neutral-500 uppercase tracking-[0.15em] font-bold">Tokens</span>
             </div>
             <div className="w-px h-6 bg-neutral-800" />
             <div className="flex flex-col items-center">
               <span className="text-white font-bold text-[15px]">{searchesRemaining}</span>
               <span className="text-[9px] text-neutral-500 uppercase tracking-[0.15em] font-bold">Scans</span>
             </div>
          </div>
        </div>
      </div>
    )}

    {showSuggestions && suggestions.length > 0 && (
      <div className="absolute top-full left-0 right-0 mt-3 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden z-50 py-2">
        {suggestions.map((s, i) => (
          <button type="button" key={i} onClick={() => { setQuery(s); onSearch(undefined, { q: s }); }} className="w-full text-left px-6 py-3 text-[15px] text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors flex items-center gap-3">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="text-neutral-500"><circle cx="11" cy="11" r="8" strokeWidth="2"/><path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round"/></svg>
            {s}
          </button>
        ))}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Error classifier — maps raw API error strings to friendly UI descriptions
// ---------------------------------------------------------------------------
type ParsedError = {
  icon: string;
  title: string;
  message: string;
  hint: string;
  retryable: boolean;
  retryLabel?: string;
};

function parseError(raw: string): ParsedError {
  const r = raw.toLowerCase();

  if (r.includes('rate_token_limit_exceeded') || r.includes('token rate limit')) {
    return {
      icon: '⏳',
      title: 'High traffic right now',
      message: 'Redex processes thousands of tokens per search. The AI embedding layer hit its per-minute limit.',
      hint: 'Wait about 60 seconds, then try again — the limit resets every minute.',
      retryable: true,
      retryLabel: 'Retry in a moment',
    };
  }
  if (r.includes('concurrency')) {
    return {
      icon: '🔄',
      title: 'Too many searches at once',
      message: 'Multiple searches are running in parallel and the AI model is at capacity.',
      hint: 'Give it a second — this usually resolves on its own.',
      retryable: true,
      retryLabel: 'Try Again',
    };
  }
  if (r.includes('jina_no_balance') || r.includes('insufficient account balance') || r.includes('authz_insufficient_balance')) {
    return {
      icon: '💳',
      title: 'Jina AI balance empty',
      message: 'The AI embedding service ran out of credits. Search is temporarily unavailable.',
      hint: 'The site owner needs to top up the Jina AI account at jina.ai/api-dashboard.',
      retryable: false,
    };
  }
  if (r.includes('jina_bad_key') || r.includes('jina_auth_error') || r.includes('invalid_token')) {
    return {
      icon: '🔑',
      title: 'AI service authentication failed',
      message: 'The Jina AI API key is invalid or expired.',
      hint: 'The site owner needs to update the JINA_API_KEY environment variable.',
      retryable: false,
    };
  }
  if (r.includes('jina') || r.includes('embedding') || r.includes('429')) {
    return {
      icon: '🤖',
      title: 'AI service temporarily busy',
      message: 'The semantic embedding service returned an error.',
      hint: 'This is usually transient. Try again in a few seconds.',
      retryable: true,
      retryLabel: 'Try Again',
    };
  }
  if (r.includes('failed to fetch') || r.includes('networkerror') || r.includes('network')) {
    return {
      icon: '📡',
      title: 'Connection issue',
      message: 'Could not reach the Redex server.',
      hint: 'Check your internet connection and try again.',
      retryable: true,
      retryLabel: 'Retry',
    };
  }
  if (r.includes('database') || r.includes('prisma') || r.includes('neon')) {
    return {
      icon: '🗄️',
      title: 'Database temporarily unavailable',
      message: 'The search index could not be reached. Results may be incomplete.',
      hint: 'The service should recover shortly.',
      retryable: true,
      retryLabel: 'Try Again',
    };
  }
  if (r.includes('query too short')) {
    return {
      icon: '✏️',
      title: 'Query too short',
      message: 'Please type at least 2 characters to search.',
      hint: 'Try something more specific — the more words, the better the results.',
      retryable: false,
    };
  }
  // Fallback
  return {
    icon: '⚠️',
    title: 'Something went wrong',
    message: 'An unexpected error occurred during the search.',
    hint: 'Try again, or refresh the page if it keeps happening.',
    retryable: true,
    retryLabel: 'Try Again',
  };
}

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
  const [selectedSubs] = useState<string[]>(searchParams.get("subreddits")?.split(",") || []);
  
  // UI State
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [meta, setMeta] = useState<{ time: number; cached: boolean } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState("Scouring Reddit archives...");
  const [error, setError] = useState<string | null>(null);

  // Refs to stabilize onSearch and prevent identity-change loops
  const lastSearchRef = useRef<string>("");
  const resultsRef = useRef<SearchResult[]>([]);
  const isSearchingRef = useRef<boolean>(false);
  const hasSearchedRef = useRef<boolean>(!!searchParams.get("q"));

  // In-memory results cache: query → { results, meta } — powers instant back navigation
  const resultsCacheRef = useRef<Map<string, { results: SearchResult[]; meta: { time: number; cached: boolean } | null }>>(new Map());
  // Navigation stack of queries — lets us pop back to the previous search
  const navStackRef = useRef<string[]>([]);

  // Persistent Stats (Google Strategy: 100 high-precision searches)
  const [tokensRemaining, setTokensRemaining] = useState(3500000);
  const [searchesRemaining, setSearchesRemaining] = useState(100);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  useEffect(() => {
    const savedTokens = localStorage.getItem('redex_tokens');
    const savedSearches = localStorage.getItem('redex_searches');
    const savedHistory = localStorage.getItem('redex_history');
    setTimeout(() => {
      if (savedTokens) setTokensRemaining(parseInt(savedTokens));
      if (savedSearches) setSearchesRemaining(parseInt(savedSearches));
      if (savedHistory) setSearchHistory(JSON.parse(savedHistory));
    }, 0);
  }, []);

  const addToHistory = useCallback((q: string) => {
    setSearchHistory(prev => {
      const filtered = prev.filter(item => item !== q);
      const next = [q, ...filtered].slice(0, 5);
      localStorage.setItem('redex_history', JSON.stringify(next));
      return next;
    });
  }, []);

  const deductTokens = useCallback((isCached: boolean) => {
    if (isCached) return; 
    setTokensRemaining(prev => {
      const next = Math.max(0, prev - 35000);
      localStorage.setItem('redex_tokens', next.toString());
      return next;
    });
    setSearchesRemaining(prev => {
      const next = Math.max(0, prev - 1);
      localStorage.setItem('redex_searches', next.toString());
      return next;
    });
  }, []);

  // Initial Data
  useEffect(() => {
    fetch("/api/subreddits")
      .then((res) => res.ok ? res.json() : { subreddits: [] })
      .then(() => {})
      .catch(() => {});
  }, []);

  // Search Logic
  const onSearch = useCallback(async (e?: React.FormEvent, overrideParams?: { q?: string; sort?: string; type?: string; dateRange?: string; refresh?: boolean }) => {
    e?.preventDefault();
    if (isSearchingRef.current) return;

    const q = (overrideParams?.q || query).trim();
    if (!q || q.length < 2) return;

    const shouldRefresh = overrideParams?.refresh || false;
    
    // NEW SEARCH RESET: If query changed or refreshing, reset filters to default
    const isNewQuery = q !== new URLSearchParams(window.location.search).get('q');
    if (isNewQuery || shouldRefresh) {
      setType('all');
      setDateRange('all');
    }

    const newSort      = overrideParams?.sort || sort;
    const newType      = isNewQuery ? 'all' : (overrideParams?.type || type);
    const newDateRange = isNewQuery ? 'all' : (overrideParams?.dateRange || dateRange);

    // Build a unique search signature
    const searchSig = `${q}|${newSort}|${newType}|${newDateRange}|${shouldRefresh}`;
    
    // BREAK LOOP: If this exact search was just performed, stop.
    if (searchSig === lastSearchRef.current) return;

    // Sync input field
    if (overrideParams?.q) setQuery(overrideParams.q);

    // TOKEN PROTECTION: Local re-sort if same query (Now handled by client-side filter useEffect)
    // But we still need to handle URL updates for query/refresh
    const currentUrlQ = new URLSearchParams(window.location.search).get('q');
    if (!isNewQuery && !shouldRefresh) {
      // Just updating filters locally - skip API
      lastSearchRef.current = searchSig;
      return;
    }

    isSearchingRef.current = true;
    setLoading(true);
    setHasSearched(true);
    hasSearchedRef.current = true;
    setShowSuggestions(false);
    lastSearchRef.current = searchSig;
    
    const params = new URLSearchParams({
      q,
      sort: 'relevance', // Always search by relevance initially
      type: 'all',
      dateRange: 'all',
      minUpvotes: "0",
      ...(selectedSubs.length > 0 && { subreddits: selectedSubs.join(",") }),
      ...(shouldRefresh && { refresh: "true" }) 
    });

    isProgrammaticNavRef.current = true;
    router.push(`?${params.toString()}`, { scroll: false });

    try {
      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.details || data.error || 'Search failed');

      const searchResults = data.results || [];
      resultsRef.current = searchResults;
      
      // Store in in-memory cache for instant back navigation
      const metaVal = { time: data.queryTime, cached: data.cached };
      resultsCacheRef.current.set(q, { results: searchResults, meta: metaVal });

      // Push to navigation stack only if this is a NEW query (not the same as top)
      if (navStackRef.current[navStackRef.current.length - 1] !== q) {
        navStackRef.current.push(q);
      }

      // Initial results (unfiltered)
      setResults(searchResults);
      setMeta(metaVal);
      setError(null);
      
      if (!data.cached) {
        addToHistory(q);
        deductTokens(false);
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown search error';
      setError(msg);
      setResults([]);
      resultsRef.current = [];
    } finally {
      setLoading(false);
      isSearchingRef.current = false;
    }
  }, [query, sort, type, dateRange, selectedSubs, router, addToHistory, deductTokens]);

  // Client-side Filter/Sort Effect (Saves Tokens)
  useEffect(() => {
    if (!resultsRef.current.length) return;

    let filtered = [...resultsRef.current];

    // 1. Filter by Type
    if (type !== 'all') {
      filtered = filtered.filter(r => r.type === type);
    }

    // 2. Filter by Date Range
    if (dateRange !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === 'week') cutoff.setDate(now.getDate() - 7);
      else if (dateRange === 'month') cutoff.setMonth(now.getMonth() - 1);
      else if (dateRange === 'year') cutoff.setFullYear(now.getFullYear() - 1);
      
      filtered = filtered.filter(r => new Date(r.redditCreatedAt) >= cutoff);
    }

    // 3. Sort
    if (sort === 'top') {
      filtered.sort((a, b) => b.upvotes - a.upvotes);
    } else {
      // Relevance is handled by the initial Jina/Vector score
      filtered.sort((a, b) => b.similarity - a.similarity);
    }

    setResults(filtered);
  }, [type, dateRange, sort]);

  // Track whether a URL change was triggered by the back/forward browser buttons
  // (popstate) vs by our own router.push() calls inside onSearch.
  // When it's a browser navigation event we should RESET to home rather than
  // re-firing onSearch (which causes the infinite loop).
  const isProgrammaticNavRef = useRef(false);

  // Handle URL changes & sync
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      // If this URL change came from our own router.push() inside onSearch or back,
      // skip re-running onSearch to break the loop.
      if (isProgrammaticNavRef.current) {
        isProgrammaticNavRef.current = false;
        return;
      }
      // Browser native back/forward: try to restore from in-memory cache first
      const cachedEntry = resultsCacheRef.current.get(q);
      if (cachedEntry) {
        setQuery(q);
        setHasSearched(true);
        hasSearchedRef.current = true;
        resultsRef.current = cachedEntry.results;
        setResults(cachedEntry.results);
        setMeta(cachedEntry.meta);
        setError(null);
        setType('all');
        setDateRange('all');
        lastSearchRef.current = `${q}|relevance|all|all|false`;
        return;
      }
      const currentSig = `${q}|${searchParams.get('sort') || 'relevance'}|${searchParams.get('type') || 'all'}|${searchParams.get('dateRange') || 'all'}|${searchParams.get('refresh') === 'true'}`;
      if (currentSig !== lastSearchRef.current) {
        onSearch(undefined, { 
          q, 
          sort: searchParams.get('sort') || undefined,
          type: searchParams.get('type') || undefined,
          dateRange: searchParams.get('dateRange') || undefined,
          refresh: searchParams.get('refresh') === 'true'
        });
      }
    } else {
      setHasSearched(false);
      hasSearchedRef.current = false;
      setResults([]);
      resultsRef.current = [];
      lastSearchRef.current = "";
      setError(null);
      setMeta(null);
    }
  }, [searchParams, onSearch]);

  // Flag our own router.push() calls so the URL-sync effect above can ignore them
  useEffect(() => {
    isProgrammaticNavRef.current = true;
  }, []);

  // Suggestion Logic
  useEffect(() => {
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (q.length >= 2 && !hasSearchedRef.current) {
        try {
          const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions((data.suggestions?.length || 0) > 0);
        } catch { setSuggestions([]); }
      } else { setShowSuggestions(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Loading Status Logic
  useEffect(() => {
    if (!loading) return;
    
    const messages = [
      "Analyzing semantic intent...",
      "Querying Reddit archives...",
      "Rank-scoring threads...",
      "Applying hybrid popularity filters...",
      "Optimizing result accuracy..."
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setLoadingStatus(messages[i]);
    }, 1500);
    
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-white selection:bg-white selection:text-black">
      {/* Navigation / Header */}
      <header className={`w-full transition-all duration-300 sticky top-0 z-40 bg-neutral-950/80 backdrop-blur-md ${hasSearched ? 'border-b border-neutral-900 py-3' : 'px-8 py-6'}`}>
        <div className={`flex items-center ${hasSearched ? 'max-w-5xl mx-auto px-6 w-full gap-6' : 'justify-between'}`}>
          
          {hasSearched && (
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  // Pop the current query off the stack
                  navStackRef.current.pop();
                  const prevQuery = navStackRef.current[navStackRef.current.length - 1];

                  if (prevQuery) {
                    // Restore previous search results instantly from cache
                    const cached = resultsCacheRef.current.get(prevQuery);
                    if (cached) {
                      setQuery(prevQuery);
                      resultsRef.current = cached.results;
                      setResults(cached.results);
                      setMeta(cached.meta);
                      setError(null);
                      setType('all');
                      setDateRange('all');
                      lastSearchRef.current = `${prevQuery}|relevance|all|all|false`;
                      isProgrammaticNavRef.current = true;
                      router.push(`?q=${encodeURIComponent(prevQuery)}`, { scroll: false });
                    }
                  } else {
                    // No previous search — go home
                    setHasSearched(false);
                    hasSearchedRef.current = false;
                    setResults([]);
                    resultsRef.current = [];
                    setQuery("");
                    lastSearchRef.current = "";
                    setError(null);
                    setMeta(null);
                    router.push("/");
                  }
                }}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition-all active:scale-90"
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M15 19l-7-7 7-7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div 
                onClick={() => { setHasSearched(false); setQuery(""); router.push("/"); }}
                className="cursor-pointer flex items-center gap-2.5 group shrink-0"
              >
              <div className={`bg-white flex items-center justify-center text-black font-bold font-display transition-all w-7 h-7 rounded-[7px] text-base`}>
                R
              </div>
              <span className={`font-display font-bold tracking-tight text-white text-lg`}>Redex</span>
              </div>
            </div>
          )}
            
          {/* Top Search Bar (Grouped with logo and left-aligned) */}
          {hasSearched && (
            <div className="hidden md:block w-[580px]">
              <SearchInputUI 
                compact={true} 
                query={query} 
                setQuery={setQuery} 
                onSearch={onSearch} 
                loading={loading} 
                showSuggestions={showSuggestions} 
                setShowSuggestions={setShowSuggestions} 
                suggestions={suggestions}
                tokensRemaining={tokensRemaining}
                searchesRemaining={searchesRemaining}
              />
            </div>
          )}

          {!hasSearched ? (
            <a href="/admin" className="text-[13px] font-semibold text-neutral-400 hover:text-white transition-colors shrink-0">
              Admin Console
            </a>
          ) : (
            <div className="ml-auto hidden md:block">
              <a href="/admin" className="text-[12px] font-semibold text-neutral-500 hover:text-white transition-colors">
                Admin Console
              </a>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        
        {/* LANDING PAGE STATE */}
        {!hasSearched && (
          <div className="w-full min-h-[calc(100vh-76px)] flex flex-col items-center justify-center px-6 animate-in fade-in duration-700">
            
            <div className="flex flex-col items-center w-full max-w-4xl -mt-10">
              {/* Hero */}
              <p className="text-[13px] font-semibold tracking-[0.18em] uppercase text-neutral-500 mb-5">AI-Powered Discovery</p>
              <h1 className="text-5xl md:text-[68px] font-display font-bold text-white mb-8 tracking-tight text-center leading-[1.05]">
                Semantic intelligence<br />for Reddit.
              </h1>

              <SearchInputUI 
                query={query} 
                setQuery={setQuery} 
                onSearch={onSearch} 
                loading={loading} 
                showSuggestions={showSuggestions} 
                setShowSuggestions={setShowSuggestions} 
                suggestions={suggestions}
                tokensRemaining={tokensRemaining}
                searchesRemaining={searchesRemaining}
              />

              {/* Feature Pills */}
              <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
                {[
                  {
                    icon: (
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ),
                    label: 'Semantic Search',
                    desc: 'Meaning over keywords'
                  },
                  {
                    icon: (
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ),
                    label: 'Live + Indexed',
                    desc: 'Real-time & Archives'
                  },
                  {
                    icon: (
                      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ),
                    label: 'Ranked by Votes',
                    desc: 'Community-validated'
                  },
                ].map(({ icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3 bg-neutral-900 border border-neutral-800 rounded-2xl px-5 py-4 shadow-xl">
                    <div className="mt-0.5 w-8 h-8 rounded-xl bg-white flex items-center justify-center text-black shrink-0">
                      {icon}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-white mb-0.5">{label}</p>
                      <p className="text-[12px] text-neutral-500 leading-snug">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-10 text-[12px] text-neutral-500 tracking-wide opacity-50 hover:opacity-100 transition-opacity">
                Powered by <span className="font-semibold text-neutral-300">pgvector</span> &amp; <span className="font-semibold text-neutral-300">Jina AI</span>
              </p>
            </div>
          </div>
        )}

        {/* RESULTS PAGE STATE */}
        {hasSearched && (
          <div className="w-full max-w-5xl mx-auto px-6 py-6 animate-in fade-in duration-500">
            
            {/* Mobile Search Bar (Only visible on small screens) */}
            <div className="md:hidden mb-6 w-full">
              <SearchInputUI 
                compact={true} 
                query={query} 
                setQuery={setQuery} 
                onSearch={onSearch} 
                loading={loading} 
                showSuggestions={showSuggestions} 
                setShowSuggestions={setShowSuggestions} 
                suggestions={suggestions}
                tokensRemaining={tokensRemaining}
                searchesRemaining={searchesRemaining}
              />

              {/* Recent Searches */}
              {searchHistory.length > 0 && (
                <div className="mt-8 flex flex-wrap items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                  <span className="text-[11px] font-bold text-neutral-600 uppercase tracking-widest mr-2">Recent Intelligence:</span>
                  {searchHistory.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => { setQuery(h); onSearch(undefined, { q: h }); }}
                      className="px-3 py-1.5 bg-neutral-900/50 border border-neutral-800 rounded-full text-[12px] text-neutral-400 hover:text-white hover:border-neutral-600 transition-all"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col lg:flex-row gap-10">
              {/* Left Column: Results */}
              <div className="flex-1 max-w-3xl">
                {/* Meta & Tabs */}
                <div className="flex items-center gap-6 border-b border-neutral-900 mb-6 pb-2">
                  <div className="flex gap-6">
                    {[{id: 'all', label: 'All'}, {id: 'post', label: 'Posts'}, {id: 'comment', label: 'Comments'}].map(opt => (
                      <button 
                        key={opt.id} 
                        onClick={() => setType(opt.id)} 
                        className={`text-[14px] font-bold pb-2 border-b-2 transition-all ${type === opt.id ? 'border-white text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {meta && !loading && (
                    <div className="flex items-center gap-6 ml-auto">
                      <div className="flex flex-col items-end">
                        <div className="flex gap-2 text-[11px] text-neutral-600 font-bold uppercase tracking-widest">
                          <span>{searchesRemaining} Scans Remaining</span>
                          <span className="text-neutral-800">|</span>
                          <span>{(tokensRemaining / 1000).toFixed(0)}k Tokens</span>
                        </div>
                      </div>

                      <span className="text-[13px] text-neutral-500 min-w-[80px] text-right">
                        {results.length} results ({meta.time}ms)
                      </span>
                    </div>
                  )}
                </div>

                {loading ? (
                  <div className="py-16 animate-in fade-in duration-500">

                    {/* Radar + Scan core */}
                    <div className="relative mx-auto mb-10" style={{width: 96, height: 96}}>
                      {/* Outer ping ring */}
                      <span className="absolute inset-0 rounded-full bg-neutral-900 animate-radar" />
                      {/* Inner ring */}
                      <span className="absolute inset-3 rounded-full border border-neutral-800" />
                      {/* Core dot */}
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-3 h-3 rounded-full bg-white" />
                      </span>
                      {/* Scan line travelling across */}
                      <span
                        className="absolute left-0 right-0 h-px bg-white animate-scan"
                        style={{top: '50%'}}
                      />
                    </div>

                    {/* Status */}
                    <div className="text-center mb-8">
                      <p
                        key={loadingStatus}
                        className="text-[13px] font-medium text-neutral-500 animate-word-fade"
                      >
                        {loadingStatus}<span className="animate-blink">_</span>
                      </p>
                    </div>

                    {/* Progress bar */}
                    <div className="relative h-[2px] w-full max-w-xs mx-auto bg-neutral-900 rounded-full overflow-hidden mb-10">
                      <div className="absolute left-0 top-0 h-full bg-white rounded-full animate-progress" />
                      {/* shimmer overlay */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-1/3 animate-shimmer" />
                    </div>

                    {/* Ghost skeleton cards */}
                    <div className="space-y-5 opacity-10 pointer-events-none">
                      {[80, 60, 72].map((w, i) => (
                        <div key={i} className="flex flex-col gap-2.5">
                          <div className="h-3 rounded-full bg-neutral-800" style={{width: '30%'}} />
                          <div className="h-5 rounded-lg bg-neutral-800" style={{width: `${w}%`}} />
                          <div className="h-3 rounded-full bg-neutral-900" style={{width: '90%'}} />
                          <div className="h-3 rounded-full bg-neutral-900" style={{width: '65%'}} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : error ? (
                  (() => {
                    const parsed = parseError(error);
                    return (
                      <div className="py-16 animate-in fade-in duration-500">
                        {/* Icon */}
                        <div className="text-4xl text-center mb-6 select-none">{parsed.icon}</div>

                        {/* Card */}
                        <div className="max-w-sm mx-auto border border-neutral-800 bg-neutral-900 rounded-2xl overflow-hidden">
                          <div className="px-6 pt-6 pb-5">
                            <h3 className="text-[17px] font-semibold text-white mb-1.5 text-center">
                              {parsed.title}
                            </h3>
                            <p className="text-[13px] text-neutral-400 text-center leading-relaxed">
                              {parsed.message}
                            </p>
                          </div>

                          {/* Hint strip */}
                          <div className="bg-black/40 border-t border-neutral-800 px-6 py-3">
                            <p className="text-[12px] text-neutral-500 text-center leading-relaxed">
                              💡 {parsed.hint}
                            </p>
                          </div>
                        </div>

                        {/* Retry */}
                        {parsed.retryable && (
                          <div className="text-center mt-7">
                            <button
                              onClick={() => onSearch()}
                              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-[13px] font-bold hover:bg-neutral-200 transition-colors"
                            >
                              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              {parsed.retryLabel ?? 'Try Again'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : results.length === 0 ? (
                  <div className="py-16 animate-in fade-in duration-500">
                    {/* Empty icon */}
                    <div className="text-4xl text-center mb-6 select-none">🔍</div>

                    <div className="max-w-sm mx-auto border border-neutral-800 bg-neutral-900 rounded-2xl overflow-hidden shadow-2xl">
                      <div className="px-6 pt-6 pb-5">
                        <h3 className="text-[17px] font-semibold text-white mb-1.5 text-center">
                          No matches for &quot;{query}&quot;
                        </h3>
                        <p className="text-[13px] text-neutral-400 text-center leading-relaxed">
                          Try broader terms or switch to <strong className="text-neutral-300">Any time</strong> if you&apos;re on Recent.
                        </p>
                      </div>
                      <div className="bg-black/40 border-t border-neutral-800 px-6 py-3">
                        <p className="text-[12px] text-neutral-500 text-center leading-relaxed">
                          💡 Try broader terms, fewer words, or switch to <strong className="text-neutral-300">Any time</strong> if you&apos;re on Recent.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8 pb-20">
                    {results.map((r) => (
                      <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="block group">
                        {/* URL / Subreddit Context */}
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <div className="w-7 h-7 bg-neutral-900 rounded-full flex items-center justify-center text-[13px] font-bold text-neutral-400 border border-neutral-800">
                            r/
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[13px] font-medium text-white line-clamp-1 hover:underline">
                              reddit.com/r/{r.subreddit}
                            </span>
                            <span className="text-[11px] text-neutral-500 line-clamp-1">
                              u/{r.author} &bull; {new Date(r.redditCreatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric'})}
                            </span>
                          </div>
                        </div>
                        
                        {/* Title (Link) */}
                        <h3 className="text-[20px] text-sky-400 group-hover:underline font-medium leading-snug mb-1">
                          {r.type === 'post' ? r.title : `Comment on: ${r.url.split('/').pop()?.replace(/_/g, ' ') || 'Thread'}`}
                        </h3>

                        {/* Snippet */}
                        {r.content && r.content !== "[removed]" && (
                          <p className="text-[14px] text-neutral-300 leading-relaxed line-clamp-2">
                            {r.content}
                          </p>
                        )}
                        
                        {/* Tags */}
                        <div className="mt-2 flex gap-3 text-[12px] font-bold">
                          <span className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-900/50">
                            {(r.similarity*100).toFixed(0)}% Match
                          </span>

                          {/* NEW: Source Badges */}
                          {r.isLive ? (
                            <span 
                              title="Fetched live from Reddit — being saved to index"
                              className="text-sky-400 bg-sky-950/40 px-2 py-0.5 rounded flex items-center gap-1 cursor-help border border-sky-900/50"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block animate-pulse" />
                              Live
                            </span>
                          ) : (
                            <span 
                              title="From semantic index — instant recall"
                              className="text-violet-400 bg-violet-950/40 px-2 py-0.5 rounded flex items-center gap-1 cursor-help border border-violet-900/50"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                              Indexed
                            </span>
                          )}

                          <span className="text-neutral-500 flex items-center gap-1">👍 {r.upvotes}</span>
                          {r.type === 'comment' && (
                            <span className="text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">Comment</span>
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
                        onClick={() => setDateRange(opt.id)} 
                        className={`text-left text-[14px] px-3 py-2 rounded-lg transition-colors ${dateRange === opt.id ? 'bg-neutral-900 text-white font-bold border border-neutral-800' : 'text-neutral-500 hover:bg-neutral-900 hover:text-white'}`}
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
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="w-8 h-8 border-4 border-neutral-900 border-t-white rounded-full animate-spin"></div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}

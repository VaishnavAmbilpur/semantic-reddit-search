"use client";
/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { timeAgo } from "@/lib/utils";

interface SearchResult {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  url: string;
  upvotes: number;
  commentCount: number;
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
  searchHistory?: string[];
}

const SearchInputUI = ({ 
  compact, 
  query, 
  setQuery, 
  onSearch, 
  loading, 
  searchHistory = []
}: SearchInputProps) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={`relative w-full ${compact ? 'max-w-3xl' : 'max-w-2xl'} mx-auto`}>
      <div className={`relative flex items-center bg-neutral-900/30 backdrop-blur-xl border border-neutral-800/80 hover:border-neutral-700/80 focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-600 transition-all duration-300 ${compact ? 'rounded-full px-4 py-1.5' : 'rounded-3xl px-6 py-4 shadow-2xl'}`}>
        <div className={`transition-colors duration-300 ${compact ? 'text-white' : 'text-neutral-500'} shrink-0`}>
          <svg width={compact ? "18" : "22"} height={compact ? "18" : "22"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" strokeWidth="2.5"/><path d="M21 21l-4.35-4.35" strokeWidth="2.5" strokeLinecap="round"/></svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSearch(undefined);
            }
          }}
          onFocus={(e) => { 
            e.target.select(); 
            setIsFocused(true); 
          }}
          onBlur={() => {
            // Delay closing to allow onMouseDown to fire on history buttons
            setTimeout(() => setIsFocused(false), 200);
          }}
          placeholder="Scour Reddit archives semantically..."
          className={`flex-1 w-full bg-transparent border-none outline-none text-white placeholder:text-neutral-500 ml-3 transition-colors duration-300 ${compact ? 'text-[14px]' : 'text-[16px] font-light tracking-wide'}`}
        />
        {compact && (
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => { onSearch(undefined); }}
              disabled={loading} 
              className="px-4 py-1.5 bg-white hover:bg-neutral-200 text-black rounded-full font-bold text-[11px] uppercase tracking-wider transition-all duration-200 active:scale-95 shadow-[0_2px_10px_rgba(255,255,255,0.1)]"
            >
              SEARCH
            </button>
          </div>
        )}
        {loading && (
          <div className="ml-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"></div>
        )}
      </div>

      {/* Dropdown for history when input is focused and query is empty */}
      {isFocused && query === '' && searchHistory.length > 0 && (
        <div className="absolute left-0 right-0 mt-2 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 rounded-2xl shadow-2xl p-3 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 max-w-full">
          <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1.5 px-2">Recent Searches</div>
          <div className="flex flex-col gap-0.5">
            {searchHistory.map((q, idx) => (
              <button 
                key={idx} 
                onMouseDown={() => {
                  setQuery(q);
                  // Give it a tiny tick to make sure the state is updated and run search
                  setTimeout(() => onSearch(undefined, { q }), 50);
                }}
                className="flex items-center gap-3 px-3 py-2 text-[13px] text-neutral-300 hover:text-white hover:bg-neutral-800/60 rounded-xl transition-all text-left w-full"
              >
                <span className="text-neutral-500">↩</span>
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!compact && (
        <div className="mt-8 flex flex-col items-center gap-6">
          <button 
            onClick={() => { onSearch(undefined); }}
            disabled={loading} 
            className="bg-white hover:bg-neutral-200 text-black px-12 py-3.5 rounded-full font-bold text-[13px] uppercase tracking-[0.2em] transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] shadow-[0_4px_30px_rgba(255,255,255,0.12)] shrink-0"
          >
            {loading ? 'Analyzing intent...' : 'Begin scan'}
          </button>
        </div>
      )}
    </div>
  );
};

// Maps raw API error strings to friendly UI descriptions
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
  if (r.includes('jina_no_balance') || r.includes('insufficient account balance') || r.includes('authz_insufficient_balance') || r.includes('hf_no_balance')) {
    return {
      icon: '💳',
      title: 'Hugging Face limit reached',
      message: 'The AI embedding service ran out of credits. Search is temporarily unavailable.',
      hint: 'The site owner needs to verify the Hugging Face account status.',
      retryable: false,
    };
  }
  if (r.includes('global search limit reached')) {
    return {
      icon: '🌍',
      title: 'Global Search Limit Reached',
      message: 'The global pool of 100 searches has been exhausted by the community.',
      hint: 'Please wait for the site owner to reset the limit or increase the quota.',
      retryable: false,
    };
  }
  if (r.includes('jina_bad_key') || r.includes('jina_auth_error') || r.includes('invalid_token') || r.includes('hf_bad_key')) {
    return {
      icon: '🔑',
      title: 'AI service authentication failed',
      message: 'The Hugging Face API key is invalid or expired.',
      hint: 'The site owner needs to update the HUGGING_FACE_API_KEY environment variable.',
      retryable: false,
    };
  }
  if (r.includes('jina') || r.includes('huggingface') || r.includes('hf') || r.includes('embedding') || r.includes('429')) {
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
  if (r.includes('database') || r.includes('pinecone')) {
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

  // Core states for semantic query and results
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const queryRef = useRef(searchParams.get("q") || "");

  const setQueryAndRef = useCallback((val: string) => {
    queryRef.current = val;
    setQuery(val);
  }, []);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!searchParams.get("q"));

  // Bookmarks removed
  
  // Active filters and subset scopes
  const [sort, setSort] = useState(searchParams.get("sort") || "relevance");
  const [type, setType] = useState(searchParams.get("type") || "all");
  const [dateRange, setDateRange] = useState(searchParams.get("dateRange") || "all");
  const [selectedSubs] = useState<string[]>(searchParams.get("subreddits")?.split(",") || []);
  
  // Status and response metadata
  const [meta, setMeta] = useState<{ time: number; cached: boolean } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState("Scouring Reddit archives...");
  const [error, setError] = useState<string | null>(null);

  // Search stable refs to prevent re-entrant loops
  const lastSearchRef = useRef<string>("");
  const resultsRef = useRef<SearchResult[]>([]);
  const isSearchingRef = useRef<boolean>(false);
  const hasSearchedRef = useRef<boolean>(!!searchParams.get("q"));

  // Navigation cache and stack references
  const resultsCacheRef = useRef<Map<string, { results: SearchResult[]; meta: { time: number; cached: boolean } | null }>>(new Map());
  const navStackRef = useRef<string[]>([]);

  // Global query quota state
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  // Retrieve dashboard and session metadata on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('redex_history');
    if (savedHistory) {
      setTimeout(() => setSearchHistory(JSON.parse(savedHistory)), 0);
    }
  }, []);

  const addToHistory = useCallback((q: string) => {
    setSearchHistory(prev => {
      const filtered = prev.filter(item => item !== q);
      const next = [q, ...filtered].slice(0, 5);
      localStorage.setItem('redex_history', JSON.stringify(next));
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

    const q = (overrideParams?.q || queryRef.current).trim();
    if (!q || q.length < 2) return;

    const shouldRefresh = overrideParams?.refresh || false;
    
    // NEW SEARCH RESET: If query changed or refreshing, reset filters to default
    const isNewQuery = q !== searchParams.get('q');
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
    if (overrideParams?.q) setQueryAndRef(overrideParams.q);

    // Skip remote search when updating local search filters
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
    lastSearchRef.current = searchSig;
    
    const params = new URLSearchParams({
      q,
      sort: 'relevance',
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
      
      // Cache results and track in history stack
      const metaVal = { time: data.queryTime, cached: data.cached };
      resultsCacheRef.current.set(q, { results: searchResults, meta: metaVal });

      if (navStackRef.current[navStackRef.current.length - 1] !== q) {
        navStackRef.current.push(q);
      }

      // Initial results (unfiltered)
      setResults(searchResults);
      setMeta(metaVal);
      setError(null);
      
      if (!data.cached) {
        addToHistory(q);
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
  }, [sort, type, dateRange, selectedSubs, router, addToHistory, searchParams]);

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
    if (dateRange === 'week') {
      filtered.sort((a, b) => new Date(b.redditCreatedAt).getTime() - new Date(a.redditCreatedAt).getTime());
    } else if (sort === 'top') {
      filtered.sort((a, b) => b.upvotes - a.upvotes);
    } else {
      // Relevance is handled by the initial Hugging Face/Vector score
      filtered.sort((a, b) => b.similarity - a.similarity);
    }

    setResults(filtered);
  }, [type, dateRange, sort]);

  // Track whether a URL change was triggered by the back/forward browser buttons
  // (popstate) vs by our own router.push() calls inside onSearch.
  // When it's a browser navigation event we should RESET to home rather than
  // re-firing onSearch (which causes the infinite loop).
  const isProgrammaticNavRef = useRef(false);

  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

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
        setQueryAndRef(q);
        setHasSearched(true);
        hasSearchedRef.current = true;
        resultsRef.current = cachedEntry.results;
        setResults(cachedEntry.results);
        setMeta(cachedEntry.meta);
        setError(null);
        
        const urlType = searchParams.get('type') || 'all';
        const urlDateRange = searchParams.get('dateRange') || 'all';
        const urlSort = searchParams.get('sort') || 'relevance';
        
        setType(urlType);
        setDateRange(urlDateRange);
        setSort(urlSort);
        
        lastSearchRef.current = `${q}|${urlSort}|${urlType}|${urlDateRange}|false`;
        return;
      }
      const currentSig = `${q}|${searchParams.get('sort') || 'relevance'}|${searchParams.get('type') || 'all'}|${searchParams.get('dateRange') || 'all'}|${searchParams.get('refresh') === 'true'}`;
      if (currentSig !== lastSearchRef.current) {
        onSearchRef.current(undefined, { 
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
  }, [searchParams]);

  useEffect(() => {
    isProgrammaticNavRef.current = true;
  }, []);


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
                      setQueryAndRef(prevQuery);
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
                    setQueryAndRef("");
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
                onClick={() => { setHasSearched(false); setQueryAndRef(""); router.push("/"); }}
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
                setQuery={setQueryAndRef} 
                onSearch={onSearch} 
                loading={loading} 
                searchHistory={searchHistory}
              />
            </div>
          )}

        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        
        {/* LANDING PAGE STATE */}
        {!hasSearched && (
          <div className="relative w-full min-h-[calc(100vh-76px)] flex flex-col items-center justify-center px-6 animate-in fade-in duration-700 bg-[radial-gradient(#ffffff06_1px,transparent_1px)] [background-size:32px_32px]">
            
            <div className="relative flex flex-col items-center w-full max-w-4xl -mt-20 z-10">
              {/* Hero Header */}
              <h1 className="text-4xl md:text-[56px] font-display font-extrabold text-white mb-8 tracking-tight text-center leading-tight">
                Redex <span className="text-neutral-500 font-light font-sans">- To search Reddit</span>
              </h1>

              <SearchInputUI 
                query={query} 
                setQuery={setQueryAndRef} 
                onSearch={onSearch} 
                loading={loading} 
                searchHistory={searchHistory}
              />
            </div>
          </div>
        )}

        {hasSearched && (
          <div className="w-full max-w-5xl mx-auto px-6 py-6 animate-in fade-in duration-500">
            
            {/* Mobile Search Bar (Only visible on small screens) */}
            <div className="md:hidden mb-6 w-full">
              <SearchInputUI 
                compact={true} 
                query={query} 
                setQuery={setQueryAndRef} 
                onSearch={onSearch} 
                loading={loading} 
                searchHistory={searchHistory}
              />

              {/* Recent Searches */}
              {searchHistory.length > 0 && (
                <div className="mt-8 flex flex-wrap items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                  <span className="text-[11px] font-bold text-neutral-600 uppercase tracking-widest mr-2">Recent Intelligence:</span>
                  {searchHistory.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => { setQueryAndRef(h); onSearch(undefined, { q: h }); }}
                      className="px-3 py-1.5 bg-neutral-900/50 border border-neutral-800 rounded-full text-[12px] text-neutral-400 hover:text-white hover:border-neutral-600 transition-all"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-w-3xl mx-auto w-full">
              {/* Results Container */}
              <div className="w-full">
                {/* Meta Stats */}
                <div className="flex items-center gap-6 border-b border-neutral-900 mb-6 pb-2">
                  {meta && !loading && (
                    <div className="flex items-center gap-6 w-full justify-end">
                      <span className="text-[13px] text-neutral-500">
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
                ) : (
                  <div className="space-y-6 pb-20">
                    {results.map((r) => (
                      <div key={r.id} className="relative group">
                        <a 
                          href={r.url} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="block p-6 bg-neutral-900/10 backdrop-blur-sm border border-neutral-900 hover:border-neutral-800/80 rounded-2xl transition-all duration-300 hover:-translate-y-0.5 shadow-sm hover:shadow-lg"
                        >
                          {/* URL / Subreddit Context */}
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-8 h-8 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-center text-[12px] font-bold text-neutral-300 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                              r/
                            </div>
                            <div className="flex flex-col pr-8">
                              <span className="text-[13px] font-bold text-white tracking-wide line-clamp-1 hover:underline">
                                reddit.com/r/{r.subreddit}
                              </span>
                              <span className="text-[11px] text-neutral-500 font-light mt-0.5">
                                u/{r.author} &bull; {r.upvotes} upvotes &bull; {timeAgo(r.redditCreatedAt)} &bull; {r.commentCount ?? 0} comments
                              </span>
                            </div>
                          </div>
                          
                          {/* Title */}
                          <h3 className="text-[18px] text-white group-hover:text-neutral-300 font-semibold leading-snug transition-colors duration-200">
                            {r.type === 'post' ? r.title : `Comment on thread: ${r.url.split('/').pop()?.replace(/_/g, ' ') || 'Thread'}`}
                          </h3>

                          {/* Snippet */}
                          {r.content && r.content !== "[removed]" && (
                            <p className="text-[13.5px] text-neutral-400 font-light leading-relaxed mt-2.5 mb-4 line-clamp-2">
                              {r.content}
                            </p>
                          )}
                          
                          {/* Tags */}
                          <div className="mt-4 flex flex-wrap gap-2.5 text-[11px] font-medium tracking-wide">
                            <span className="text-white bg-neutral-955 border border-neutral-850 px-2.5 py-1 rounded-md font-mono">
                              {(r.similarity*100).toFixed(0)}% Match
                            </span>

                            {/* Source Badges */}
                            {r.isLive ? (
                              <span 
                                title="Fetched live from Reddit — fresh but unverified"
                                className="text-sky-400 bg-sky-950/10 border border-sky-900/20 px-2.5 py-1 rounded-md font-mono flex items-center gap-1.5 cursor-help"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block animate-pulse" />
                                Live
                              </span>
                            ) : (
                              <span 
                                title="From semantic index — stable and indexed"
                                className="text-violet-400 bg-violet-950/10 border border-violet-900/20 px-2.5 py-1 rounded-md font-mono flex items-center gap-1.5 cursor-help"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                                Indexed
                              </span>
                            )}

                            <span className="text-neutral-400 bg-neutral-900/40 border border-neutral-800 px-2.5 py-1 rounded-md font-mono">👍 {r.upvotes} Votes</span>
                            
                            {r.type === 'comment' && (
                              <span className="text-neutral-300 bg-neutral-900/60 border border-neutral-800 px-2.5 py-1 rounded-md font-mono">Comment</span>
                            )}
                          </div>
                        </a>

                      </div>
                    ))}
                  </div>
                )}
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

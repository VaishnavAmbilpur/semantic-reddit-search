"use client";
import { useState, useEffect } from "react";

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [subredditInput, setSubredditInput] = useState("");
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("redex_admin_secret");
    if (saved) setSecret(saved);
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted) {
      if (secret) {
        setValidating(true);
        // Small delay to make the "Validating..." text visible for UX
        const timer = setTimeout(() => fetchJobs(), 600);
        return () => clearTimeout(timer);
      } else {
        setIsAuthenticated(false);
      }
    }
  }, [secret, isMounted]);

  const fetchJobs = async () => {
    if (!secret) return;
    const res = await fetch("/api/admin/jobs", {
      headers: { Authorization: `Bearer ${secret}` }
    });
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs);
      setIsAuthenticated(true);
      localStorage.setItem("redex_admin_secret", secret);
    } else {
      setIsAuthenticated(false);
    }
    setValidating(false);
  };

  const startIndexing = async () => {
    setLoading(true);
    const subs = subredditInput.split(",").map(s => s.trim()).filter(Boolean);
    
    for (const sub of subs) {
      const res = await fetch("/api/admin/index", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${secret}`
        },
        body: JSON.stringify({ name: sub })
      });
      if (!res.ok) alert(`Failed to start job for r/${sub}. Check if it exists.`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    setSubredditInput("");
    fetchJobs();
    setLoading(false);
  };

  const stopJob = async (id: string) => {
    await fetch(`/api/admin/jobs/${id}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` }
    });
    fetchJobs();
  };

  const fillFamousSubs = () => {
    setSubredditInput("webdev, cscareerquestions, reactjs, MachineLearning, sysadmin, SaaS, Entrepreneur, marketing, startups, productivity");
  };

  const logout = () => {
    localStorage.removeItem("redex_admin_secret");
    setSecret("");
    setIsAuthenticated(false);
  };

  useEffect(() => {
    const hasActiveJobs = jobs.some(j => j.status === 'PENDING' || j.status === 'ACTIVE');
    if (hasActiveJobs && isAuthenticated) {
      const interval = setInterval(fetchJobs, 3000);
      return () => clearInterval(interval);
    }
  }, [jobs, isAuthenticated]);

  if (!isMounted) return null; // Avoid hydration mismatch

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <header className="w-full px-6 py-5 flex items-center justify-between bg-white border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-neutral-900 rounded-lg flex items-center justify-center text-white font-bold font-display">
            R
          </div>
          <span className="font-display font-semibold text-lg tracking-tight text-neutral-900">Admin Console</span>
        </div>
        <a href="/" className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors">
          Back to Search
        </a>
      </header>

      {/* LOGIN SCREEN */}
      {!isAuthenticated ? (
        <main className="flex-1 w-full flex items-center justify-center px-6">
          <div className="bg-white border border-neutral-200 rounded-2xl p-10 shadow-sm w-full max-w-sm text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-12 h-12 bg-neutral-900 rounded-xl flex items-center justify-center text-white font-bold font-display mx-auto mb-6 text-xl shadow-inner">
              R
            </div>
            <h2 className="text-2xl font-display font-semibold text-neutral-900 mb-2">Secure Access</h2>
            <p className="text-sm text-neutral-500 mb-8">Enter your secret key to manage the semantic index.</p>
            
            <input 
              type="password" 
              placeholder="ADMIN_SECRET" 
              className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-4 outline-none focus:bg-white focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 transition-all text-sm font-mono text-center tracking-widest mb-4"
              value={secret}
              onChange={e => setSecret(e.target.value)}
            />
            
            <div className="h-6 flex items-center justify-center">
              {validating ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 animate-pulse flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-400"></div>
                  Validating...
                </span>
              ) : secret.length > 0 ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-red-500">
                  Invalid Secret
                </span>
              ) : null}
            </div>
          </div>
        </main>
      ) : (
        /* DASHBOARD SCREEN */
        <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-12 animate-in fade-in duration-700">
          <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-semibold text-neutral-900 mb-2">System Settings</h1>
              <p className="text-sm text-neutral-500">Manage your semantic index and monitor background ingestion jobs.</p>
            </div>
            <button onClick={logout} className="text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg transition-colors">
              Log Out
            </button>
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl p-8 mb-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-display font-semibold text-neutral-900">New Batch Indexing Job</h2>
              <button onClick={fillFamousSubs} className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-md transition-colors">
                Auto-fill Top 10 Subreddits
              </button>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Subreddit Targets (Comma Separated)</label>
              <div className="flex flex-col gap-3">
                <textarea 
                  placeholder="e.g. webdev, reactjs, startups" 
                  rows={2}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 outline-none focus:bg-white focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100 transition-all text-sm resize-none"
                  value={subredditInput}
                  onChange={e => setSubredditInput(e.target.value)}
                />
                <button 
                  onClick={startIndexing}
                  disabled={loading || !subredditInput}
                  className="bg-neutral-900 text-white w-full md:w-auto md:px-8 py-3 rounded-xl font-medium text-sm hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                >
                  {loading ? "Starting Batch..." : "Start Indexing"}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between p-6 border-b border-neutral-100">
              <h2 className="text-lg font-display font-semibold text-neutral-900">Job Telemetry</h2>
              <button onClick={fetchJobs} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 bg-neutral-100 px-3 py-1.5 rounded-md transition-colors">
                Refresh
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="p-12 text-center text-sm text-neutral-500">
                No jobs found. Start indexing a subreddit above!
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {jobs.map(job => (
                  <div key={job.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-neutral-50 transition-colors">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-semibold text-neutral-900">r/{job.subreddit.name}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                          job.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700 animate-pulse'
                        }`}>
                          {job.status}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 font-mono">ID: {job.id}</p>
                    </div>
                    
                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="text-xs text-neutral-500 font-medium">Processed</p>
                        <p className="text-sm font-semibold text-neutral-900">{job.chunksCompleted} chunks</p>
                      </div>

                      {(job.status === 'PENDING' || job.status === 'ACTIVE') && (
                        <button 
                          onClick={() => stopJob(job.id)}
                          className="bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 px-4 py-2 rounded-lg text-xs font-semibold shadow-sm transition-all"
                        >
                          Stop Job
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XPost, ArchiveFilter, ProcessStatus, AuditResult, PostType, PurgeProgress } from './types';
import { auditPosts } from './services/geminiService';
import { 
  Trash2, 
  Calendar, 
  Search, 
  Upload, 
  ShieldAlert, 
  Info, 
  CheckCircle2, 
  Filter,
  BarChart3,
  X,
  Clock,
  Pause,
  Play,
  Eye,
  Hash
} from 'lucide-react';

const DELETION_INTERVAL_MS = 6000; // 60s / 10 = 6s per item to stay within 10/min limit

const App: React.FC = () => {
  const [allPosts, setAllPosts] = useState<XPost[]>([]);
  const [filteredPosts, setFilteredPosts] = useState<XPost[]>([]);
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [auditResults, setAuditResults] = useState<Map<string, AuditResult>>(new Map());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'all' | 'keywords'>('all');
  
  const [filters, setFilters] = useState<ArchiveFilter>({
    dateFrom: '2010-01-01',
    dateTo: new Date().toISOString().split('T')[0],
    keywords: [],
    postTypes: ['tweet', 'reply', 'repost']
  });

  const [keywordInput, setKeywordInput] = useState('');
  
  // Purge Queue State
  const [purgeProgress, setPurgeProgress] = useState<PurgeProgress | null>(null);
  const purgeTimerRef = useRef<number | null>(null);
  const purgeQueueRef = useRef<XPost[]>([]);

  // Simulation logic for file parsing
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus(ProcessStatus.LOADING);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        let jsonStr = content;
        if (content.includes('window.YTD.tweet.part0 = ')) {
          jsonStr = content.replace('window.YTD.tweet.part0 = ', '');
        }
        
        const data = JSON.parse(jsonStr);
        const formatted: XPost[] = data.map((item: any) => {
          const t = item.tweet;
          let type: PostType = 'tweet';
          
          if (t.full_text.startsWith('RT @')) {
            type = 'repost';
          } else if (t.in_reply_to_status_id_str) {
            type = 'reply';
          }

          return {
            id: t.id_str,
            full_text: t.full_text,
            created_at: t.created_at,
            type,
            reply_to_user_id: t.in_reply_to_user_id_str,
            reply_to_status_id: t.in_reply_to_status_id_str,
            favorite_count: parseInt(t.favorite_count) || 0,
            retweet_count: parseInt(t.retweet_count) || 0
          };
        });

        setAllPosts(formatted);
        setStatus(ProcessStatus.IDLE);
      } catch (err) {
        console.error("Failed to parse archive", err);
        alert("Invalid archive file. Please ensure you are uploading the 'tweets.js' file from your X Archive.");
        setStatus(ProcessStatus.IDLE);
      }
    };
    reader.readAsText(file);
  };

  const applyFilters = useCallback(() => {
    let result = allPosts.filter(post => {
      const date = new Date(post.created_at);
      const from = new Date(filters.dateFrom);
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59);

      const withinDate = date >= from && date <= to;
      
      const matchesKeywords = filters.keywords.length === 0 || 
        filters.keywords.some(k => post.full_text.toLowerCase().includes(k.toLowerCase()));
      
      const matchesType = filters.postTypes.includes(post.type);
      
      // If preview mode is 'keywords', we force the keywords match
      const previewFilter = previewMode === 'keywords' ? (filters.keywords.length > 0 && matchesKeywords) : true;

      return withinDate && matchesKeywords && matchesType && previewFilter;
    });

    setFilteredPosts(result);
  }, [allPosts, filters, previewMode]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const handleAudit = async () => {
    if (filteredPosts.length === 0) return;
    setStatus(ProcessStatus.AUDITING);
    const results = await auditPosts(filteredPosts);
    setAuditResults(results);
    setStatus(ProcessStatus.IDLE);
  };

  // Rate-limited Purge Logic
  const startPurge = () => {
    if (filteredPosts.length === 0) return;
    const confirmed = confirm(`Safety Protocol: You are about to delete ${filteredPosts.length} posts. 
    
Rate Limiting will be applied:
- 1 post every 6 seconds (10/min)
- Estimated time: ${Math.round((filteredPosts.length * DELETION_INTERVAL_MS) / 1000 / 60)} minutes.
    
Proceed?`);

    if (confirmed) {
      purgeQueueRef.current = [...filteredPosts];
      setStatus(ProcessStatus.PURGING);
      setPurgeProgress({
        total: filteredPosts.length,
        completed: 0,
        remaining: filteredPosts.length,
        startTime: Date.now(),
        currentType: null,
        secondsToNext: 0
      });
    }
  };

  const stopPurge = () => {
    if (purgeTimerRef.current) window.clearTimeout(purgeTimerRef.current);
    setStatus(ProcessStatus.IDLE);
    setPurgeProgress(null);
  };

  useEffect(() => {
    if (status === ProcessStatus.PURGING && purgeQueueRef.current.length > 0) {
      const processNext = () => {
        const post = purgeQueueRef.current.shift();
        if (!post) {
          setStatus(ProcessStatus.COMPLETED);
          setTimeout(() => setStatus(ProcessStatus.IDLE), 5000);
          setPurgeProgress(null);
          return;
        }

        // Simulated API Call
        console.log(`Deleting ${post.type} ID: ${post.id}`);
        
        setAllPosts(prev => prev.filter(p => p.id !== post.id));
        setPurgeProgress(prev => prev ? ({
          ...prev,
          completed: prev.completed + 1,
          remaining: purgeQueueRef.current.length,
          currentType: post.type,
          secondsToNext: DELETION_INTERVAL_MS / 1000
        }) : null);

        // Schedule next with countdown
        let countdown = DELETION_INTERVAL_MS / 1000;
        const interval = setInterval(() => {
          countdown -= 1;
          setPurgeProgress(prev => prev ? ({ ...prev, secondsToNext: Math.max(0, countdown) }) : null);
          if (countdown <= 0) clearInterval(interval);
        }, 1000);

        purgeTimerRef.current = window.setTimeout(processNext, DELETION_INTERVAL_MS);
      };

      processNext();
    }
    return () => {
      if (purgeTimerRef.current) window.clearTimeout(purgeTimerRef.current);
    };
  }, [status]);

  const addKeyword = () => {
    if (keywordInput.trim()) {
      setFilters(prev => ({
        ...prev,
        keywords: [...new Set([...prev.keywords, keywordInput.trim()])]
      }));
      setKeywordInput('');
    }
  };

  const removeKeyword = (k: string) => {
    setFilters(prev => ({
      ...prev,
      keywords: prev.keywords.filter(kw => kw !== k)
    }));
  };

  const togglePostType = (type: PostType) => {
    setFilters(prev => ({
      ...prev,
      postTypes: prev.postTypes.includes(type) 
        ? prev.postTypes.filter(t => t !== type)
        : [...prev.postTypes, type]
    }));
  };

  // Helper to highlight matching keywords
  const highlightText = (text: string) => {
    if (filters.keywords.length === 0) return text;
    
    // Create a combined regex for all keywords
    const regex = new RegExp(`(${filters.keywords.join('|')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      filters.keywords.some(k => k.toLowerCase() === part.toLowerCase()) 
        ? <mark key={i} className="bg-blue-500/30 text-blue-200 rounded px-0.5 border-b border-blue-400 no-underline">{part}</mark> 
        : part
    );
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      {/* Header */}
      <header className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Trash2 className="text-blue-500" />
            X-Purge <span className="text-sm font-normal text-gray-400 bg-gray-800 px-2 py-0.5 rounded ml-2">Rate-Limited Deletion</span>
          </h1>
          <p className="text-gray-400 mt-1 font-medium">Manage your X history safely with precision filters.</p>
        </div>
        <div className="flex gap-3">
          <label className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-full font-medium cursor-pointer transition-colors flex items-center gap-2 shadow-lg shadow-blue-900/20">
            <Upload size={18} />
            Upload tweets.js
            <input type="file" className="hidden" accept=".js,.json" onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar Filters */}
        <aside className="lg:col-span-4 space-y-6">
          <section className="glass-panel p-6 rounded-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Filter size={20} className="text-blue-400" />
                Control Panel
              </h2>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm text-gray-400 mb-3 uppercase tracking-wider font-bold">Post Types</label>
                <div className="grid grid-cols-1 gap-2">
                  {(['tweet', 'reply', 'repost'] as PostType[]).map(type => (
                    <button
                      key={type}
                      onClick={() => togglePostType(type)}
                      className={`flex justify-between items-center p-3 rounded-xl border transition-all ${
                        filters.postTypes.includes(type) 
                        ? 'bg-blue-600/20 border-blue-500/50 text-blue-100' 
                        : 'bg-gray-900 border-gray-800 text-gray-500'
                      }`}
                    >
                      <span className="capitalize">{type}s</span>
                      <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                        filters.postTypes.includes(type) ? 'border-blue-400 bg-blue-500' : 'border-gray-700'
                      }`}>
                        {filters.postTypes.includes(type) && <CheckCircle2 size={12} className="text-white" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2 uppercase tracking-wider font-bold">Date Range</label>
                <div className="grid grid-cols-1 gap-3">
                  <div className="relative">
                    <Calendar className="absolute left-3 top-3 text-gray-500" size={16} />
                    <input 
                      type="date" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg p-2.5 pl-10 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={filters.dateFrom}
                      onChange={(e) => setFilters({...filters, dateFrom: e.target.value})}
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-3 text-gray-500" size={16} />
                    <input 
                      type="date" 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg p-2.5 pl-10 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={filters.dateTo}
                      onChange={(e) => setFilters({...filters, dateTo: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2 uppercase tracking-wider font-bold">Keywords & Preview</label>
                <div className="flex gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 text-gray-500" size={16} />
                    <input 
                      type="text" 
                      placeholder="Toxic word, ex-name..." 
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg p-2.5 pl-10 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                    />
                  </div>
                  <button 
                    onClick={addKeyword}
                    className="bg-gray-800 px-4 py-2 rounded-lg hover:bg-gray-700 font-medium text-sm"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filters.keywords.length === 0 && <span className="text-[10px] text-gray-600 italic">No keywords active</span>}
                  {filters.keywords.map(k => (
                    <span key={k} className="bg-blue-900/40 text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1 border border-blue-800 transition-all hover:bg-blue-900/60">
                      {k}
                      <button onClick={() => removeKeyword(k)} className="hover:text-white"><X size={12} /></button>
                    </span>
                  ))}
                </div>

                {filters.keywords.length > 0 && (
                  <div className="mt-6 space-y-3">
                    <button
                      onClick={() => setPreviewMode(previewMode === 'keywords' ? 'all' : 'keywords')}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                        previewMode === 'keywords' 
                        ? 'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/20' 
                        : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-700'
                      }`}
                    >
                      <Eye size={14} />
                      {previewMode === 'keywords' ? 'Showing Keyword Matches Only' : 'Preview Keyword Results'}
                    </button>
                    {previewMode === 'keywords' && (
                      <p className="text-[10px] text-blue-400/80 text-center leading-tight">
                        Displaying only posts containing your specified keywords. Matches are highlighted in the feed.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {allPosts.length > 0 && (
            <section className="glass-panel p-6 rounded-2xl">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <BarChart3 size={20} className="text-green-400" />
                Data Insights
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400 font-medium">Archive Loaded</span>
                  <span className="font-bold">{allPosts.length}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400 font-medium">Purge Target Count</span>
                  <span className="font-bold text-blue-400">{filteredPosts.length}</span>
                </div>
                {filters.keywords.length > 0 && (
                  <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-800/50 mt-2">
                    <span className="text-blue-400/70 font-bold flex items-center gap-1">
                      <Hash size={12} /> Keyword Hits
                    </span>
                    <span className="font-bold text-blue-300">
                      {allPosts.filter(p => filters.keywords.some(k => p.full_text.toLowerCase().includes(k.toLowerCase()))).length}
                    </span>
                  </div>
                )}
                <div className="pt-4 border-t border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase font-black mb-3 tracking-widest">Active Batch Breakdown</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-900 p-2 rounded-lg border border-gray-800/30">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">Tweets</div>
                      <div className="font-bold text-sm">{filteredPosts.filter(p => p.type === 'tweet').length}</div>
                    </div>
                    <div className="bg-gray-900 p-2 rounded-lg border border-gray-800/30">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">Replies</div>
                      <div className="font-bold text-sm">{filteredPosts.filter(p => p.type === 'reply').length}</div>
                    </div>
                    <div className="bg-gray-900 p-2 rounded-lg border border-gray-800/30">
                      <div className="text-[10px] text-gray-500 uppercase font-bold">Reposts</div>
                      <div className="font-bold text-sm">{filteredPosts.filter(p => p.type === 'repost').length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </aside>

        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-6">
          {/* Action Bar */}
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between glass-panel p-4 rounded-2xl sticky top-4 z-20">
            <div className="flex items-center gap-4">
               <span className="text-sm text-gray-400 font-semibold px-2 py-1 bg-gray-800 rounded-lg">
                {filteredPosts.length} Targeted for Purge
               </span>
               {previewMode === 'keywords' && (
                 <span className="text-[10px] bg-blue-500/20 text-blue-400 font-black uppercase px-2 py-1 rounded-md border border-blue-500/30">
                   Keyword Preview On
                 </span>
               )}
            </div>
            <div className="flex gap-3 w-full md:w-auto">
              <button 
                onClick={handleAudit}
                disabled={filteredPosts.length === 0 || status !== ProcessStatus.IDLE}
                className="flex-1 md:flex-none border border-gray-700 text-gray-300 px-6 py-2.5 rounded-full font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-all text-sm"
              >
                {status === ProcessStatus.AUDITING ? 'Auditing...' : <><ShieldAlert size={18} /> Run AI Audit</>}
              </button>
              <button 
                onClick={startPurge}
                disabled={filteredPosts.length === 0 || status !== ProcessStatus.IDLE}
                className="flex-1 md:flex-none bg-red-600 hover:bg-red-500 text-white px-8 py-2.5 rounded-full font-black disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-red-900/40 transition-all text-sm uppercase tracking-wider"
              >
                <Trash2 size={18} /> Safe Purge
              </button>
            </div>
          </div>

          {/* Purge Progress Dashboard */}
          {status === ProcessStatus.PURGING && purgeProgress && (
            <div className="glass-panel p-6 rounded-3xl border-red-900/30 bg-red-900/5 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-red-500/20">
                <div 
                   className="h-full bg-red-500 transition-all duration-1000"
                   style={{ width: `${(purgeProgress.completed / purgeProgress.total) * 100}%` }}
                />
              </div>
              
              <div className="flex justify-between items-start mb-6 pt-2">
                <div>
                  <h3 className="text-xl font-bold text-red-400 flex items-center gap-2">
                    <Clock className="animate-spin-slow" /> Purging Post History
                  </h3>
                  <p className="text-xs text-gray-400 mt-1 uppercase font-bold tracking-tighter">Respecting X Anti-Spam Rate Limits (10 Deletions/Min)</p>
                </div>
                <button 
                  onClick={stopPurge}
                  className="bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-200 border border-gray-700 hover:border-red-800 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
                >
                  <Pause size={14} /> Terminate
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 backdrop-blur-md">
                  <div className="text-[10px] text-gray-500 uppercase font-black mb-1 tracking-widest">In Queue</div>
                  <div className="text-3xl font-black">{purgeProgress.remaining} <span className="text-xs font-medium text-gray-600">Left</span></div>
                </div>
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 backdrop-blur-md">
                  <div className="text-[10px] text-gray-500 uppercase font-black mb-1 tracking-widest">Active Removal</div>
                  <div className="text-2xl font-bold capitalize text-blue-400">{purgeProgress.currentType || 'Syncing...'}</div>
                </div>
                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 backdrop-blur-md">
                  <div className="text-[10px] text-gray-500 uppercase font-black mb-1 tracking-widest">Next Request</div>
                  <div className="text-3xl font-black text-yellow-500 tabular-nums">{Math.ceil(purgeProgress.secondsToNext)}s</div>
                </div>
              </div>

              <div className="flex justify-between mt-2 text-[10px] text-gray-500 font-black uppercase tracking-widest">
                <span>Cleanup Progress: {purgeProgress.completed} removed</span>
                <span>{Math.round((purgeProgress.completed / purgeProgress.total) * 100)}%</span>
              </div>
            </div>
          )}

          {/* List Content */}
          <div className="space-y-4">
            {status === ProcessStatus.LOADING && (
              <div className="text-center py-32 bg-gray-900/20 rounded-[2rem] border-2 border-dashed border-gray-800">
                <div className="relative h-16 w-16 mx-auto mb-8">
                  <div className="absolute inset-0 animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
                  <Upload className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400" size={24} />
                </div>
                <p className="text-gray-300 font-black text-xl tracking-tight">Deciphering X Archive</p>
                <p className="text-gray-500 text-sm mt-2 max-w-xs mx-auto">Reconstructing your posting history from the local database files...</p>
              </div>
            )}

            {status === ProcessStatus.COMPLETED && (
              <div className="text-center py-24 bg-green-900/5 rounded-[2rem] border-2 border-dashed border-green-800/40">
                <div className="bg-green-500/10 h-24 w-24 rounded-full flex items-center justify-center mx-auto mb-8 border border-green-500/20">
                  <CheckCircle2 className="text-green-500" size={48} />
                </div>
                <p className="text-green-400 font-black text-3xl tracking-tight">Mission Accomplished</p>
                <p className="text-gray-400 mt-3 font-medium">The targeted digital records have been purged successfully.</p>
                <button 
                  onClick={() => setStatus(ProcessStatus.IDLE)}
                  className="mt-10 bg-gray-800 hover:bg-gray-700 px-10 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                >
                  Dismiss Report
                </button>
              </div>
            )}

            {status === ProcessStatus.IDLE && filteredPosts.length === 0 && (
              <div className="text-center py-40 bg-gray-900/10 rounded-[3rem] border-2 border-dashed border-gray-800/50">
                <div className="h-20 w-20 bg-gray-800/30 rounded-full flex items-center justify-center mx-auto mb-8 border border-gray-700/30">
                  <Info className="text-gray-700" size={40} />
                </div>
                <p className="text-gray-400 text-2xl font-black tracking-tight">No Purge Targets Found</p>
                {previewMode === 'keywords' ? (
                  <p className="text-sm text-gray-600 mt-3 max-w-sm mx-auto">No posts in the current selection contain the keywords you've entered. Try broader terms or adjusting the date range.</p>
                ) : (
                  <p className="text-sm text-gray-600 mt-3 max-w-xs mx-auto">Upload your <code className="bg-gray-800 px-2 py-0.5 rounded text-blue-400 font-mono">tweets.js</code> to initialize the cleanup engine.</p>
                )}
              </div>
            )}

            {(status === ProcessStatus.IDLE || status === ProcessStatus.AUDITING) && filteredPosts.map(post => {
              const audit = auditResults.get(post.id);
              
              return (
                <div key={post.id} className="glass-panel p-6 rounded-[1.5rem] hover:border-gray-500/50 transition-all group relative overflow-hidden border-transparent hover:shadow-xl hover:shadow-blue-500/5">
                  <div className="flex justify-between items-start mb-5">
                    <div className="flex gap-3 items-center">
                      <span className={`text-[10px] uppercase font-black tracking-widest px-3 py-1 rounded-lg border shadow-sm ${
                        post.type === 'tweet' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                        post.type === 'reply' ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' :
                        'bg-orange-500/10 border-orange-500/30 text-orange-400'
                      }`}>
                        {post.type}
                      </span>
                      <span className="text-[10px] text-gray-500 font-bold tabular-nums bg-white/5 px-2 py-1 rounded-md">
                        {new Date(post.created_at).toLocaleDateString()} • {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {audit && (
                      <div className="flex items-center gap-2">
                         <span className={`text-[10px] uppercase font-black px-3 py-1 rounded-full border shadow-lg ${
                          audit.riskLevel === 'High' ? 'bg-red-600 text-white border-red-500 shadow-red-900/20' :
                          audit.riskLevel === 'Medium' ? 'bg-yellow-500 text-black border-yellow-400 shadow-yellow-900/10' :
                          'bg-green-600 text-white border-green-500 shadow-green-900/10'
                        }`}>
                          {audit.riskLevel} Risk
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-gray-100 text-base leading-[1.6] font-medium">
                    {highlightText(post.full_text)}
                  </p>
                  
                  {audit && (
                    <div className="mt-6 p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 flex items-start gap-3 group-hover:bg-blue-500/10 transition-colors">
                      <ShieldAlert size={16} className="text-blue-400 mt-1 flex-shrink-0 animate-pulse" />
                      <div>
                        <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Gemini Audit Report</p>
                        <p className="text-sm text-gray-300 mt-1.5 leading-relaxed font-medium">{audit.reason}</p>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 pt-5 border-t border-white/5 flex gap-8 text-gray-600 text-[10px] font-black uppercase tracking-widest">
                    <div className="flex items-center gap-2 group-hover:text-pink-500/50 transition-colors">
                      <div className="h-2 w-2 rounded-full bg-pink-500/20" />
                      {post.favorite_count} Favorites
                    </div>
                    <div className="flex items-center gap-2 group-hover:text-green-500/50 transition-colors">
                      <div className="h-2 w-2 rounded-full bg-green-500/20" />
                      {post.retweet_count} Reposts
                    </div>
                    <div className="ml-auto text-gray-700 group-hover:text-gray-500 transition-colors flex items-center gap-2">
                       <Hash size={12} /> ID {post.id}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Info Modal Trigger */}
      <button 
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-8 right-8 bg-gray-900 hover:bg-blue-600 text-gray-400 hover:text-white p-5 rounded-full shadow-2xl transition-all hover:scale-110 border border-gray-700 hover:border-blue-400 z-40 group"
      >
        <Info className="group-hover:rotate-12 transition-transform" />
      </button>

      {/* Backdrop Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-900 border border-white/10 max-w-2xl w-full rounded-[3rem] p-10 md:p-14 shadow-2xl my-8">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-4xl font-black text-white tracking-tighter">Safety Protocols</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-600 hover:text-red-500 transition-colors p-2 hover:bg-white/5 rounded-full"><X size={32} /></button>
            </div>
            
            <div className="space-y-8">
              <div className="flex gap-6 group">
                <div className="bg-blue-600/10 border border-blue-500/30 text-blue-400 h-14 w-14 rounded-3xl flex items-center justify-center flex-shrink-0 font-black text-xl shadow-lg shadow-blue-500/10 group-hover:scale-110 transition-transform">1</div>
                <div>
                  <h4 className="font-black text-xl text-gray-100 tracking-tight">The Archive Source</h4>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">Download your data from X Settings. Navigate to the extracted folder and upload <code className="bg-white/5 px-2 py-0.5 rounded text-blue-400 font-mono border border-white/5">data/tweets.js</code>. This ensures we see everything, including "hidden" or old posts.</p>
                </div>
              </div>
              
              <div className="flex gap-6 group">
                <div className="bg-blue-600/10 border border-blue-500/30 text-blue-400 h-14 w-14 rounded-3xl flex items-center justify-center flex-shrink-0 font-black text-xl shadow-lg shadow-blue-500/10 group-hover:scale-110 transition-transform">2</div>
                <div>
                  <h4 className="font-black text-xl text-gray-100 tracking-tight">Precision Keyword Preview</h4>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">Enter keywords to isolate specific sentiment. Matches are highlighted in real-time. Use the <span className="text-blue-400 font-bold">Preview Keyword Results</span> toggle to focus solely on what matches your criteria before hitting purge.</p>
                </div>
              </div>

              <div className="flex gap-6 group">
                <div className="bg-blue-600/10 border border-blue-500/30 text-blue-400 h-14 w-14 rounded-3xl flex items-center justify-center flex-shrink-0 font-black text-xl shadow-lg shadow-blue-500/10 group-hover:scale-110 transition-transform">3</div>
                <div>
                  <h4 className="font-black text-xl text-gray-100 tracking-tight">Rate-Limited Deletion Engine</h4>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">X (Twitter) aggressively rate-limits third-party deletions. Our engine processes <span className="text-blue-400 font-bold">1 post every 6 seconds</span> (max 10/minute) to keep your account safe from shadowbanning or lockout.</p>
                </div>
              </div>

              <div className="flex gap-6 group">
                <div className="bg-blue-600/10 border border-blue-500/30 text-blue-400 h-14 w-14 rounded-3xl flex items-center justify-center flex-shrink-0 font-black text-xl shadow-lg shadow-blue-500/10 group-hover:scale-110 transition-transform">4</div>
                <div>
                  <h4 className="font-black text-xl text-gray-100 tracking-tight">AI Content Auditing</h4>
                  <p className="text-gray-500 text-sm mt-2 leading-relaxed">Simple keyword searches miss context. Our AI Risk Audit uses Gemini to analyze tone, controversy, and potential brand risk in your history, flagging items you might have forgotten.</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => setIsModalOpen(false)}
              className="w-full mt-14 bg-white text-black py-5 rounded-[2rem] font-black text-lg hover:bg-blue-500 hover:text-white transition-all shadow-xl hover:shadow-blue-500/20 uppercase tracking-widest"
            >
              Initiate Cleanup
            </button>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default App;

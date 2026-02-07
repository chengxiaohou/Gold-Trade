import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Wallet, History, TrendingUp, TrendingDown, CheckCircle2, Download, Upload, FileJson, CloudUpload, CloudDownload, Settings, ArrowRight, ChevronUp, ChevronDown, Moon, Sun, Plus, Minus } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { CloudSettingsModal } from './components/CloudSettingsModal';
import { analyzeTrade } from './services/geminiService';
import { saveToGist, loadFromGist } from './services/githubService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType, GithubConfig, AppSettings } from './types';

const APP_VERSION = 'v1.7.1';

export default function App() {
  // --- Theme State ---
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('gold_app_theme');
    if (saved === 'light') return 'light';
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    localStorage.setItem('gold_app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // --- State ---
  
  // 1. Trades History
  const [trades, setTrades] = useState<TradeRecord[]>(() => {
    const saved = localStorage.getItem('gold_trades_local');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isDragging, setIsDragging] = useState(false);
  
  // 2. Inputs Draft
  const [inputs, setInputs] = useState(() => {
    const saved = localStorage.getItem('gold_inputs_draft');
    return saved ? JSON.parse(saved) : { price: '', grams: '' };
  });

  // 3. Market Price
  const [marketPrice, setMarketPrice] = useState(() => {
    const saved = localStorage.getItem('gold_market_price');
    return saved || '';
  });

  // 4. Global App Settings (New)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gold_app_settings');
    // Migration: Add tagColors if missing
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      priceStep: parsed.priceStep || 5,
      gramsStep: parsed.gramsStep || 1,
      tagColors: parsed.tagColors || {}
    };
  });

  const [aiState, setAiState] = useState<AIAnalysisState>({
    loading: false,
    result: null,
    error: null
  });

  // Github Cloud Config State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [githubConfig, setGithubConfig] = useState<GithubConfig>(() => {
    const saved = localStorage.getItem('gold_github_config');
    return saved ? JSON.parse(saved) : { token: '', gistId: '' };
  });

  // 5. Preview Type
  const [previewType, setPreviewType] = useState<OrderType>(() => {
    const saved = localStorage.getItem('gold_preview_type');
    return (saved === 'SELL') ? 'SELL' : 'BUY';
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const marketPriceInputRef = useRef<HTMLInputElement>(null);

  // --- Effects: Auto-save locally ---
  
  useEffect(() => {
    localStorage.setItem('gold_trades_local', JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem('gold_inputs_draft', JSON.stringify(inputs));
  }, [inputs]);

  useEffect(() => {
    localStorage.setItem('gold_market_price', marketPrice);
  }, [marketPrice]);

  useEffect(() => {
    localStorage.setItem('gold_preview_type', previewType);
  }, [previewType]);

  useEffect(() => {
    localStorage.setItem('gold_app_settings', JSON.stringify(appSettings));
  }, [appSettings]);


  // --- Handlers ---
  const handleInputChange = (field: keyof typeof inputs, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setInputs(prev => ({ ...prev, [field]: value }));
  };

  const handleMarketPriceChange = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setMarketPrice(value);
  };

  const updateMarketPrice = (delta: number) => {
    const currentVal = parseFloat(marketPrice) || 0;
    const nextVal = Math.max(0, currentVal + delta);
    const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
    handleMarketPriceChange(nextStr);
  };

  // Wheel listener for Market Price
  useEffect(() => {
    const el = marketPriceInputRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      updateMarketPrice(direction * appSettings.priceStep);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [marketPrice, appSettings.priceStep]);

  // --- Cloud & Settings Handlers ---
  const handleSaveSettings = (newGithubConfig: GithubConfig, newAppSettings: AppSettings) => {
    // Save Github Config
    setGithubConfig(newGithubConfig);
    localStorage.setItem('gold_github_config', JSON.stringify(newGithubConfig));
    
    // Save App Settings
    setAppSettings(newAppSettings);
    // Persistence handled by useEffect
  };
  
  const handleSettingsUpdate = (updates: Partial<AppSettings>) => {
    setAppSettings(prev => ({ ...prev, ...updates }));
  };

  const handleCloudUpload = async () => {
    if (!githubConfig.token) {
      setIsSettingsOpen(true);
      return;
    }
    
    if (trades.length === 0 && !window.confirm("当前没有任何记录，确定要覆盖云端数据为空吗？")) {
      return;
    }

    setIsSyncing(true);
    try {
      // Changed: Pass an object containing both trades and settings
      const newGistId = await saveToGist(
        githubConfig.token, 
        { trades, settings: appSettings }, 
        githubConfig.gistId || undefined
      );
      
      if (newGistId && newGistId !== githubConfig.gistId) {
        const newConfig = { ...githubConfig, gistId: newGistId };
        setGithubConfig(newConfig);
        localStorage.setItem('gold_github_config', JSON.stringify(newConfig));
      }
      
      alert(`云端同步成功！${!githubConfig.gistId ? '已创建新的 Gist 备份。' : ''}`);
    } catch (error) {
      alert(`同步失败: ${(error as Error).message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloudDownload = async () => {
    if (!githubConfig.token) {
      alert("请先配置 GitHub Token");
      setIsSettingsOpen(true);
      return;
    }

    if (!githubConfig.gistId) {
      alert("无法下载：未检测到 Gist ID。\n\n• 如果您是首次使用，请先点击「上传」按钮来创建新备份。\n• 如果您要恢复已有数据，请在设置中填入您的 Gist ID。");
      setIsSettingsOpen(true);
      return;
    }

    if (trades.length > 0 && !window.confirm("下载云端数据将覆盖当前本地记录，确定继续吗？")) {
      return;
    }

    setIsSyncing(true);
    try {
      const result = await loadFromGist(githubConfig.token, githubConfig.gistId);
      if (result) {
        setTrades(result.trades);
        
        // Sync Settings (Tag Colors) if available
        if (result.settings) {
          setAppSettings(prev => ({
            ...prev,
            ...result.settings
          }));
        }
        
        const hasSettings = !!result.settings;
        alert(`成功从云端加载 ${result.trades.length} 条记录${hasSettings ? '及个性化配置' : ''}`);
      }
    } catch (error) {
      alert(`加载失败: ${(error as Error).message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Data Persistence Handlers ---
  const handleExport = () => {
    // UPDATED: Now exports an object containing both trades and settings
    const exportData = {
      version: 1,
      timestamp: Date.now(),
      trades: trades,
      settings: appSettings
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gold-trades-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const processFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result === 'string') {
          const parsed = JSON.parse(result);
          
          // Case 1: Legacy Format (Array of trades only)
          if (Array.isArray(parsed)) {
            const isValid = parsed.every(t => t.id && t.type && typeof t.price === 'number');
            if (isValid) {
              setTrades(parsed);
              alert(`成功导入 ${parsed.length} 条交易记录 (旧格式)`);
            } else {
              alert('文件格式错误：无效的交易记录');
            }
            return;
          }
          
          // Case 2: New Format (Object with trades and settings)
          if (parsed.trades && Array.isArray(parsed.trades)) {
             setTrades(parsed.trades);
             
             if (parsed.settings) {
               setAppSettings(prev => ({
                 ...prev,
                 ...parsed.settings
               }));
             }
             
             const hasSettings = !!parsed.settings;
             alert(`成功导入 ${parsed.trades.length} 条交易记录${hasSettings ? '及个性化配置' : ''}`);
             return;
          }
          
          alert('无法识别的文件格式');
        }
      } catch (error) {
        alert('文件解析失败，请确保是有效的 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  // --- Drag & Drop Handlers ---
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/json" || file.name.endsWith('.json')) {
        processFile(file);
      } else {
        alert("请拖入 JSON 格式的文件");
      }
    }
  };

  // --- Core Calculation ---
  const currentPosition: HoldingState = useMemo(() => {
    let grams = 0;
    let totalCost = 0;
    let realizedPnL = 0;

    trades.forEach(t => {
      if (t.isDisabled) return;

      const tradeValue = t.grams * t.price;
      if (t.type === 'BUY') {
        grams += t.grams;
        totalCost += tradeValue;
      } else {
        const currentAvg = grams > 0 ? totalCost / grams : 0;
        const costBasis = t.grams * currentAvg;
        
        grams = Math.max(0, grams - t.grams);
        totalCost -= costBasis; 
        realizedPnL += (tradeValue - costBasis);
      }
    });

    if (grams < 0.0001) {
      grams = 0;
      totalCost = 0;
    }

    const avgCost = grams > 0 ? totalCost / grams : 0;

    return { grams, avgCost, totalCost, realizedPnL };
  }, [trades]);

  const floatingPnL = useMemo(() => {
    const market = parseFloat(marketPrice) || 0;
    if (market <= 0 || currentPosition.grams <= 0) return 0;
    return (market - currentPosition.avgCost) * currentPosition.grams;
  }, [marketPrice, currentPosition]);

  const getSimulation = (type: OrderType): SimulationResult => {
    const price = parseFloat(inputs.price) || 0;
    const grams = parseFloat(inputs.grams) || 0;
    
    let newTotalGrams = 0;
    let newTotalCost = 0;
    let projectedPnL = 0;

    if (type === 'BUY') {
      newTotalGrams = currentPosition.grams + grams;
      newTotalCost = currentPosition.totalCost + (price * grams);
    } else {
      newTotalGrams = Math.max(0, currentPosition.grams - grams);
      const costBasis = grams * currentPosition.avgCost;
      newTotalCost = currentPosition.totalCost - costBasis;
      projectedPnL = (price * grams) - costBasis;
    }

    const newAvgCost = newTotalGrams > 0 ? newTotalCost / newTotalGrams : 0;
    const costDifference = currentPosition.avgCost > 0 
      ? ((newAvgCost - currentPosition.avgCost) / currentPosition.avgCost) * 100 
      : 0;

    return {
      newTotalGrams,
      newAvgCost,
      totalInvestment: newTotalCost,
      costDifference,
      projectedPnL: type === 'SELL' ? projectedPnL : undefined
    };
  };

  const simulation = useMemo(() => getSimulation(previewType), [currentPosition, inputs, previewType]);

  // --- Actions ---
  const executeTrade = () => {
    const type = previewType;
    const price = parseFloat(inputs.price);
    const grams = parseFloat(inputs.grams);

    if (!price || !grams) return;
    if (type === 'SELL' && grams > currentPosition.grams) {
      alert("卖出数量不能大于当前持仓量");
      return;
    }

    const newTrade: TradeRecord = {
      id: Date.now().toString(),
      type,
      price,
      grams,
      timestamp: Date.now(),
      isDisabled: false
    };

    setTrades(prev => [...prev, newTrade]);
    setMarketPrice(inputs.price);
    setInputs({ price: '', grams: '' }); 
    setAiState({ loading: false, result: null, error: null });
  };

  const deleteTrade = (id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
  };

  const updateTrade = (id: string, updates: Partial<TradeRecord>) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const resetAll = () => {
    if (window.confirm("确定要清空所有数据吗？此操作无法撤销。")) {
      setTrades([]);
      setInputs({ price: '', grams: '' });
      setMarketPrice('');
      setAiState({ loading: false, result: null, error: null });
      setPreviewType('BUY');
    }
  };

  const handleAIAnalysis = async () => {
    const order: OrderState = {
      price: parseFloat(inputs.price) || 0,
      grams: parseFloat(inputs.grams) || 0
    };
    if (!order.price || !order.grams) return;

    setAiState({ loading: true, result: null, error: null });
    const resultText = await analyzeTrade(currentPosition, order, previewType === 'BUY', simulation);
    setAiState({ loading: false, result: resultText, error: null });
  };

  // --- Reusable Button Group Component (for Desktop sidebar and Mobile bottom) ---
  const ActionButtons = () => (
    <div className="grid grid-cols-6 gap-1 lg:gap-2">
        <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
            title="设置"
          >
            <Settings size={16} />
        </button>
        
        <button 
            onClick={handleCloudDownload}
            className="flex items-center justify-center bg-app-card border border-app-border text-indigo-400 py-2.5 rounded-md hover:text-indigo-300 hover:border-indigo-500 transition-colors"
            title="从云端下载"
          >
            <CloudDownload size={16} />
        </button>

        <button 
            onClick={handleCloudUpload}
            disabled={isSyncing}
            className="flex items-center justify-center bg-app-card border border-app-border text-brand-yellow py-2.5 rounded-md hover:bg-brand-yellow/10 hover:border-brand-yellow transition-colors"
            title="上传到云端"
          >
             {isSyncing ? (
               <div className="w-4 h-4 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin"></div>
             ) : (
               <CloudUpload size={16} />
             )}
        </button>

        <button 
            onClick={handleImportClick} 
            className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
            title="导入数据"
          >
            <Upload size={16} />
        </button>

        <button 
            onClick={handleExport}
            disabled={trades.length === 0}
            className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors disabled:opacity-50"
            title="导出数据"
          >
            <Download size={16} />
        </button>

        <button 
            onClick={resetAll} 
            className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-red-400 hover:border-red-400 transition-colors"
            title="重置"
          >
            <RefreshCcw size={16} />
        </button>
    </div>
  );

  return (
    <div 
      className="min-h-screen bg-app-bg text-app-text font-sans p-4 md:p-8 flex justify-center relative transition-colors duration-300"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <style>{`
          .no-spinners::-webkit-inner-spin-button,
          .no-spinners::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .no-spinners {
            -moz-appearance: textfield;
          }
      `}</style>
      <CloudSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        githubConfig={githubConfig}
        appSettings={appSettings}
        onSave={handleSaveSettings}
      />

      {isDragging && (
        <div className="absolute inset-0 bg-brand-yellow/10 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-brand-yellow m-4 rounded-3xl pointer-events-none">
          <div className="text-center">
            <FileJson size={64} className="mx-auto text-brand-yellow mb-4" />
            <h3 className="text-2xl font-bold text-app-text">松开以导入数据</h3>
            <p className="text-brand-yellow/80">支持 .json 格式的交易记录文件</p>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".json"
      />

      <div className="max-w-[1400px] w-full pb-12 flex flex-col">
        
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-baseline gap-3">
                <h1 className="text-3xl font-bold text-app-subtext tracking-wide">
                  黄金交易模拟
                </h1>
                <span className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text transition-colors cursor-default ml-1">{APP_VERSION}</span>
              </div>
            </div>
            {/* Description removed */}
          </div>
          
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-app-card border border-app-border text-app-subtext hover:text-brand-yellow transition-colors shrink-0"
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6 items-start">
          
          <div className="lg:col-span-8 flex flex-col gap-6 order-2 lg:order-1">
             
             <div className="space-y-3">
                <div className="flex items-center gap-2 text-app-subtext pl-1">
                   <Wallet size={16} />
                   <h3 className="font-medium text-sm">当前持仓详情</h3>
                </div>

                <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm transition-colors duration-300">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                      <span className="text-xs text-app-subtext block mb-1">平均成本</span>
                      <div className="text-xl font-bold text-app-text font-mono">{currentPosition.avgCost.toFixed(2)}</div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                      <span className="text-xs text-app-subtext block mb-1">持仓数量 (克)</span>
                      <div className="text-xl font-bold text-app-text font-mono">{currentPosition.grams.toFixed(2)}</div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                      <span className="text-xs text-app-subtext block mb-1">持仓总投入</span>
                      <div className="text-xl font-bold text-app-text font-mono">
                        {currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </div>
                    </div>

                    <div className={`bg-app-bg p-3 rounded-lg border ${currentPosition.realizedPnL >= 0 ? 'border-brand-redDim' : 'border-brand-greenDim'}`}>
                      <span className="text-xs text-app-subtext block mb-1">已实现盈亏</span>
                      <div className={`text-xl font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toFixed(2)}
                      </div>
                    </div>

                    <div className={`bg-app-bg p-3 rounded-lg border ${floatingPnL >= 0 ? 'border-brand-redDim bg-brand-redDim/20' : 'border-brand-greenDim bg-brand-greenDim/20'}`}>
                      <span className="text-xs text-app-subtext block mb-1 flex justify-between">
                         <span>浮动盈亏</span>
                      </span>
                      <div className={`text-xl font-bold font-mono ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {marketPrice ? (
                          <>
                            {floatingPnL > 0 ? '+' : ''}{floatingPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                          </>
                        ) : (
                          <span className="text-app-subtext text-base font-normal">--</span>
                        )}
                      </div>
                    </div>

                    {/* Market Price Input as a Card */}
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border relative group hover:border-brand-yellow/50 transition-colors focus-within:border-brand-yellow focus-within:ring-1 focus-within:ring-brand-yellow/20">
                       <span className="text-xs text-app-subtext block mb-1">参考市价 (元/克)</span>
                       <div className="flex items-center">
                          <input 
                            ref={marketPriceInputRef}
                            type="number" 
                            value={marketPrice}
                            onChange={(e) => handleMarketPriceChange(e.target.value)}
                            placeholder="0.00"
                            className="no-spinners text-xl font-bold text-brand-yellow font-mono bg-transparent border-none p-0 w-full focus:outline-none placeholder-app-subtext/30"
                          />
                          <div className="flex flex-col gap-0.5 ml-2">
                             <button 
                               onClick={() => updateMarketPrice(appSettings.priceStep)}
                               className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5 transition-colors"
                               tabIndex={-1}
                             >
                               <ChevronUp size={10} strokeWidth={3} />
                             </button>
                             <button 
                               onClick={() => updateMarketPrice(-appSettings.priceStep)}
                               className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5 transition-colors"
                               tabIndex={-1}
                             >
                               <ChevronDown size={10} strokeWidth={3} />
                             </button>
                          </div>
                       </div>
                    </div>

                  </div>
               </div>
             </div>

             <div className="space-y-3">
               <div className="flex items-center gap-2 text-app-subtext pl-1">
                  <History size={16} />
                  <h3 className="font-medium text-sm">成交记录</h3>
               </div>
               <TradeList 
                  trades={trades} 
                  onDelete={deleteTrade} 
                  onUpdate={updateTrade} 
                  settings={appSettings} 
                  onSettingsChange={handleSettingsUpdate}
               />
             </div>

             <div className="bg-app-card border border-app-border rounded-xl p-4 transition-colors duration-300">
                <div className="flex items-center justify-between mb-2">
                   <h3 className="text-app-text font-medium flex items-center gap-2">
                     <BrainCircuit size={16} className="text-indigo-400"/>
                     智能分析 (预览)
                   </h3>
                   <button 
                     onClick={handleAIAnalysis}
                     disabled={aiState.loading || !inputs.grams || !inputs.price}
                     className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                   >
                     {aiState.loading ? "分析中..." : "Gemini 深度分析"}
                   </button>
                </div>
                
                {aiState.result ? (
                  <div className="text-sm text-app-text leading-relaxed bg-app-input p-3 rounded-lg border border-app-border whitespace-pre-wrap">
                    {aiState.result}
                  </div>
                ) : (
                  <div className="text-xs text-app-subtext italic">
                    在右侧面板输入价格和数量后，点击分析按钮获取基于当前持仓的操作建议。
                  </div>
                )}
             </div>
          </div>

          <div className="lg:col-span-4 lg:col-start-9 order-1 lg:order-2 lg:sticky lg:top-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-app-subtext pl-1">
                <TrendingUp size={16} />
                <h3 className="font-medium text-sm">模拟交易</h3>
              </div>
              <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl transition-all duration-300">
                
                <div className="grid grid-cols-2 p-1.5">
                  <button 
                    onClick={() => setPreviewType('BUY')}
                    className={`py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                      previewType === 'BUY' 
                        ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' 
                        : 'bg-app-input text-app-subtext hover:text-app-text hover:bg-app-input/80'
                    }`}
                  >
                    <TrendingUp size={16} />
                    买入
                  </button>
                  <button 
                    onClick={() => setPreviewType('SELL')}
                    className={`py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                      previewType === 'SELL' 
                        ? 'bg-brand-green text-white shadow-lg shadow-brand-green/20' 
                        : 'bg-app-input text-app-subtext hover:text-app-text hover:bg-app-input/80'
                    }`}
                  >
                    <TrendingDown size={16} />
                    卖出
                  </button>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  
                  <div className="grid grid-cols-2 gap-2">
                    <InputGroup 
                        label="价格 (元/克)"
                        value={inputs.price}
                        onChange={(v) => handleInputChange('price', v)}
                        placeholder="0.00"
                        step={appSettings.priceStep}
                      />
                      <InputGroup 
                        label="数量 (克)"
                        value={inputs.grams}
                        onChange={(v) => handleInputChange('grams', v)}
                        placeholder="0.00"
                        step={appSettings.gramsStep}
                      />
                  </div>

                  <div className="bg-app-input/30 rounded-xl p-4 border border-app-border space-y-3">
                      {/* Top Row: Avg Cost & Change */}
                      <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold text-app-subtext uppercase tracking-wider block mb-1">成交后均价预估</span>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold text-app-text tracking-tight font-mono">
                                  {simulation.newAvgCost.toFixed(2)}
                              </span>
                              <span className="text-[10px] text-app-subtext font-bold">CNY</span>
                            </div>
                          </div>

                          {/* Right Top: Cost Change Badge */}
                          <div className="text-right">
                            {currentPosition.grams > 0 && inputs.grams && previewType === 'BUY' ? (
                              <>
                                  <span className="text-[10px] font-bold text-app-subtext uppercase tracking-wider block mb-1">成本浮动</span>
                                  <div className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded border ${simulation.costDifference > 0 ? 'bg-brand-red/10 text-brand-red border-brand-red/20' : 'bg-brand-green/10 text-brand-green border-brand-green/20'} inline-flex items-center`}>
                                    {simulation.costDifference > 0 ? '+' : ''}{simulation.costDifference.toFixed(2)}%
                                  </div>
                              </>
                            ) : previewType === 'SELL' ? (
                              <>
                                  <span className="text-[10px] font-bold text-app-subtext uppercase tracking-wider block mb-1">持仓成本</span>
                                  <span className="text-xs font-bold text-app-subtext font-mono inline-block">不变</span>
                              </>
                            ) : (
                              <span className="text-app-subtext text-xs py-1 block">-</span>
                            )}
                          </div>
                      </div>
                      
                      {/* Divider */}
                      <div className="h-px bg-white/5 w-full" />

                      {/* Bottom Row: Grid */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <div>
                            <p className="text-app-subtext text-[10px] mb-0.5 font-medium">预计总持仓</p>
                            <div className="flex items-baseline gap-1">
                              <span className="text-lg font-bold text-app-text font-mono">{simulation.newTotalGrams.toFixed(2)}</span>
                              <span className="text-[10px] text-app-subtext">g</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-app-subtext text-[10px] mb-0.5 font-medium">本次交易额</p>
                            <div className="flex items-baseline gap-1 justify-end">
                              <span className="text-lg font-bold text-app-text font-mono">
                                {((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}
                              </span>
                              <span className="text-[10px] text-app-subtext">¥</span>
                            </div>
                        </div>
                        
                        {previewType === 'SELL' && simulation.projectedPnL !== undefined && (
                          <div className="col-span-2 border-t border-white/[0.03] pt-2 flex justify-between items-center">
                              <span className="text-app-subtext text-[10px] font-bold">预计本次盈亏：</span>
                              <span className={`font-mono font-bold text-sm ${simulation.projectedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                                {simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}
                              </span>
                          </div>
                        )}
                      </div>
                  </div>

                  {inputs.grams && inputs.price && (
                    <CostChart 
                      currentAvg={currentPosition.avgCost} 
                      newAvg={previewType === 'BUY' ? simulation.newAvgCost : parseFloat(inputs.price)} 
                      orderType={previewType} 
                    />
                  )}
                  
                  <button
                    onClick={executeTrade}
                    disabled={!inputs.price || !inputs.grams}
                    className={`w-full py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-md mt-2
                      ${previewType === 'BUY' 
                        ? 'bg-brand-red text-white hover:bg-red-500 shadow-brand-red/10' 
                        : 'bg-brand-green text-white hover:bg-green-500 shadow-brand-green/10'
                      }`}
                  >
                    <CheckCircle2 size={16} />
                    成交
                  </button>

                </div>
              </div>
            </div>

            {/* Desktop Only Buttons Row */}
            <div className="hidden lg:block">
               <ActionButtons />
            </div>
          </div>
        </div>

        {/* Mobile Only Buttons Row - Fixed at bottom layout flow */}
        <div className="lg:hidden mt-2 order-3">
           <ActionButtons />
        </div>

      </div>
    </div>
  );
}
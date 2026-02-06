import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Calculator, Wallet, Plus, History, TrendingUp, CheckCircle2, Download, Upload, FileJson, Cloud, CloudUpload, CloudDownload, Settings, Target, ArrowRight } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { CloudSettingsModal } from './components/CloudSettingsModal';
import { analyzeTrade } from './services/geminiService';
import { saveToGist, loadFromGist } from './services/githubService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType, GithubConfig, AppSettings } from './types';

const APP_VERSION = 'v1.6.0';

export default function App() {
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
    return saved ? JSON.parse(saved) : { priceStep: 5, gramsStep: 1 };
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

  // --- Cloud & Settings Handlers ---
  const handleSaveSettings = (newGithubConfig: GithubConfig, newAppSettings: AppSettings) => {
    // Save Github Config
    setGithubConfig(newGithubConfig);
    localStorage.setItem('gold_github_config', JSON.stringify(newGithubConfig));
    
    // Save App Settings
    setAppSettings(newAppSettings);
    // Persistence handled by useEffect
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
      const newGistId = await saveToGist(githubConfig.token, trades, githubConfig.gistId || undefined);
      
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
      const cloudTrades = await loadFromGist(githubConfig.token, githubConfig.gistId);
      if (cloudTrades) {
        setTrades(cloudTrades);
        alert(`成功从云端加载 ${cloudTrades.length} 条记录`);
      }
    } catch (error) {
      alert(`加载失败: ${(error as Error).message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- Data Persistence Handlers ---
  const handleExport = () => {
    const dataStr = JSON.stringify(trades, null, 2);
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
          const importedTrades = JSON.parse(result);
          if (Array.isArray(importedTrades)) {
            const isValid = importedTrades.every(t => t.id && t.type && typeof t.price === 'number');
            if (isValid) {
              setTrades(importedTrades);
              alert(`成功导入 ${importedTrades.length} 条交易记录`);
            } else {
              alert('文件格式错误：无效的交易记录');
            }
          }
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

  return (
    <div 
      className="min-h-screen bg-app-bg text-slate-200 font-sans p-4 md:p-8 flex justify-center relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
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
            <h3 className="text-2xl font-bold text-white">松开以导入数据</h3>
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

      <div className="max-w-[1400px] w-full pb-12">
        
        <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-brand-yellow">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
                  <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-2.69-6-6-6z" opacity="0.5"/>
                </svg>
              </div>
              <div className="flex items-baseline gap-3">
                <h1 className="text-3xl font-bold text-white tracking-wide">
                  <span className="text-brand-yellow">黄金交易</span> 成本预估
                </h1>
                <span className="text-[10px] text-slate-600 font-mono select-all hover:text-slate-500 transition-colors cursor-default">{APP_VERSION}</span>
              </div>
            </div>
            <p className="text-slate-500 text-sm max-w-2xl">
              记录每笔买卖，自动计算持仓均价。输入新订单可预览成本变化。
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6 items-start">
          
          <div className="lg:col-span-8 flex flex-col gap-6 order-2 lg:order-1">
             
             <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4 justify-between">
                   <div className="flex items-center gap-2">
                      <Wallet size={18} className="text-brand-yellow"/>
                      <h2 className="text-brand-yellow font-bold text-lg">当前持仓详情</h2>
                   </div>
                   
                   <div className="flex items-center gap-2 bg-app-bg px-3 py-1.5 rounded-lg border border-app-border border-l-4 border-l-brand-yellow/50">
                      <span className="text-xs text-slate-400 whitespace-nowrap flex items-center gap-1">
                         <Target size={12} />
                         参考市价
                      </span>
                      <input 
                        type="number" 
                        value={marketPrice}
                        onChange={(e) => handleMarketPriceChange(e.target.value)}
                        placeholder="0.00"
                        className="w-20 bg-transparent text-right font-mono font-bold text-white focus:outline-none placeholder-slate-700 text-sm"
                      />
                      <span className="text-xs text-slate-500">元/克</span>
                   </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                    <span className="text-xs text-slate-500 block mb-1">平均成本</span>
                    <div className="text-xl font-bold text-white font-mono">{currentPosition.avgCost.toFixed(2)}</div>
                  </div>
                  <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                    <span className="text-xs text-slate-500 block mb-1">持仓数量 (克)</span>
                    <div className="text-xl font-bold text-white font-mono">{currentPosition.grams.toFixed(2)}</div>
                  </div>
                  <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                    <span className="text-xs text-slate-500 block mb-1">持仓总投入</span>
                    <div className="text-xl font-bold text-slate-300 font-mono">
                      {currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                  </div>

                  <div className={`bg-app-bg p-3 rounded-lg border ${floatingPnL >= 0 ? 'border-brand-red/30 bg-brand-red/5' : 'border-brand-green/30 bg-brand-green/5'}`}>
                    <span className="text-xs text-slate-500 block mb-1 flex justify-between">
                       <span>浮动盈亏</span>
                       {marketPrice && <span className="text-[10px] opacity-60">@ {marketPrice}</span>}
                    </span>
                    <div className={`text-xl font-bold font-mono ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                      {marketPrice ? (
                        <>
                          {floatingPnL > 0 ? '+' : ''}{floatingPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </>
                      ) : (
                        <span className="text-slate-600 text-base font-normal">--</span>
                      )}
                    </div>
                  </div>

                  <div className={`bg-app-bg p-3 rounded-lg border ${currentPosition.realizedPnL >= 0 ? 'border-brand-red/30' : 'border-brand-green/30'}`}>
                    <span className="text-xs text-slate-500 block mb-1">已实现盈亏</span>
                    <div className={`text-xl font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                      {currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toFixed(2)}
                    </div>
                  </div>
                </div>
             </div>

             <div className="space-y-3">
               <div className="flex items-center gap-2 text-slate-400 pl-1">
                  <History size={16} />
                  <h3 className="font-medium text-sm">成交记录</h3>
               </div>
               <TradeList trades={trades} onDelete={deleteTrade} onUpdate={updateTrade} settings={appSettings} />
             </div>

             <div className="bg-app-card border border-app-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                   <h3 className="text-slate-300 font-medium flex items-center gap-2">
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
                  <div className="text-sm text-slate-300 leading-relaxed bg-app-input p-3 rounded-lg border border-app-border whitespace-pre-wrap">
                    {aiState.result}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 italic">
                    在右侧面板输入价格和数量后，点击分析按钮获取基于当前持仓的操作建议。
                  </div>
                )}
             </div>
          </div>

          <div className="lg:col-span-4 lg:col-start-9 order-1 lg:order-2 lg:sticky lg:top-6 space-y-4">
            <div className={`bg-app-card border rounded-xl overflow-hidden shadow-2xl transition-all duration-300 ${previewType === 'BUY' ? 'border-brand-red/50 shadow-brand-red/5' : 'border-brand-green/50 shadow-brand-green/5'}`}>
              
              <div className="grid grid-cols-2 p-1.5 bg-app-bg border-b border-app-border">
                <button 
                  onClick={() => setPreviewType('BUY')}
                  className={`py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                    previewType === 'BUY' 
                      ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <TrendingUp size={16} />
                  买入挂单
                </button>
                <button 
                  onClick={() => setPreviewType('SELL')}
                  className={`py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                    previewType === 'SELL' 
                      ? 'bg-brand-green text-white shadow-lg shadow-brand-green/20' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <TrendingUp size={16} className="rotate-180" />
                  卖出挂单
                </button>
              </div>

              <div className="p-5 flex flex-col gap-6">
                
                <div className="grid grid-cols-2 gap-3">
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

                <div className="relative h-px bg-app-border flex items-center justify-center">
                   <div className="bg-app-card px-2 text-slate-500">
                     <ArrowRight size={14} className="rotate-90" />
                   </div>
                </div>

                <div>
                   <p className="text-slate-400 text-xs mb-1 uppercase tracking-wider font-bold">成交后均价预估</p>
                   <div className="flex items-baseline gap-2">
                     <span className="text-4xl font-bold text-white tracking-tight">
                        {simulation.newAvgCost.toFixed(2)}
                     </span>
                     <span className="text-slate-500 font-medium">CNY</span>
                   </div>
                   {currentPosition.grams > 0 && inputs.grams && previewType === 'BUY' ? (
                     <div className="flex items-center gap-2 mt-2">
                        <span className={`text-sm font-bold ${simulation.costDifference > 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                          {simulation.costDifference > 0 ? '+' : ''}{simulation.costDifference.toFixed(2)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          (成本 {simulation.costDifference < 0 ? '下降' : '上升'})
                        </span>
                     </div>
                   ) : previewType === 'SELL' && (
                     <p className="text-xs text-slate-500 mt-2">卖出操作不影响剩余持仓成本</p>
                   )}
                </div>

                <div className="grid grid-cols-2 gap-4 bg-app-input rounded-lg p-3 border border-app-border">
                   <div>
                      <p className="text-slate-400 text-[10px] mb-0.5">预计总持仓</p>
                      <div className="flex items-baseline gap-1">
                         <span className="text-lg font-bold text-white">{simulation.newTotalGrams.toFixed(2)}</span>
                         <span className="text-[10px] text-slate-500">g</span>
                      </div>
                   </div>
                   <div className="text-right">
                      <p className="text-slate-400 text-[10px] mb-0.5">本次交易额</p>
                      <div className="flex items-baseline gap-1 justify-end">
                         <span className="text-lg font-bold text-slate-200">
                           {((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}
                         </span>
                         <span className="text-[10px] text-slate-500">¥</span>
                      </div>
                   </div>
                   
                   {previewType === 'SELL' && simulation.projectedPnL !== undefined && (
                     <div className="col-span-2 border-t border-white/5 pt-2 mt-1 flex justify-between items-center">
                        <span className="text-slate-400 text-[10px]">预计本次盈亏</span>
                        <span className={`font-mono font-bold text-sm ${simulation.projectedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                          {simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}
                        </span>
                     </div>
                   )}
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
                  className={`w-full py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg 
                    ${previewType === 'BUY' 
                      ? 'bg-brand-red text-white hover:bg-red-500 shadow-brand-red/20' 
                      : 'bg-brand-green text-white hover:bg-green-500 shadow-brand-green/20'
                    }`}
                >
                   <CheckCircle2 size={20} />
                   {previewType === 'BUY' ? '确认买入' : '确认卖出'}
                </button>

              </div>
            </div>

            <div className="grid grid-cols-6 gap-1 lg:gap-2">
                <button 
                    onClick={() => setIsSettingsOpen(true)}
                    className="flex items-center justify-center bg-app-card border border-app-border text-slate-400 py-2.5 rounded-md hover:text-white hover:border-slate-500 transition-colors"
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
                    className="flex items-center justify-center bg-app-card border border-app-border text-slate-400 py-2.5 rounded-md hover:text-white hover:border-slate-500 transition-colors"
                    title="导入数据"
                  >
                    <Upload size={16} />
                </button>

                <button 
                    onClick={handleExport}
                    disabled={trades.length === 0}
                    className="flex items-center justify-center bg-app-card border border-app-border text-slate-400 py-2.5 rounded-md hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50"
                    title="导出数据"
                  >
                    <Download size={16} />
                </button>

                <button 
                    onClick={resetAll} 
                    className="flex items-center justify-center bg-app-card border border-app-border text-slate-400 py-2.5 rounded-md hover:text-red-400 hover:border-red-900/50 transition-colors"
                    title="重置"
                  >
                    <RefreshCcw size={16} />
                </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
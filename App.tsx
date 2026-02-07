import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Wallet, History, TrendingUp, TrendingDown, CheckCircle2, Download, Upload, FileJson, CloudUpload, CloudDownload, Settings, ArrowRight, ChevronUp, ChevronDown, Moon, Sun, Plus, Minus, X, Check, AlertTriangle } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { CloudSettingsModal } from './components/CloudSettingsModal';
import { analyzeTrade } from './services/geminiService';
import { saveToGist, loadFromGist } from './services/githubService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType, GithubConfig, AppSettings } from './types';

const APP_VERSION = 'v1.7.4';

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
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'general' | 'cloud'>('general');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  
  // Localized Cloud Confirmation Popover State
  const [cloudConfirm, setCloudConfirm] = useState<'upload' | 'download' | null>(null);

  const [githubConfig, setGithubConfig] = useState<GithubConfig>(() => {
    const saved = localStorage.getItem('gold_github_config');
    return saved ? JSON.parse(saved) : { token: '', gistId: '' };
  });

  // Modal States
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
    setGithubConfig(newGithubConfig);
    localStorage.setItem('gold_github_config', JSON.stringify(newGithubConfig));
    setAppSettings(newAppSettings);
  };
  
  const handleSettingsUpdate = (updates: Partial<AppSettings>) => {
    setAppSettings(prev => ({ ...prev, ...updates }));
  };

  const openSettings = (tab: 'general' | 'cloud' = 'general') => {
    setSettingsDefaultTab(tab);
    setIsSettingsOpen(true);
  };

  // Trigger Confirmation
  const requestCloudAction = (action: 'upload' | 'download') => {
    if (!githubConfig.token) {
        if (action === 'download') alert("请先配置 GitHub Token");
        openSettings('cloud');
        return;
    }
    if (action === 'download' && !githubConfig.gistId) {
        alert("无法下载：未检测到 Gist ID。\n\n• 如果您是首次使用，请先点击「上传」按钮来创建新备份。\n• 如果您要恢复已有数据，请在设置中填入您的 Gist ID。");
        openSettings('cloud');
        return;
    }
    setCloudConfirm(action);
  };

  const handleCloudUpload = async () => {
    setCloudConfirm(null);
    setIsSyncing(true);
    setUploadSuccess(false);
    try {
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
      
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch (error) {
      alert(`上传失败: ${(error as Error).message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloudDownload = async () => {
    setCloudConfirm(null);
    setIsDownloading(true);
    setDownloadSuccess(false);
    try {
      const result = await loadFromGist(githubConfig.token, githubConfig.gistId);
      if (result) {
        setTrades(result.trades);
        
        if (result.settings) {
          setAppSettings(prev => ({
            ...prev,
            ...result.settings
          }));
        }
        
        setDownloadSuccess(true);
        setTimeout(() => setDownloadSuccess(false), 2000);
      }
    } catch (error) {
      alert(`加载失败: ${(error as Error).message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  // --- Data Persistence Handlers ---

  const handleExportClick = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    
    setExportFileName(`gold-trades-${timestamp}`);
    setShowExportModal(true);
  };

  const confirmExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportFileName.trim()) return;

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
    
    let fileName = exportFileName.trim();
    if (!fileName.toLowerCase().endsWith('.json')) {
      fileName += '.json';
    }
    
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setShowExportModal(false);
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
          
          if (Array.isArray(parsed)) {
            const isValid = parsed.every(t => t.id && t.type && typeof t.price === 'number');
            if (isValid) {
              setTrades(parsed);
              alert(`成功导入 ${parsed.length} 条交易记录`);
            } else {
              alert('文件格式错误：无效的交易记录');
            }
            return;
          }
          
          if (parsed.trades && Array.isArray(parsed.trades)) {
             setTrades(parsed.trades);
             if (parsed.settings) setAppSettings(prev => ({ ...prev, ...parsed.settings }));
             alert(`成功导入 ${parsed.trades.length} 条交易记录`);
             return;
          }
          
          alert('无法识别的文件格式');
        }
      } catch (error) {
        alert('文件解析失败');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
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
        alert("请拖入 JSON 文件");
      }
    }
  };

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

    if (grams < 0.0001) { grams = 0; totalCost = 0; }
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

    return { newTotalGrams, newAvgCost, totalInvestment: newTotalCost, costDifference, projectedPnL: type === 'SELL' ? projectedPnL : undefined };
  };

  const simulation = useMemo(() => getSimulation(previewType), [currentPosition, inputs, previewType]);

  const executeTrade = () => {
    const type = previewType;
    const price = parseFloat(inputs.price);
    const grams = parseFloat(inputs.grams);
    if (!price || !grams) return;
    if (type === 'SELL' && grams > currentPosition.grams) { alert("卖出数量不能大于持仓量"); return; }
    const newTrade: TradeRecord = { id: Date.now().toString(), type, price, grams, timestamp: Date.now(), isDisabled: false };
    setTrades(prev => [...prev, newTrade]);
    setMarketPrice(inputs.price);
    setInputs({ price: '', grams: '' }); 
    setAiState({ loading: false, result: null, error: null });
  };

  const deleteTrade = (id: string) => setTrades(prev => prev.filter(t => t.id !== id));
  const updateTrade = (id: string, updates: Partial<TradeRecord>) => setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  const requestReset = () => setShowResetConfirm(true);
  const confirmReset = () => {
    setTrades([]);
    setInputs({ price: '', grams: '' });
    setMarketPrice('');
    setAiState({ loading: false, result: null, error: null });
    setPreviewType('BUY');
    setShowResetConfirm(false);
  };

  const handleAIAnalysis = async () => {
    const order: OrderState = { price: parseFloat(inputs.price) || 0, grams: parseFloat(inputs.grams) || 0 };
    if (!order.price || !order.grams) return;
    setAiState({ loading: true, result: null, error: null });
    const resultText = await analyzeTrade(currentPosition, order, previewType === 'BUY', simulation);
    setAiState({ loading: false, result: resultText, error: null });
  };

  const renderActionButtons = () => (
    <div className="relative">
      {/* Cloud Confirmation Popover - Refined to be more compact */}
      {cloudConfirm && (
        <div 
          className="absolute bottom-full mb-3 z-[100] animate-in fade-in zoom-in slide-in-from-bottom-2 duration-200 pointer-events-none"
          style={{ 
            left: cloudConfirm === 'download' 
              ? 'calc((100% / 7) * 1 + (100% / 14))' 
              : 'calc((100% / 7) * 2 + (100% / 14))',
            transform: 'translateX(-50%)'
          }}
        >
           <div className="bg-app-card border border-app-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-xl p-3 flex flex-col items-center text-center w-max min-w-[160px] max-w-[200px] pointer-events-auto">
              <div className="text-brand-yellow mb-1.5">
                 <AlertTriangle size={18} />
              </div>
              <h4 className="text-xs font-bold text-app-text mb-0.5 whitespace-nowrap">
                {cloudConfirm === 'upload' ? '确定上传？' : '确定下载？'}
              </h4>
              <p className="text-[10px] text-app-subtext mb-3 leading-tight">
                {cloudConfirm === 'upload' 
                   ? '覆盖云端备份数据' 
                   : '覆盖本地交易记录'}
              </p>
              <div className="grid grid-cols-2 gap-1.5 w-full">
                 <button 
                   onClick={() => setCloudConfirm(null)}
                   className="py-1 rounded-lg border border-app-border text-[10px] text-app-subtext hover:bg-app-input transition-colors font-medium"
                 >
                   取消
                 </button>
                 <button 
                   onClick={cloudConfirm === 'upload' ? handleCloudUpload : handleCloudDownload}
                   className={`py-1 rounded-lg text-[10px] text-white font-bold transition-opacity hover:opacity-90 ${cloudConfirm === 'upload' ? 'bg-brand-yellow' : 'bg-indigo-600'}`}
                 >
                   确定
                 </button>
              </div>
              {/* Triangle Arrow - Precisely pointed */}
              <div 
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-app-card border-r border-b border-app-border rotate-45"
              ></div>
           </div>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 lg:gap-2">
          <button 
              onClick={() => openSettings('general')}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
              title="设置"
            >
              <Settings size={16} />
          </button>
          
          <button 
              onClick={() => requestCloudAction('download')}
              disabled={isDownloading || downloadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all ${downloadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-indigo-400 hover:text-indigo-300 hover:border-indigo-500'} disabled:opacity-30`}
              title="从云端下载"
            >
              {isDownloading ? (
                <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              ) : downloadSuccess ? (
                <Check size={16} className="animate-in zoom-in duration-300" />
              ) : (
                <CloudDownload size={16} />
              )}
          </button>

          <button 
              onClick={() => requestCloudAction('upload')}
              disabled={isSyncing || uploadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all ${uploadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-brand-yellow hover:bg-brand-yellow/10 hover:border-brand-yellow'} disabled:opacity-30`}
              title="上传到云端"
            >
               {isSyncing ? (
                 <div className="w-4 h-4 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin"></div>
               ) : uploadSuccess ? (
                 <Check size={16} className="animate-in zoom-in duration-300" />
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
              onClick={handleExportClick}
              disabled={trades.length === 0}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors disabled:opacity-50"
              title="导出数据"
            >
              <Download size={16} />
          </button>

          <button 
              onClick={requestReset} 
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-red-400 hover:border-red-400 transition-colors"
              title="重置"
            >
              <RefreshCcw size={16} />
          </button>

          <button
              onClick={toggleTheme}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-brand-yellow hover:border-brand-yellow transition-colors"
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
      </div>
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
          .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
          .no-spinners { -moz-appearance: textfield; }
      `}</style>
      <CloudSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        githubConfig={githubConfig}
        appSettings={appSettings}
        onSave={handleSaveSettings}
        initialTab={settingsDefaultTab}
      />

      {/* Export Filename Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowExportModal(false)}>
          <div className="bg-app-card border border-app-border rounded-xl w-full max-w-sm shadow-2xl relative p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-app-text">导出数据</h3>
              <button onClick={() => setShowExportModal(false)} className="text-app-subtext hover:text-app-text transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={confirmExport} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-app-subtext font-medium">文件名称</label>
                <div className="flex items-center relative">
                  <input type="text" value={exportFileName} onChange={(e) => setExportFileName(e.target.value)} className="w-full bg-app-input border border-app-border rounded-lg pl-3 pr-14 py-2 text-app-text focus:border-brand-yellow outline-none transition-all font-mono text-sm" autoFocus />
                  <span className="absolute right-3 text-app-subtext text-xs pointer-events-none">.json</span>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowExportModal(false)} className="flex-1 py-2.5 rounded-lg border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text font-medium text-sm">取消</button>
                <button type="submit" disabled={!exportFileName.trim()} className="flex-1 py-2.5 rounded-lg bg-brand-yellow text-slate-900 hover:bg-[#fdd835] font-bold text-sm disabled:opacity-50">确认导出</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-app-card border border-app-border rounded-xl w-full max-sm shadow-2xl relative p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
             <div className="flex justify-between items-center">
               <h3 className="text-lg font-bold text-app-text">确认重置</h3>
                <button onClick={() => setShowResetConfirm(false)} className="text-app-subtext hover:text-app-text transition-colors"><X size={20} /></button>
             </div>
             <p className="text-app-subtext text-sm leading-relaxed">确定要清空所有交易记录和临时输入吗？<br/><span className="text-brand-red font-bold">此操作无法撤销。</span></p>
             <div className="flex gap-2 pt-2">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 rounded-lg border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text font-medium text-sm">取消</button>
                <button onClick={confirmReset} className="flex-1 py-2.5 rounded-lg bg-brand-red text-white hover:bg-red-500 font-bold text-sm">确认重置</button>
              </div>
          </div>
        </div>
      )}

      {isDragging && (
        <div className="absolute inset-0 bg-brand-yellow/10 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-brand-yellow m-4 rounded-3xl pointer-events-none text-center">
           <div><FileJson size={64} className="mx-auto text-brand-yellow mb-4" /><h3 className="text-2xl font-bold text-app-text">松开以导入数据</h3></div>
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />

      <div className="max-w-[1400px] w-full pb-12 flex flex-col">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-app-subtext tracking-wide">黄金交易模拟</h1>
            <span className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text ml-1">{APP_VERSION}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6 items-start">
          <div className="lg:col-span-8 flex flex-col gap-6 order-2 lg:order-1">
             <div className="space-y-3">
                <div className="flex items-center gap-2 text-app-subtext pl-1"><Wallet size={16} /><h3 className="font-medium text-sm">当前持仓详情</h3></div>
                <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border"><span className="text-xs text-app-subtext block mb-1">平均成本</span><div className="text-xl font-bold text-app-text font-mono">{currentPosition.avgCost.toFixed(2)}</div></div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border"><span className="text-xs text-app-subtext block mb-1">持仓数量 (克)</span><div className="text-xl font-bold text-app-text font-mono">{currentPosition.grams.toFixed(2)}</div></div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border"><span className="text-xs text-app-subtext block mb-1">持仓总投入</span><div className="text-xl font-bold text-app-text font-mono">{currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2})}</div></div>
                    <div className={`bg-app-bg p-3 rounded-lg border ${currentPosition.realizedPnL >= 0 ? 'border-brand-redDim' : 'border-brand-greenDim'}`}><span className="text-xs text-app-subtext block mb-1">已实现盈亏</span><div className={`text-xl font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toFixed(2)}</div></div>
                    <div className={`bg-app-bg p-3 rounded-lg border ${floatingPnL >= 0 ? 'border-brand-redDim bg-brand-redDim/20' : 'border-brand-greenDim bg-brand-greenDim/20'}`}><span className="text-xs text-app-subtext block mb-1">浮动盈亏</span><div className={`text-xl font-bold font-mono ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{marketPrice ? (floatingPnL > 0 ? '+' : '') + floatingPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2}) : '--'}</div></div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border relative group hover:border-brand-yellow/50 focus-within:border-brand-yellow transition-colors"><span className="text-xs text-app-subtext block mb-1">参考市价 (元/克)</span><div className="flex items-center"><input ref={marketPriceInputRef} type="number" value={marketPrice} onChange={(e) => handleMarketPriceChange(e.target.value)} placeholder="0.00" className="no-spinners text-xl font-bold text-brand-yellow font-mono bg-transparent border-none p-0 w-full outline-none" /><div className="flex flex-col gap-0.5 ml-2"><button onClick={() => updateMarketPrice(appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronUp size={10} strokeWidth={3} /></button><button onClick={() => updateMarketPrice(-appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronDown size={10} strokeWidth={3} /></button></div></div></div>
                </div>
             </div>
             <div className="space-y-3">
               <div className="flex items-center gap-2 text-app-subtext pl-1"><History size={16} /><h3 className="font-medium text-sm">成交记录</h3></div>
               <TradeList trades={trades} onDelete={deleteTrade} onUpdate={updateTrade} settings={appSettings} onSettingsChange={handleSettingsUpdate} />
             </div>
             <div className="bg-app-card border border-app-border rounded-xl p-4 transition-colors"><div className="flex items-center justify-between mb-2"><h3 className="text-app-text font-medium flex items-center gap-2"><BrainCircuit size={16} className="text-indigo-400"/>智能分析 (预览)</h3><button onClick={handleAIAnalysis} disabled={aiState.loading || !inputs.grams || !inputs.price} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded disabled:opacity-50">{aiState.loading ? "分析中..." : "Gemini 深度分析"}</button></div>{aiState.result ? <div className="text-sm text-app-text leading-relaxed bg-app-input p-3 rounded-lg border border-app-border whitespace-pre-wrap">{aiState.result}</div> : <div className="text-xs text-app-subtext italic">输入交易信息后点击分析。</div>}</div>
          </div>

          <div className="lg:col-span-4 lg:col-start-9 order-1 lg:order-2 lg:sticky lg:top-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-app-subtext pl-1"><TrendingUp size={16} /><h3 className="font-medium text-sm">模拟交易</h3></div>
              <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 p-1 bg-app-input rounded-lg"><button onClick={() => setPreviewType('BUY')} className={`py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-all ${previewType === 'BUY' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-app-subtext hover:text-app-text'}`}><TrendingUp size={16} />买入</button><button onClick={() => setPreviewType('SELL')} className={`py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-all ${previewType === 'SELL' ? 'bg-brand-green text-white shadow-lg shadow-brand-green/20' : 'text-app-subtext hover:text-app-text'}`}><TrendingDown size={16} />卖出</button></div>
                <div className="grid grid-cols-2 gap-2"><InputGroup label="价格 (元/克)" value={inputs.price} onChange={(v) => handleInputChange('price', v)} placeholder="0.00" step={appSettings.priceStep} /><InputGroup label="数量 (克)" value={inputs.grams} onChange={(v) => handleInputChange('grams', v)} placeholder="0.00" step={appSettings.gramsStep} /></div>
                <div className="bg-app-input/30 rounded-xl p-4 border border-app-border space-y-3">
                    <div className="flex justify-between items-start"><div><span className="text-[10px] font-bold text-app-subtext uppercase block mb-1">成交后均价预估</span><div className="flex items-baseline gap-1.5"><span className="text-3xl font-bold text-app-text tracking-tight font-mono">{simulation.newAvgCost.toFixed(2)}</span><span className="text-[10px] text-app-subtext font-bold">CNY</span></div></div><div className="text-right">{currentPosition.grams > 0 && inputs.grams && previewType === 'BUY' ? <><span className="text-[10px] font-bold text-app-subtext uppercase block mb-1">成本浮动</span><div className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded border ${simulation.costDifference > 0 ? 'bg-brand-red/10 text-brand-red border-brand-red/20' : 'bg-brand-green/10 text-brand-green border-brand-green/20'}`}>{simulation.costDifference > 0 ? '+' : ''}{simulation.costDifference.toFixed(2)}%</div></> : previewType === 'SELL' ? <><span className="text-[10px] font-bold text-app-subtext uppercase block mb-1">持仓成本</span><span className="text-xs font-bold text-app-subtext font-mono">不变</span></> : <span className="text-app-subtext text-xs">-</span>}</div></div>
                    <div className="h-px bg-white/5 w-full" /><div className="grid grid-cols-2 gap-x-4 gap-y-2"><div><p className="text-app-subtext text-[10px] font-medium">预计总持仓</p><div className="flex items-baseline gap-1"><span className="text-lg font-bold text-app-text font-mono">{simulation.newTotalGrams.toFixed(2)}</span><span className="text-[10px] text-app-subtext">g</span></div></div><div className="text-right"><p className="text-app-subtext text-[10px] font-medium">本次交易额</p><div className="flex items-baseline gap-1 justify-end"><span className="text-lg font-bold text-app-text font-mono">{((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}</span><span className="text-[10px] text-app-subtext">¥</span></div></div>{previewType === 'SELL' && simulation.projectedPnL !== undefined && (<div className="col-span-2 border-t border-white/[0.03] pt-2 flex justify-between items-center"><span className="text-app-subtext text-[10px] font-bold">预计本次盈亏：</span><span className={`font-mono font-bold text-sm ${simulation.projectedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}</span></div>)}</div>
                </div>
                {inputs.grams && inputs.price && <CostChart currentAvg={currentPosition.avgCost} newAvg={previewType === 'BUY' ? simulation.newAvgCost : parseFloat(inputs.price)} orderType={previewType} />}
                <button onClick={executeTrade} disabled={!inputs.price || !inputs.grams} className={`w-full py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 shadow-md ${previewType === 'BUY' ? 'bg-brand-red text-white hover:bg-red-500' : 'bg-brand-green text-white hover:bg-green-500'}`}><CheckCircle2 size={16} />成交</button>
              </div>
            </div>
            <div className="hidden lg:block">{renderActionButtons()}</div>
          </div>
        </div>
        <div className="lg:hidden mt-2 order-3">{renderActionButtons()}</div>
      </div>
    </div>
  );
}

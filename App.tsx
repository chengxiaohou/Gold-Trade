
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Wallet, History, TrendingUp, TrendingDown, CheckCircle2, Download, Upload, FileJson, CloudUpload, CloudDownload, Settings, ArrowRight, ChevronUp, ChevronDown, Moon, Sun, Plus, Minus, X, Check, AlertTriangle, Zap, Activity } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { TradingPlanPanel } from './components/TradingPlanPanel';
import { CloudSettingsModal } from './components/CloudSettingsModal';
import { analyzeTrade } from './services/geminiService';
import { saveToGist, loadFromGist } from './services/githubService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType, GithubConfig, AppSettings } from './types';

const APP_VERSION = 'v1.9.17';

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
      tagColors: parsed.tagColors || {},
      touchMode: parsed.touchMode ?? true,
      priceDisplayMode: parsed.priceDisplayMode || 'breakEven',
      totalCapital: parsed.totalCapital || 0
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
  const [isEditingCapital, setIsEditingCapital] = useState(false);

  // 5. Preview Type
  const [previewType, setPreviewType] = useState<OrderType>(() => {
    const saved = localStorage.getItem('gold_preview_type');
    return (saved === 'SELL') ? 'SELL' : 'BUY';
  });
  
  const [activeSimPanel, setActiveSimPanel] = useState<'manual' | 'plan' | 'none'>('manual');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const marketPriceInputRef = useRef<HTMLInputElement>(null);

  // --- Refs for Event Listeners (Prevent Stale Closures in Touch/Wheel Handlers) ---
  const marketPriceValueRef = useRef(marketPrice);
  useEffect(() => {
    marketPriceValueRef.current = marketPrice;
  }, [marketPrice]);

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


  // --- Position Calculation ---
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
    const breakEvenPrice = grams > 0 ? Math.max(0, (totalCost - realizedPnL) / grams) : 0;
    return { grams, avgCost, totalCost, realizedPnL, breakEvenPrice };
  }, [trades]);

  const availableFunds = Math.max(0, (appSettings.totalCapital || 0) - currentPosition.totalCost);

  const floatingPnL = useMemo(() => {
    const market = parseFloat(marketPrice) || 0;
    if (market <= 0 || currentPosition.grams <= 0) return 0;
    return (market - currentPosition.avgCost) * currentPosition.grams;
  }, [marketPrice, currentPosition]);

  // --- Handlers ---
  const handleInputChange = (field: keyof typeof inputs, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    
    let processedValue = value;
    const numVal = parseFloat(value) || 0;

    if (field === 'grams' && previewType === 'SELL') {
      if (numVal > currentPosition.grams) {
        processedValue = currentPosition.grams.toString();
      }
    }

    if (previewType === 'BUY' && field === 'grams') {
      if (value.includes('.')) {
        processedValue = value.split('.')[0];
      }
    }

    if (previewType === 'BUY' && appSettings.totalCapital && appSettings.totalCapital > 0) {
      const availableCapital = appSettings.totalCapital - currentPosition.totalCost;
      const otherField = field === 'grams' ? 'price' : 'grams';
      // Use the current input state for the other field
      const otherVal = parseFloat(inputs[otherField]) || 0;
      
      if (availableCapital > 0) {
        if (numVal * otherVal > availableCapital) {
          if (field === 'grams' && otherVal > 0) {
            const maxGrams = availableCapital / otherVal;
            processedValue = Math.floor(maxGrams).toString();
          } else if (field === 'price' && otherVal > 0) {
            const maxPrice = availableCapital / otherVal;
            processedValue = (Math.floor(maxPrice * 100) / 100).toString();
          }
        }
      } else {
        // No available capital, force to 0 if they try to enter a positive number
        if (numVal > 0) {
          processedValue = "0";
        }
      }
    }
    
    setInputs(prev => ({ ...prev, [field]: processedValue }));
  };

  const handleMarketPriceChange = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setMarketPrice(value);
    
    // Real-time synchronization: Update simulation input price when market price changes
    setInputs(prev => {
      let newGrams = prev.grams;
      const newPriceNum = parseFloat(value) || 0;
      const currentGramsNum = parseFloat(prev.grams) || 0;
      
      if (previewType === 'BUY' && appSettings.totalCapital && appSettings.totalCapital > 0) {
        const availableCapital = appSettings.totalCapital - currentPosition.totalCost;
        if (availableCapital > 0) {
          if (newPriceNum * currentGramsNum > availableCapital && newPriceNum > 0) {
            const maxGrams = availableCapital / newPriceNum;
            newGrams = (Math.floor(maxGrams * 100) / 100).toString();
          }
        } else if (currentGramsNum > 0) {
          newGrams = "0";
        }
      }
      
      return { price: value, grams: newGrams };
    });
  };

  // Keep a ref to the handler to use in Effect without triggering re-binds
  const handleMarketPriceChangeRef = useRef(handleMarketPriceChange);
  useEffect(() => {
    handleMarketPriceChangeRef.current = handleMarketPriceChange;
  }, [handleMarketPriceChange]);

  // Sync market price with the latest active trade when trades change
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const activeTrades = trades.filter(t => !t.isDisabled);
    if (activeTrades.length > 0) {
      const latestTrade = activeTrades[activeTrades.length - 1];
      handleMarketPriceChangeRef.current(latestTrade.price.toString());
    } else {
      handleMarketPriceChangeRef.current('');
    }
  }, [trades]);

  const updateMarketPrice = (delta: number) => {
    const currentVal = parseFloat(marketPrice) || 0;
    const nextVal = Math.max(0, currentVal + delta);
    const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
    handleMarketPriceChange(nextStr);
  };

  // Switch Order Type logic: resets grams and syncs price
  const changeOrderType = (type: OrderType) => {
    setPreviewType(type);
    setInputs({
      price: marketPrice,
      grams: ''
    });
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

  // Touch listener for Market Price (Slide to adjust)
  useEffect(() => {
    if (!appSettings.touchMode || !marketPriceInputRef.current) return;
    
    const el = marketPriceInputRef.current;
    let lastY = 0;
    const threshold = 15;
    let accumulator = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      lastY = e.touches[0].clientY;
      accumulator = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      
      if (e.cancelable) e.preventDefault();
      
      const currentY = e.touches[0].clientY;
      const deltaY = lastY - currentY; 
      
      accumulator += deltaY;
      
      const steps = Math.floor(Math.abs(accumulator) / threshold);
      
      if (steps > 0) {
         const direction = accumulator > 0 ? 1 : -1;
         
         const currentVal = parseFloat(marketPriceValueRef.current) || 0;
         const changeAmount = direction * appSettings.priceStep * steps;
         const nextVal = Math.max(0, currentVal + changeAmount);
         const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
         
         handleMarketPriceChangeRef.current(nextStr);
         
         accumulator -= (direction * steps * threshold);
      }
      
      lastY = currentY;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [appSettings.touchMode, appSettings.priceStep]);

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
      alert((error as Error).message);
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
      alert((error as Error).message);
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

  const getSimulation = (type: OrderType): SimulationResult => {
    const price = parseFloat(inputs.price) || 0;
    const grams = parseFloat(inputs.grams) || 0;
    let newTotalGrams = 0;
    let newTotalCost = 0;
    let projectedPnL = 0;
    let newRealizedPnL = currentPosition.realizedPnL;

    if (type === 'BUY') {
      newTotalGrams = currentPosition.grams + grams;
      newTotalCost = currentPosition.totalCost + (price * grams);
    } else {
      newTotalGrams = Math.max(0, currentPosition.grams - grams);
      const costBasis = grams * currentPosition.avgCost;
      newTotalCost = currentPosition.totalCost - costBasis;
      projectedPnL = (price * grams) - costBasis;
      newRealizedPnL += projectedPnL;
    }

    const newAvgCost = newTotalGrams > 0 ? newTotalCost / newTotalGrams : 0;
    const newBreakEvenPrice = newTotalGrams > 0 ? Math.max(0, (newTotalCost - newRealizedPnL) / newTotalGrams) : 0;
    
    const costDifference = currentPosition.avgCost > 0 
      ? ((newAvgCost - currentPosition.avgCost) / currentPosition.avgCost) * 100 
      : 0;
    
    const totalValueChange = currentPosition.totalCost > 0
      ? ((newTotalCost - currentPosition.totalCost) / currentPosition.totalCost) * 100
      : (currentPosition.totalCost === 0 && newTotalCost > 0 ? 100 : 0);

    return { 
      newTotalGrams, 
      newAvgCost, 
      newBreakEvenPrice,
      totalInvestment: newTotalCost, 
      costDifference, 
      totalValueChange,
      projectedPnL: type === 'SELL' ? projectedPnL : undefined 
    };
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
    setInputs({ price: inputs.price, grams: '' }); // Keep the price, reset grams
    setAiState({ loading: false, result: null, error: null });
  };

  const handleApplyPlan = (planTrades: TradeRecord[]) => {
    // Remove existing plan trades
    setTrades(prev => {
      const filtered = prev.filter(t => !t.isPlan);
      return [...filtered, ...planTrades];
    });
  };

  const handleClearPlan = () => {
    setTrades(prev => prev.filter(t => !t.isPlan));
  };

  const hasPlan = useMemo(() => trades.some(t => t.isPlan), [trades]);

  const deleteTrade = (id: string) => setTrades(prev => prev.filter(t => t.id !== id));
  const updateTrade = (id: string, updates: Partial<TradeRecord>) => setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  const handleReorderTrades = (newTrades: TradeRecord[]) => setTrades(newTrades);

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

  const renderPriceLabel = (baseLabel: string) => {
    const isAvg = baseLabel.includes('均价') || baseLabel.includes('平均成本');
    if (!isAvg) return baseLabel;
    
    if (appSettings.priceDisplayMode === 'breakEven') return baseLabel.replace('均价', '回本价').replace('平均成本', '回本价');
    if (appSettings.priceDisplayMode === 'avgCost') return baseLabel.replace('回本价', '持仓均价').replace('平均成本', '持仓均价');
    return (
      <span className="flex flex-col leading-tight">
        <span>{baseLabel.replace('均价', '回本价').replace('平均成本', '回本价')}</span>
        <span className="text-[10px] opacity-70">持仓均价</span>
      </span>
    );
  };

  const renderPriceValue = (breakEven: number, avgCost: number, smallClassName: string = "text-sm text-app-subtext") => {
    if (appSettings.priceDisplayMode === 'breakEven') return breakEven.toFixed(2);
    if (appSettings.priceDisplayMode === 'avgCost') return avgCost.toFixed(2);
    return (
      <span className="flex flex-col leading-tight">
        <span>{breakEven.toFixed(2)}</span>
        <span className={smallClassName}>{avgCost.toFixed(2)}</span>
      </span>
    );
  };

  const renderPriceDiff = (newBreakEven: number, oldBreakEven: number, newAvg: number, oldAvg: number) => {
    const diffBreakEven = newBreakEven - oldBreakEven;
    const diffAvg = newAvg - oldAvg;
    
    const renderSingleDiff = (diff: number) => {
      if (Math.abs(diff) < 0.001) return <div className="flex items-center h-4 text-xs text-app-subtext font-mono">-</div>;
      return (
        <div className={`flex items-center h-4 text-xs font-bold font-mono ${diff < 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            {diff > 0 ? (
              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current mr-1" />
            ) : (
              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current mr-1" />
            )}
            {Math.abs(diff).toFixed(2)}
        </div>
      );
    };

    if (appSettings.priceDisplayMode === 'breakEven') return renderSingleDiff(diffBreakEven);
    if (appSettings.priceDisplayMode === 'avgCost') return renderSingleDiff(diffAvg);
    
    return (
      <div className="flex flex-col items-end leading-tight">
        {renderSingleDiff(diffBreakEven)}
        <div className="opacity-70 scale-90 origin-right">
          {renderSingleDiff(diffAvg)}
        </div>
      </div>
    );
  };

  const renderActionButtons = () => (
    <div className="relative">
      {/* Cloud Confirmation Popover */}
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
              onClick={handleExportClick}
              disabled={trades.length === 0}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors disabled:opacity-50"
              title="导出数据"
            >
              <Download size={16} />
          </button>

          <button 
              onClick={handleImportClick} 
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
              title="导入数据"
            >
              <Upload size={16} />
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
      <CloudSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        githubConfig={githubConfig}
        appSettings={appSettings}
        onSave={handleSaveSettings}
        initialTab={settingsDefaultTab}
      />

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
                <div className="flex items-center gap-2 text-app-subtext pl-1"><Wallet size={16} /><h3 className="font-medium text-sm">持仓详情</h3></div>
                <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5 transition-colors relative group hover:border-indigo-500/50 focus-within:border-indigo-500">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">总资金</span>
                            {isEditingCapital ? (
                                <input 
                                    autoFocus
                                    type="number" 
                                    value={appSettings.totalCapital || ''} 
                                    onChange={(e) => handleSettingsUpdate({ totalCapital: parseFloat(e.target.value) || 0 })} 
                                    onBlur={() => setIsEditingCapital(false)}
                                    placeholder="0.00" 
                                    className="no-spinners text-sm font-bold text-app-text font-mono bg-transparent border-none p-0 text-right outline-none w-24" 
                                />
                            ) : (
                                <span 
                                    onClick={() => setIsEditingCapital(true)}
                                    className="text-sm font-bold font-mono text-app-text cursor-pointer hover:text-indigo-400 transition-colors"
                                >
                                    {appSettings.totalCapital ? appSettings.totalCapital.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0.00'}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">可用资金</span>
                            <span className="text-sm font-bold font-mono text-app-text">
                                {appSettings.totalCapital ? (appSettings.totalCapital - currentPosition.totalCost).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}
                            </span>
                        </div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">持仓净值</span>
                            <span className="text-sm font-bold font-mono text-app-text">
                                {marketPrice ? (currentPosition.grams * (parseFloat(marketPrice) || 0)).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">持仓数量</span>
                            <span className="text-sm font-bold font-mono text-app-text">{currentPosition.grams.toFixed(2)} 克</span>
                        </div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">持仓总投入</span>
                            <span className="text-sm font-bold font-mono text-app-text">
                                {currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">仓位占比</span>
                            <span className="text-sm font-bold font-mono text-app-text">
                                {appSettings.totalCapital && appSettings.totalCapital > 0 ? ((currentPosition.totalCost / appSettings.totalCapital) * 100).toFixed(1) + '%' : '--'}
                            </span>
                        </div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">浮动盈亏</span>
                            <span className={`text-sm font-bold font-mono ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{marketPrice ? (floatingPnL > 0 ? '+' : '') + floatingPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-app-subtext">已实现盈亏</span>
                            <span className={`text-sm font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        </div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center">
                        <span className="text-xs text-app-subtext block mb-1">{renderPriceLabel('平均成本')}</span>
                        <div className="text-xl font-bold text-app-text font-mono">
                            {renderPriceValue(currentPosition.breakEvenPrice, currentPosition.avgCost, "text-xs text-app-subtext")}
                        </div>
                    </div>
                    <div className="bg-app-bg p-3 rounded-lg border border-app-border relative group hover:border-brand-yellow/50 focus-within:border-brand-yellow transition-colors">
                        <span className="text-xs text-app-subtext block mb-1">参考市价 (元/克)</span>
                        <div className="flex items-center">
                            <input 
                                ref={marketPriceInputRef} 
                                type="number" 
                                value={marketPrice} 
                                onChange={(e) => handleMarketPriceChange(e.target.value)} 
                                placeholder="0.00" 
                                className={`no-spinners text-xl font-bold font-mono bg-transparent border-none p-0 w-full outline-none ${appSettings.touchMode ? 'cursor-ns-resize' : ''} ${
                                    currentPosition.grams > 0 && parseFloat(marketPrice) 
                                        ? (parseFloat(marketPrice) > currentPosition.breakEvenPrice ? 'text-brand-red' : parseFloat(marketPrice) < currentPosition.breakEvenPrice ? 'text-brand-green' : 'text-brand-yellow')
                                        : 'text-brand-yellow'
                                }`} 
                            />
                            <div className="flex flex-col gap-0.5 ml-2">
                                <button onClick={() => updateMarketPrice(appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronUp size={10} strokeWidth={3} /></button>
                                <button onClick={() => updateMarketPrice(-appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronDown size={10} strokeWidth={3} /></button>
                            </div>
                        </div>
                    </div>
                </div>
             </div>
             <div className="space-y-3">
               <div className="flex items-center gap-2 text-app-subtext pl-1"><History size={16} /><h3 className="font-medium text-sm">成交记录</h3></div>
               <TradeList trades={trades} onDelete={deleteTrade} onUpdate={updateTrade} onReorder={handleReorderTrades} settings={appSettings} onSettingsChange={handleSettingsUpdate} />
             </div>
             <div className="bg-app-card border border-app-border rounded-xl p-4 transition-colors"><div className="flex items-center justify-between mb-2"><h3 className="text-app-text font-medium flex items-center gap-2"><BrainCircuit size={16} className="text-indigo-400"/>智能分析 (预览)</h3><button onClick={handleAIAnalysis} disabled={aiState.loading || !inputs.grams || !inputs.price} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded disabled:opacity-50">{aiState.loading ? "分析中..." : "Gemini 深度分析"}</button></div>{aiState.result ? <div className="text-sm text-app-text leading-relaxed bg-app-input p-3 rounded-lg border border-app-border whitespace-pre-wrap">{aiState.result}</div> : <div className="text-xs text-app-subtext italic">输入交易信息后点击分析。</div>}</div>
          </div>

          <div className="lg:col-span-4 lg:col-start-9 order-1 lg:order-2 lg:sticky lg:top-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-app-subtext pl-1"><TrendingUp size={16} /><h3 className="font-medium text-sm">模拟交易</h3></div>
              <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl flex flex-col">
                <button 
                  onClick={() => setActiveSimPanel(prev => prev === 'manual' ? 'none' : 'manual')}
                  className="flex items-center justify-between p-3 bg-app-input/50 hover:bg-app-hover transition-colors"
                >
                  <div className="flex items-center gap-2 text-app-text font-medium text-sm">
                    <Activity size={16} className={previewType === 'BUY' ? 'text-brand-red' : 'text-brand-green'} />
                    交易窗口
                  </div>
                  <ChevronDown size={16} className={`text-app-subtext transition-transform ${activeSimPanel === 'manual' ? 'rotate-180' : ''}`} />
                </button>
                
                {activeSimPanel === 'manual' && (
                  <div className="p-4 flex flex-col gap-3 border-t border-app-border">
                    <div className="grid grid-cols-2 p-1 bg-app-input rounded-lg">
                      <button onClick={() => changeOrderType('BUY')} className={`py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-all ${previewType === 'BUY' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-app-subtext hover:text-app-text'}`}>
                        <TrendingUp size={16} />买入
                      </button>
                      <button onClick={() => changeOrderType('SELL')} className={`py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 transition-all ${previewType === 'SELL' ? 'bg-brand-green text-white shadow-lg shadow-brand-green/20' : 'text-app-subtext hover:text-app-text'}`}>
                        <TrendingDown size={16} />卖出
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <InputGroup 
                        label="价格 (元/克)" 
                        value={inputs.price} 
                        onChange={(v) => handleInputChange('price', v)} 
                        placeholder="0.00" 
                        step={appSettings.priceStep}
                        touchMode={appSettings.touchMode} 
                      />
                      <div className="relative">
                        <InputGroup 
                          label="数量 (克)" 
                          value={inputs.grams} 
                          onChange={(v) => handleInputChange('grams', v)} 
                          placeholder="0.00" 
                          step={appSettings.gramsStep} 
                          isQuantity={true}
                          touchMode={appSettings.touchMode} 
                        />
                        {previewType === 'SELL' && currentPosition.grams > 0 && (
                          <button 
                            onClick={() => handleInputChange('grams', currentPosition.grams.toString())}
                            className="absolute -top-1 right-0 text-[9px] font-bold text-brand-green hover:underline"
                          >
                            全部卖出
                          </button>
                        )}
                        {previewType === 'BUY' && appSettings.totalCapital && appSettings.totalCapital > 0 && (appSettings.totalCapital - currentPosition.totalCost) > 0 && parseFloat(inputs.price) > 0 && (
                          <button 
                            onClick={() => {
                              const available = appSettings.totalCapital! - currentPosition.totalCost;
                              const maxGrams = available / parseFloat(inputs.price);
                              handleInputChange('grams', Math.floor(maxGrams).toString());
                            }}
                            className="absolute -top-1 right-0 text-[9px] font-bold text-brand-red hover:underline"
                          >
                            全部买入
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="bg-app-input/30 rounded-xl p-4 border border-app-border space-y-3">
                        <div className="flex justify-between items-start">
                            <div>
                                <span className="text-[10px] font-bold text-app-subtext uppercase block mb-1">{renderPriceLabel('成交后均价预估')}</span>
                                <div className="flex items-baseline gap-1.5"><span className="text-3xl font-bold text-app-text tracking-tight font-mono">{renderPriceValue(simulation.newBreakEvenPrice, simulation.newAvgCost, "text-sm text-app-subtext font-bold")}</span><span className="text-[10px] text-app-subtext font-bold">¥</span></div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] text-app-subtext font-medium opacity-80">较当前</span>
                                    {renderPriceDiff(simulation.newBreakEvenPrice, currentPosition.breakEvenPrice, simulation.newAvgCost, currentPosition.avgCost)}
                                </div>
                            </div>
                        </div>
                        <div className="h-px bg-white/5 w-full" />
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                                <p className="text-app-subtext text-[10px] font-medium">预计总持仓 (金额)</p>
                                <div className="flex flex-col">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-lg font-bold text-app-text font-mono">{simulation.totalInvestment.toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                                        <span className="text-[10px] text-app-subtext">¥</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[10px] text-app-subtext font-medium opacity-80">较当前</span>
                                        {Math.abs(simulation.totalValueChange) > 0.001 ? (
                                        <div className={`flex items-center h-4 text-xs font-bold font-mono ${simulation.totalValueChange > 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                                            {simulation.totalValueChange > 0 ? (
                                              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current mr-1" />
                                            ) : (
                                              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current mr-1" />
                                            )}
                                            {Math.abs(simulation.totalValueChange).toFixed(2)}%
                                        </div>
                                        ) : (
                                        <div className="flex items-center h-4 text-xs text-app-subtext font-mono">-</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-app-subtext text-[10px] font-medium">本次交易额</p>
                                <div className="flex items-baseline gap-1 justify-end">
                                    <span className="text-lg font-bold text-app-text font-mono">{((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                                    <span className="text-[10px] text-app-subtext">¥</span>
                                </div>
                            </div>
                            {previewType === 'SELL' && simulation.projectedPnL !== undefined && (<div className="col-span-2 border-t border-white/[0.03] pt-2 flex justify-between items-center"><span className="text-app-subtext text-[10px] font-bold">预计本次盈亏：</span><span className={`font-mono font-bold text-sm ${simulation.projectedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}</span></div>)}
                        </div>
                        {/* Move CostChart inside the stats card to integrate it as a visual footer */}
                        {inputs.grams && inputs.price && (
                          <CostChart currentValue={currentPosition.totalCost} newValue={simulation.totalInvestment} />
                        )}
                    </div>
                    <button onClick={executeTrade} disabled={!inputs.price || !inputs.grams} className={`w-full py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 shadow-md ${previewType === 'BUY' ? 'bg-brand-red text-white hover:bg-red-500' : 'bg-brand-green text-white hover:bg-green-500'}`}><CheckCircle2 size={16} />成交</button>
                  </div>
                )}
              </div>
              
              <TradingPlanPanel 
                marketPrice={marketPrice}
                onMarketPriceChange={handleMarketPriceChange}
                priceStep={appSettings.priceStep}
                touchMode={appSettings.touchMode}
                availableFunds={availableFunds}
                isExpanded={activeSimPanel === 'plan'}
                onToggle={() => setActiveSimPanel(prev => prev === 'plan' ? 'none' : 'plan')}
                onApplyPlan={handleApplyPlan}
                onClearPlan={handleClearPlan}
                hasPlan={hasPlan}
              />
            </div>
            <div className="hidden lg:block">{renderActionButtons()}</div>
          </div>
        </div>
        <div className="lg:hidden mt-2 order-3">{renderActionButtons()}</div>
      </div>
    </div>
  );
}

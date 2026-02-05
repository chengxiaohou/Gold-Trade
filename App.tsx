import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Calculator, Wallet, Plus, History, TrendingUp, CheckCircle2, Download, Upload, FileJson } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { analyzeTrade } from './services/geminiService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType } from './types';

export default function App() {
  // --- State ---
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  // Inputs for the NEXT trade
  const [inputs, setInputs] = useState({
    price: '',
    grams: ''
  });

  const [aiState, setAiState] = useState<AIAnalysisState>({
    loading: false,
    result: null,
    error: null
  });

  // We default to simulating a BUY for the UI
  const [previewType, setPreviewType] = useState<OrderType>('BUY');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Handlers ---
  const handleInputChange = (field: keyof typeof inputs, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setInputs(prev => ({ ...prev, [field]: value }));
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
            // Basic validation
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
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // --- Drag & Drop Handlers ---
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/json") {
      processFile(file);
    } else if (file) {
      alert("请拖入 JSON 格式的文件");
    }
  };

  // --- Core Calculation: Derived Holdings from History ---
  const currentPosition: HoldingState = useMemo(() => {
    let grams = 0;
    let totalCost = 0;
    let realizedPnL = 0;

    trades.forEach(t => {
      const tradeValue = t.grams * t.price;
      if (t.type === 'BUY') {
        grams += t.grams;
        totalCost += tradeValue;
      } else {
        // Sell logic: Reduces quantity, does not change avg cost of remaining items
        // But we need to track realized PnL
        const currentAvg = grams > 0 ? totalCost / grams : 0;
        const costBasis = t.grams * currentAvg;
        
        grams = Math.max(0, grams - t.grams);
        totalCost -= costBasis; // Reduce the cost pool
        realizedPnL += (tradeValue - costBasis);
      }
    });

    // Floating point cleanup
    if (grams < 0.0001) {
      grams = 0;
      totalCost = 0;
    }

    const avgCost = grams > 0 ? totalCost / grams : 0;

    return { grams, avgCost, totalCost, realizedPnL };
  }, [trades]);

  // --- Simulation: "What if" for the inputs ---
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
      // Sell Simulation
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
      timestamp: Date.now()
    };

    setTrades(prev => [...prev, newTrade]);
    setInputs({ price: '', grams: '' }); // Clear inputs
    setAiState({ loading: false, result: null, error: null });
  };

  const deleteTrade = (id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
  };

  const resetAll = () => {
    if (window.confirm("确定要清空所有数据吗？此操作无法撤销。")) {
      setTrades([]);
      setInputs({ price: '', grams: '' });
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
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-brand-yellow/10 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-brand-yellow m-4 rounded-3xl">
          <div className="text-center">
            <FileJson size={64} className="mx-auto text-brand-yellow mb-4" />
            <h3 className="text-2xl font-bold text-white">松开以导入数据</h3>
            <p className="text-brand-yellow/80">支持 .json 格式的交易记录文件</p>
          </div>
        </div>
      )}

      <div className="max-w-6xl w-full">
        
        {/* Top Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-brand-yellow">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
                  <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6z" opacity="0.5"/>
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white tracking-wide">
                <span className="text-brand-yellow">黄金交易</span> 成本预估
              </h1>
            </div>
            <p className="text-slate-500 text-sm max-w-2xl">
              记录每笔买卖，自动计算持仓均价。输入新订单可预览成本变化。
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2">
             <input 
               type="file" 
               ref={fileInputRef} 
               onChange={handleFileChange} 
               className="hidden" 
               accept=".json"
             />
             <button 
                onClick={handleImportClick} 
                className="bg-app-card border border-app-border text-slate-400 px-3 py-1.5 rounded text-sm hover:text-white hover:border-slate-500 transition-colors flex items-center gap-2"
                title="导入数据"
              >
                <Upload size={14} /> <span className="hidden sm:inline">导入</span>
             </button>
             <button 
                onClick={handleExport}
                disabled={trades.length === 0}
                className="bg-app-card border border-app-border text-slate-400 px-3 py-1.5 rounded text-sm hover:text-white hover:border-slate-500 transition-colors flex items-center gap-2 disabled:opacity-50"
                title="导出数据"
              >
                <Download size={14} /> <span className="hidden sm:inline">导出</span>
             </button>
             <button 
                onClick={resetAll} 
                className="bg-app-card border border-app-border text-slate-400 px-3 py-1.5 rounded text-sm hover:text-red-400 hover:border-red-900/50 transition-colors flex items-center gap-2"
                title="重置"
              >
                <RefreshCcw size={14} />
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* 1. Current Position Summary */}
            <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                 <Wallet size={18} className="text-brand-yellow"/>
                 <h2 className="text-brand-yellow font-bold text-lg">当前持仓详情</h2>
                 <span className="text-xs text-slate-500 ml-auto">基于成交记录自动计算</span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                  <span className="text-xs text-slate-500 block mb-1">平均成本</span>
                  <div className="text-xl font-bold text-white font-mono">{currentPosition.avgCost.toFixed(2)}</div>
                </div>
                <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                  <span className="text-xs text-slate-500 block mb-1">持仓数量 (克)</span>
                  <div className="text-xl font-bold text-white font-mono">{currentPosition.grams.toFixed(2)}</div>
                </div>
                <div className="bg-app-bg p-3 rounded-lg border border-app-border">
                  <span className="text-xs text-slate-500 block mb-1">持仓市值 (估)</span>
                  <div className="text-xl font-bold text-slate-300 font-mono">
                    {currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </div>
                </div>
                <div className={`bg-app-bg p-3 rounded-lg border ${currentPosition.realizedPnL >= 0 ? 'border-brand-green/30' : 'border-brand-red/30'}`}>
                  <span className="text-xs text-slate-500 block mb-1">已实现盈亏</span>
                  <div className={`text-xl font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                    {currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. New Order Input */}
            <div className="bg-app-card border border-brand-yellow rounded-xl p-6 shadow-md relative overflow-hidden">
               <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-yellow"></div>
               
               <div className="flex justify-between items-center mb-6 pl-2">
                 <div className="flex items-center gap-2">
                   <Plus size={18} className="text-slate-900 bg-brand-yellow p-0.5 rounded-sm"/>
                   <h2 className="text-white font-bold text-lg">新增挂单预览</h2>
                 </div>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 pl-2">
                 <InputGroup 
                    label="挂单价格 (元/克)"
                    value={inputs.price}
                    onChange={(v) => handleInputChange('price', v)}
                    placeholder="0.00"
                  />
                  <InputGroup 
                    label="挂单数量 (克)"
                    value={inputs.grams}
                    onChange={(v) => handleInputChange('grams', v)}
                    placeholder="0.00"
                  />
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2">
                  <button
                    onClick={() => setPreviewType('BUY')}
                    className={`relative group px-6 py-4 rounded-lg border transition-all duration-200 flex items-center justify-center gap-2 font-bold
                      ${previewType === 'BUY'
                        ? 'bg-brand-red text-white border-brand-red shadow-lg shadow-brand-red/20 scale-[1.02]'
                        : 'bg-app-bg border-app-border text-slate-400 hover:border-slate-500'
                      }`}
                  >
                     <TrendingUp size={18} />
                     买入预估
                  </button>

                  <button
                    onClick={() => setPreviewType('SELL')}
                    className={`relative group px-6 py-4 rounded-lg border transition-all duration-200 flex items-center justify-center gap-2 font-bold
                      ${previewType === 'SELL'
                        ? 'bg-brand-green text-white border-brand-green shadow-lg shadow-brand-green/20 scale-[1.02]'
                        : 'bg-app-bg border-app-border text-slate-400 hover:border-slate-500'
                      }`}
                  >
                     <TrendingUp size={18} className="rotate-180" />
                     卖出预估
                  </button>
               </div>
            </div>

            {/* 3. Trade History */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-400 pl-1">
                 <History size={16} />
                 <h3 className="font-medium text-sm">成交记录</h3>
              </div>
              <TradeList trades={trades} onDelete={deleteTrade} />
            </div>

            {/* 4. AI Analysis */}
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
                   输入价格和数量后，点击分析按钮获取基于当前持仓的操作建议。
                 </div>
               )}
            </div>

          </div>

          {/* RIGHT COLUMN: Real-time Preview */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-app-card border border-brand-yellow rounded-xl overflow-hidden shadow-lg sticky top-6">
              <div className="bg-brand-yellow px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="text-slate-900" size={20} />
                  <h2 className="text-slate-900 font-bold text-lg">
                    {previewType === 'BUY' ? '买入后预估' : '卖出后预估'}
                  </h2>
                </div>
              </div>

              <div className="p-6 space-y-8 flex-1 flex flex-col">
                {/* Main Metric */}
                <div>
                   <p className="text-slate-400 text-sm mb-1">成交后平均成本</p>
                   <div className="flex items-baseline gap-2">
                     <span className="text-4xl lg:text-5xl font-bold text-white tracking-tight">
                        {simulation.newAvgCost.toFixed(2)}
                     </span>
                     <span className="text-slate-500 font-medium">CNY</span>
                   </div>
                   {currentPosition.grams > 0 && inputs.grams && previewType === 'BUY' ? (
                     <div className="flex items-center gap-2 mt-2">
                        <span className={`text-sm font-bold ${simulation.costDifference < 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                          {simulation.costDifference > 0 ? '+' : ''}{simulation.costDifference.toFixed(2)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          (较当前持仓成本 {simulation.costDifference < 0 ? '下降' : '上升'})
                        </span>
                     </div>
                   ) : previewType === 'SELL' && (
                     <p className="text-xs text-slate-500 mt-2">卖出不影响剩余持仓成本</p>
                   )}
                </div>

                {/* Secondary Metrics */}
                <div className="grid grid-cols-2 gap-6">
                   <div>
                      <p className="text-slate-400 text-sm mb-1">预计总持仓</p>
                      <div className="flex items-baseline gap-1">
                         <span className="text-2xl font-bold text-white">{simulation.newTotalGrams.toFixed(2)}</span>
                         <span className="text-xs text-slate-500">克</span>
                      </div>
                   </div>
                   <div>
                      <p className="text-slate-400 text-sm mb-1">本次交易额</p>
                      <div className="flex items-baseline gap-1">
                         <span className="text-2xl font-bold text-white">
                           {((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}
                         </span>
                         <span className="text-xs text-slate-500">¥</span>
                      </div>
                   </div>
                </div>

                {/* Financial List */}
                <div className="bg-app-input rounded-lg p-4 space-y-3">
                   <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-sm">持仓总投入 (估)</span>
                      <span className="text-white font-mono">¥ {simulation.totalInvestment.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                   </div>
                   {previewType === 'SELL' && simulation.projectedPnL !== undefined && (
                     <div className="flex justify-between items-center border-t border-app-border pt-3">
                        <span className="text-slate-400 text-sm">预计本次盈亏</span>
                        <span className={`font-mono font-bold ${simulation.projectedPnL >= 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                          {simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}
                        </span>
                     </div>
                   )}
                </div>

                {/* Chart */}
                {/* For Sell: we compare AvgCost vs SellPrice. For Buy: AvgCost vs NewAvgCost */}
                {inputs.grams && inputs.price && (
                  <div className="pt-2">
                    <p className="text-xs text-slate-500 mb-3 flex justify-between">
                      <span>{previewType === 'BUY' ? '成本变化对比' : '盈亏参考'}</span>
                    </p>
                    <CostChart 
                      currentAvg={currentPosition.avgCost} 
                      newAvg={previewType === 'BUY' ? simulation.newAvgCost : parseFloat(inputs.price)} 
                      orderType={previewType} 
                    />
                  </div>
                )}
                
                {/* Execute Button */}
                <div className="pt-4 mt-auto">
                   <button
                    onClick={executeTrade}
                    disabled={!inputs.price || !inputs.grams}
                    className="w-full py-3.5 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed bg-brand-yellow text-slate-900 hover:bg-[#fdd835] shadow-lg shadow-brand-yellow/20"
                   >
                     <CheckCircle2 size={20} />
                     成交
                   </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
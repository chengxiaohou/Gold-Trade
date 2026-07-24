

import React, { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, CheckCircle2, Sliders, Cloud, Touchpad, Columns3 } from 'lucide-react';
import { GithubConfig, AppSettings, StockSettings, DividendRateColorRange } from '../types';
import { validateConnection } from '../services/githubService';

// All available columns in gold trade list
const GOLD_COLUMNS = [
  { key: 'tag', label: '标签' },
  { key: 'price', label: '单价' },
  { key: 'grams', label: '数量' },
  { key: 'tradeTotal', label: '交易额' },
  { key: 'holdingTotal', label: '持仓总额' },
  { key: 'historicalAvg', label: '回本价/均价' },
  { key: 'absChange', label: '价差浮动' },
  { key: 'avgChange', label: '价差百分比' },
  { key: 'pnl', label: '盈亏' },
];

// All available columns in stock dividend list
const STOCK_COLUMNS = [
  { key: 'code', label: '股票代码' },
  { key: 'name', label: '股票名称' },
  { key: 'price', label: '实时价格' },
  { key: 'changePercent', label: '涨跌幅' },
  { key: 'dividend2024', label: '分红(2024)' },
  { key: 'dividend2025', label: '分红(2025)' },
  { key: 'dividendRate2025', label: '股息率(2025)' },
  { key: 'dividendRates', label: '股息率对应股价' },
];

interface CloudSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  githubConfig: GithubConfig;
  appSettings: AppSettings;
  stockSettings?: StockSettings;
  currentPage: 'gold' | 'stock';
  onSave: (githubConfig: GithubConfig, appSettings: AppSettings, stockSettings?: StockSettings) => void;
  initialTab?: 'general' | 'cloud';
}

export const CloudSettingsModal: React.FC<CloudSettingsModalProps> = ({
  isOpen,
  onClose,
  githubConfig,
  appSettings,
  stockSettings,
  currentPage,
  onSave,
  initialTab = 'general',
}) => {
  // Config States
  const [token, setToken] = useState(githubConfig.token);
  const [gistId, setGistId] = useState(githubConfig.gistId);
  const [priceStep, setPriceStep] = useState(appSettings.priceStep.toString());
  const [gramsStep, setGramsStep] = useState(appSettings.gramsStep.toString());
  const [touchMode, setTouchMode] = useState(appSettings.touchMode ?? true);
  const [priceDisplayMode, setPriceDisplayMode] = useState<'breakEven' | 'avgCost' | 'both'>(appSettings.priceDisplayMode || 'both');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (currentPage === 'gold') {
      return appSettings.visibleColumns || GOLD_COLUMNS.filter(c => c.key !== 'absChange' && c.key !== 'avgChange').map(c => c.key);
    } else {
      return stockSettings?.visibleColumns || STOCK_COLUMNS.map(c => c.key);
    }
  });
  const [buyTaxFee, setBuyTaxFee] = useState((appSettings.buyTaxFee ?? 5).toString());
  const [sellTaxFee, setSellTaxFee] = useState((appSettings.sellTaxFee ?? 5).toString());
  const [dividendRateColumns, setDividendRateColumns] = useState<string[]>(stockSettings?.dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%']);
  const [newDividendRate, setNewDividendRate] = useState('');
  const [editingDividendRateIndex, setEditingDividendRateIndex] = useState<number | null>(null);
  const [dividendRateColorRanges, setDividendRateColorRanges] = useState<DividendRateColorRange[]>(stockSettings?.dividendRateColorRanges || [
    { min: 3, max: 4, color: 'red' },
    { min: 4.5, max: 5.5, color: 'gray' },
    { min: 6, max: 7, color: 'green' }
  ]);
  const [newRange, setNewRange] = useState({ min: '', max: '', color: 'gray' });
  const [editingRangeIndex, setEditingRangeIndex] = useState<number | null>(null);
  const [maxRows, setMaxRows] = useState<number>(stockSettings?.maxRows || 10);

  const COLOR_OPTIONS = [
    { key: 'gray', label: '灰色', bg: 'bg-gray-500/10', text: 'text-gray-500', border: 'border-gray-500/20' },
    { key: 'indigo', label: '默认', bg: 'bg-indigo-500/10', text: 'text-indigo-500', border: 'border-indigo-500/20' },
    { key: 'red', label: '红色', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' },
    { key: 'green', label: '绿色', bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20' },
    { key: 'yellow', label: '黄色', bg: 'bg-[var(--soft-yellow-bg)]', text: 'text-brand-softYellow', border: 'border-[var(--soft-yellow-border)]' },
    { key: 'blue', label: '蓝色', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' },
    { key: 'orange', label: '橙色', bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/20' },
    { key: 'pink', label: '粉色', bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/20' },
  ];

  const [activeTab, setActiveTab] = useState<'general' | 'cloud'>(initialTab);
  const [isVerifying, setIsVerifying] = useState(false);
  const [logState, setLogState] = useState<{ type: 'success' | 'error', lines: string[] } | null>(null);
  
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      console.log('初始化状态 - stockSettings:', stockSettings);
      console.log('初始化状态 - localStorage中的值:', localStorage.getItem('stock_dividend_settings'));
      setToken(githubConfig.token);
      setGistId(githubConfig.gistId);
      setPriceStep(appSettings.priceStep.toString());
      setGramsStep(appSettings.gramsStep.toString());
      setTouchMode(appSettings.touchMode ?? true);
      setPriceDisplayMode(appSettings.priceDisplayMode || 'both');
      if (currentPage === 'stock') {
        setVisibleColumns(stockSettings?.visibleColumns || STOCK_COLUMNS.map(c => c.key));
        setDividendRateColumns(stockSettings?.dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%']);
        console.log('设置 dividendRateColorRanges:', stockSettings?.dividendRateColorRanges);
        setDividendRateColorRanges(stockSettings?.dividendRateColorRanges || [
          { min: 0, max: 4.5, color: 'red' },
          { min: 4.5, max: 5.5, color: 'yellow' },
          { min: 5.5, max: 100, color: 'green' }
        ]);
      } else {
        setVisibleColumns(appSettings.visibleColumns || GOLD_COLUMNS.filter(c => c.key !== 'absChange' && c.key !== 'avgChange').map(c => c.key));
      }
      setBuyTaxFee((appSettings.buyTaxFee ?? 5).toString());
      setSellTaxFee((appSettings.sellTaxFee ?? 5).toString());
      setIsVerifying(false);
      setLogState(null);
      setEditingRangeIndex(null);
      setNewRange({ min: '', max: '', color: 'gray' });
      setActiveTab(initialTab);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, githubConfig, appSettings, stockSettings, currentPage, initialTab]);

  const handleSave = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLogState(null);

    // Prepare App Settings (only for gold page or cloud settings)
    const newPriceStep = parseFloat(priceStep);
    const newGramsStep = parseFloat(gramsStep);
    
    if (currentPage === 'gold' && (isNaN(newPriceStep) || newPriceStep <= 0 || isNaN(newGramsStep) || newGramsStep <= 0)) {
       setLogState({
        type: 'error',
        lines: ["⚠️ 步长必须为有效的正数"]
       });
       return;
    }
    
    const newAppSettings: AppSettings = {
        priceStep: newPriceStep,
        gramsStep: newGramsStep,
        tagColors: appSettings.tagColors, // Preserve existing tag colors
        touchMode: touchMode,
        priceDisplayMode: priceDisplayMode,
        totalCapital: appSettings.totalCapital, // Preserve existing total capital
        visibleColumns: currentPage === 'gold' ? visibleColumns : appSettings.visibleColumns,
        buyTaxFee: parseFloat(buyTaxFee) || 5,
        sellTaxFee: parseFloat(sellTaxFee) || 5
    };

    const newStockSettings: StockSettings = {
      visibleColumns: (currentPage === 'stock' ? visibleColumns : stockSettings?.visibleColumns) || STOCK_COLUMNS.map(c => c.key),
      dividendRateColumns: dividendRateColumns || stockSettings?.dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'],
      dividendRateColorRanges: dividendRateColorRanges || stockSettings?.dividendRateColorRanges || [
        { min: 3, max: 4, color: 'red' },
        { min: 4.5, max: 5.5, color: 'gray' },
        { min: 6, max: 7, color: 'green' }
      ],
      maxRows: maxRows || stockSettings?.maxRows || 10,
    };

    // If Cloud tab is not active and no changes to cloud config, just save app settings
    const cleanToken = token.trim();
    const cleanGistId = gistId.trim();

    if (!cleanToken) {
       onSave({ token: '', gistId: '' }, newAppSettings, newStockSettings);
       onClose();
       return;
    }

    setIsVerifying(true);
    
    try {
      const username = await validateConnection(cleanToken, cleanGistId || undefined);
      
      const newGithubConfig = { token: cleanToken, gistId: cleanGistId };
      onSave(newGithubConfig, newAppSettings, newStockSettings);
      
      const isNewGist = !cleanGistId;

      setLogState({
        type: 'success',
        lines: [
          `[System] Connecting to GitHub... OK`,
          `[Auth] User: ${username}`,
          isNewGist 
            ? `[Gist] 暂无 ID (将在首次上传时自动创建)`
            : `[Gist] 已验证现有 Gist ID`,
          `--------------------------------`,
          `✅ 设置已保存！`
        ]
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "未知错误";
      setLogState({
        type: 'error',
        lines: [
          `[System] Connection Failed`,
          `[Error] ${errorMsg}`,
          `--------------------------------`,
          `❌ 请检查 Token 是否正确，或网络是否通畅。`
        ]
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isVerifying) {
      saveGeneralSettings();
      onClose();
    }
  };

  const handleClose = () => {
    saveGeneralSettings();
    onClose();
  };

  const saveGeneralSettings = () => {
    const newPriceStep = parseFloat(priceStep);
    const newGramsStep = parseFloat(gramsStep);
    
    if (currentPage === 'gold' && (isNaN(newPriceStep) || newPriceStep <= 0 || isNaN(newGramsStep) || newGramsStep <= 0)) {
      return;
    }
    
    const newAppSettings: AppSettings = {
      priceStep: newPriceStep,
      gramsStep: newGramsStep,
      tagColors: appSettings.tagColors,
      touchMode: touchMode,
      priceDisplayMode: priceDisplayMode,
      totalCapital: appSettings.totalCapital,
      visibleColumns: currentPage === 'gold' ? visibleColumns : appSettings.visibleColumns,
      buyTaxFee: parseFloat(buyTaxFee) || 5,
      sellTaxFee: parseFloat(sellTaxFee) || 5
    };
    
    const newStockSettings: StockSettings = {
      visibleColumns: currentPage === 'stock' ? visibleColumns : stockSettings?.visibleColumns,
      dividendRateColumns: currentPage === 'stock' ? dividendRateColumns : stockSettings?.dividendRateColumns,
      dividendRateColorRanges: currentPage === 'stock' ? dividendRateColorRanges : stockSettings?.dividendRateColorRanges,
      maxRows: currentPage === 'stock' ? maxRows : stockSettings?.maxRows,
    };
    
    onSave({ token: '', gistId: '' }, newAppSettings, newStockSettings);
  };

  if (!isOpen) return null;

  const isSuccess = logState?.type === 'success';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-app-card border border-app-border rounded-xl w-full max-w-md shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()} 
      >
        {/* Header - Indigo theme */}
        <div className="bg-indigo-500/10 p-4 border-b border-app-border flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 text-indigo-400">
            <Sliders size={20} />
            <h3 className="font-bold text-lg">系统设置</h3>
          </div>
          <button 
            type="button"
            onClick={handleClose} 
            disabled={isVerifying}
            className="text-app-subtext hover:text-app-text transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Nav - Indigo theme */}
        <div className="flex border-b border-app-border relative">
          <button 
             onClick={() => setActiveTab('general')}
             className={`flex-1 py-3 text-sm font-bold transition-colors relative ${activeTab === 'general' ? 'text-indigo-400 bg-indigo-500/5' : 'text-app-subtext hover:text-app-text'}`}
          >
            通用设置
            {activeTab === 'general' && (
              <div className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-indigo-500 animate-in fade-in duration-200" />
            )}
          </button>
          <button 
             onClick={() => setActiveTab('cloud')}
             className={`flex-1 py-3 text-sm font-bold transition-colors relative ${activeTab === 'cloud' ? 'text-indigo-400 bg-indigo-500/5' : 'text-app-subtext hover:text-app-text'}`}
          >
             <span className="flex items-center justify-center gap-2">
               <Cloud size={14} /> 云端同步
             </span>
             {activeTab === 'cloud' && (
              <div className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-indigo-500 animate-in fade-in duration-200" />
            )}
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="p-6 overflow-y-auto">
          <form className="space-y-6">
            
            {/* Tab: General */}
            {activeTab === 'general' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-200">
                 {currentPage === 'gold' ? (
                   <>
                     {/* Column Visibility Settings - moved to top */}
                     <div className="pt-2 border-t border-app-border">
                        <div className="flex flex-col gap-2">
                           <span className="text-sm font-medium text-app-text flex items-center gap-2">
                              <Columns3 size={16} className="text-indigo-400"/> 成交记录列显示
                           </span>
                           <span className="text-xs text-app-subtext">
                              勾选需要在成交记录表格中显示的列。
                           </span>
                           <div className="grid grid-cols-2 gap-2 mt-2">
                             {GOLD_COLUMNS.map(col => (
                               <button
                                 key={col.key}
                                 type="button"
                                 onClick={() => {
                                   if (visibleColumns.includes(col.key)) {
                                     // Don't allow unchecking all columns
                                     if (visibleColumns.length > 1) {
                                       setVisibleColumns(visibleColumns.filter(k => k !== col.key));
                                     }
                                   } else {
                                     setVisibleColumns([...visibleColumns, col.key]);
                                   }
                                 }}
                                 className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                                   visibleColumns.includes(col.key)
                                     ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/50'
                                     : 'bg-app-input text-app-subtext border border-app-border hover:border-app-text/30'
                                 }`}
                               >
                                 <span className={`w-4 h-4 rounded flex items-center justify-center border ${
                                   visibleColumns.includes(col.key)
                                     ? 'bg-indigo-500 border-indigo-500 text-white'
                                     : 'border-app-border'
                                 }`}>
                                   {visibleColumns.includes(col.key) && (
                                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                       <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                     </svg>
                                   )}
                                 </span>
                                 {col.label}
                               </button>
                             ))}
                           </div>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <label className="text-sm font-medium text-app-text block">
                          价格调整步长 (元/克)
                        </label>
                        <input 
                          type="number" 
                          value={priceStep}
                          onChange={(e) => setPriceStep(e.target.value)}
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-app-subtext">控制鼠标滚轮或箭头按钮点击时的增减数值。</p>
                     </div>

                     <div className="space-y-2">
                        <label className="text-sm font-medium text-app-text block">
                          数量调整步长 (克)
                        </label>
                        <input 
                          type="number" 
                          value={gramsStep}
                          onChange={(e) => setGramsStep(e.target.value)}
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                        />
                     </div>
                     
                     <div className="space-y-2">
                        <label className="text-sm font-medium text-app-text block">
                          价格显示模式
                        </label>
                        <select
                          value={priceDisplayMode}
                          onChange={(e) => setPriceDisplayMode(e.target.value as 'breakEven' | 'avgCost' | 'both')}
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-sm"
                        >
                          <option value="breakEven">仅看回本价</option>
                          <option value="avgCost">仅看持仓均价</option>
                          <option value="both">同时显示</option>
                        </select>
                     </div>
                     
                     <div className="space-y-2">
                        <label className="text-sm font-medium text-app-text block">
                          买入税费 (元/笔)
                        </label>
                        <input 
                          type="number" 
                          value={buyTaxFee}
                          onChange={(e) => setBuyTaxFee(e.target.value)}
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-app-subtext">每笔买入交易的税费，不纳入盈亏计算。</p>
                     </div>
                     
                     <div className="space-y-2">
                        <label className="text-sm font-medium text-app-text block">
                          卖出税费 (元/笔)
                        </label>
                        <input 
                          type="number" 
                          value={sellTaxFee}
                          onChange={(e) => setSellTaxFee(e.target.value)}
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-app-subtext">每笔卖出交易的税费，不纳入盈亏计算。</p>
                     </div>
                     
                     <div className="pt-2 border-t border-app-border">
                        <div className="flex items-center justify-between">
                           <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium text-app-text flex items-center gap-2">
                                 <Touchpad size={16} className="text-indigo-400"/> 触屏调节模式
                              </span>
                              <span className="text-xs text-app-subtext max-w-[240px]">
                                 开启后，手指在输入框内上下滑动即可模拟滚轮调节数值（推荐手机端使用）。
                              </span>
                           </div>
                           <button
                             type="button"
                             onClick={() => setTouchMode(!touchMode)}
                             className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-app-bg ${touchMode ? 'bg-indigo-600' : 'bg-app-input border border-app-border'}`}
                           >
                             <span
                               className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${touchMode ? 'translate-x-6' : 'translate-x-1'}`}
                             />
                           </button>
                        </div>
                     </div>
                   </>
                 ) : (
                   <>
                     {/* Stock Column Visibility Settings */}
                     <div className="pt-2 border-t border-app-border">
                        <div className="flex flex-col gap-2">
                           <span className="text-sm font-medium text-app-text flex items-center gap-2">
                              <Columns3 size={16} className="text-indigo-400"/> 股票列表列显示
                           </span>
                           <span className="text-xs text-app-subtext">
                              勾选需要在股票列表表格中显示的列。
                           </span>
                           <div className="grid grid-cols-2 gap-2 mt-2">
                             {STOCK_COLUMNS.map(col => (
                               <button
                                 key={col.key}
                                 type="button"
                                 onClick={() => {
                                   if (visibleColumns.includes(col.key)) {
                                     if (visibleColumns.length > 1) {
                                       setVisibleColumns(visibleColumns.filter(k => k !== col.key));
                                     }
                                   } else {
                                     setVisibleColumns([...visibleColumns, col.key]);
                                   }
                                 }}
                                 className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                                   visibleColumns.includes(col.key)
                                     ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/50'
                                     : 'bg-app-input text-app-subtext border border-app-border hover:border-app-text/30'
                                 }`}
                               >
                                 <span className={`w-4 h-4 rounded flex items-center justify-center border ${
                                   visibleColumns.includes(col.key)
                                     ? 'bg-indigo-500 border-indigo-500 text-white'
                                     : 'border-app-border'
                                 }`}>
                                   {visibleColumns.includes(col.key) && (
                                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                       <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                     </svg>
                                   )}
                                 </span>
                                 {col.label}
                               </button>
                             ))}
                           </div>
                        </div>
                     </div>
                     <div className="pt-4 border-t border-app-border space-y-4">
                        <div className="space-y-2">
                           <label className="text-sm font-medium text-app-text block">
                              股息率对应股价列
                           </label>
                           <p className="text-xs text-app-subtext">
                              配置股息率对应股价的列，可以增减列数。
                           </p>
                           <div className="flex gap-2">
                             <input
                               type="number"
                               value={newDividendRate}
                               onChange={(e) => {
                                 const val = parseFloat(e.target.value);
                                 if (isNaN(val) || val >= 0 && val <= 100) {
                                   setNewDividendRate(e.target.value);
                                 }
                               }}
                               placeholder="股息率"
                               className="w-14 bg-app-input border border-white/5 rounded-lg px-2 py-1.5 text-xs text-app-text outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all [appearance:textfield]"
                               min="0"
                               max="100"
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   const value = parseFloat(newDividendRate);
                                   if (!isNaN(value) && value >= 0 && value <= 100) {
                                     const formattedValue = `${value}%`;
                                     if (editingDividendRateIndex !== null) {
                                       const newColumns = [...dividendRateColumns];
                                       newColumns[editingDividendRateIndex] = formattedValue;
                                       setDividendRateColumns(newColumns.sort((a, b) => parseFloat(a) - parseFloat(b)));
                                       setEditingDividendRateIndex(null);
                                     } else if (!dividendRateColumns.includes(formattedValue)) {
                                       setDividendRateColumns([...dividendRateColumns, formattedValue].sort((a, b) => parseFloat(a) - parseFloat(b)));
                                     }
                                     setNewDividendRate('');
                                   }
                                 }
                               }}
                             />
                             <button
                               type="button"
                               onClick={() => {
                                 const value = parseFloat(newDividendRate);
                                 if (!isNaN(value) && value >= 0 && value <= 100) {
                                   const formattedValue = `${value}%`;
                                   if (editingDividendRateIndex !== null) {
                                     const newColumns = [...dividendRateColumns];
                                     newColumns[editingDividendRateIndex] = formattedValue;
                                     setDividendRateColumns(newColumns.sort((a, b) => parseFloat(a) - parseFloat(b)));
                                     setEditingDividendRateIndex(null);
                                   } else if (!dividendRateColumns.includes(formattedValue)) {
                                     setDividendRateColumns([...dividendRateColumns, formattedValue].sort((a, b) => parseFloat(a) - parseFloat(b)));
                                   }
                                   setNewDividendRate('');
                                 }
                               }}
                               className="px-3 py-1.5 bg-app-input text-app-text border border-white/5 rounded-lg text-xs font-semibold hover:bg-app-card hover:border-app-text/50 transition-colors"
                             >
                               {editingDividendRateIndex !== null ? '确认' : '添加'}
                             </button>
                           </div>
                           <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5 mt-2">
                             {dividendRateColumns.map((rate, index) => (
                               <button
                                 type="button"
                                 key={rate}
                                 onClick={() => {
                                   setNewDividendRate(rate);
                                   setEditingDividendRateIndex(index);
                                 }}
                                 className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium min-w-[40px] border transition-all bg-app-input text-app-text border-app-border hover:opacity-80 ${editingDividendRateIndex === index ? 'ring-1 ring-indigo-500/50' : ''}`}
                               >
                                 {rate}
                                 <button
                                   type="button"
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     if (dividendRateColumns.length > 1) {
                                       setDividendRateColumns(dividendRateColumns.filter(r => r !== rate));
                                     }
                                   }}
                                   className="ml-1 opacity-0 hover:opacity-100 hover:text-red-400 transition-all"
                                 >
                                   <X size={10} />
                                 </button>
                               </button>
                             ))}
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-sm font-medium text-app-text block">
                              股息率颜色区间
                           </label>
                           <p className="text-xs text-app-subtext">
                              根据股息率范围显示不同颜色，匹配的第一个区间生效。
                           </p>
                           <div className="flex items-center gap-2">
                             <input
                               type="number"
                               value={newRange.min}
                               onChange={(e) => setNewRange(prev => ({ ...prev, min: e.target.value }))}
                               placeholder="最小"
                               className="w-14 bg-app-input border border-white/5 rounded-lg px-2 py-1.5 text-xs text-app-text outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all [appearance:textfield]"
                               step="0.1"
                             />
                             <span className="text-app-subtext text-xs">-</span>
                             <input
                               type="number"
                               value={newRange.max}
                               onChange={(e) => setNewRange(prev => ({ ...prev, max: e.target.value }))}
                               placeholder="最大"
                               className="w-14 bg-app-input border border-white/5 rounded-lg px-2 py-1.5 text-xs text-app-text outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all [appearance:textfield]"
                               step="0.1"
                             />
                             <button
                               type="button"
                               onClick={() => {
                                 const min = parseFloat(newRange.min);
                                 const max = parseFloat(newRange.max);
                                 if (!isNaN(min) && !isNaN(max) && min <= max) {
                                   if (editingRangeIndex !== null) {
                                     const updated = [...dividendRateColorRanges];
                                     updated[editingRangeIndex] = { min, max, color: newRange.color };
                                     
                                     // 联动修改相邻区间
                                     // 修改左边区间的 max
                                     if (editingRangeIndex > 0) {
                                       updated[editingRangeIndex - 1] = {
                                         ...updated[editingRangeIndex - 1],
                                         max: min
                                       };
                                     }
                                     // 修改右边区间的 min
                                     if (editingRangeIndex < updated.length - 1) {
                                       updated[editingRangeIndex + 1] = {
                                         ...updated[editingRangeIndex + 1],
                                         min: max
                                       };
                                     }
                                     
                                     setDividendRateColorRanges(updated);
                                   } else {
                                     setDividendRateColorRanges([...dividendRateColorRanges, { min, max, color: newRange.color }]);
                                   }
                                   setEditingRangeIndex(null);
                                   setNewRange({ min: '', max: '', color: 'gray' });
                                 }
                               }}
                               className="px-3 py-1.5 bg-app-input text-app-text border border-white/5 rounded-lg text-xs font-semibold hover:bg-app-card hover:border-app-text/50 transition-colors"
                             >
                               {editingRangeIndex !== null ? '确认' : '添加'}
                             </button>
                           </div>
                           <div className="flex flex-wrap gap-2">
                             {COLOR_OPTIONS.map(color => (
                               <button
                                 type="button"
                                 key={color.key}
                                 onClick={() => setNewRange(prev => ({ ...prev, color: color.key }))}
                                 className={`w-6 h-6 rounded-full border transition-all flex items-center justify-center ${color.bg} ${color.border} ${
                                   newRange.color === color.key ? 'opacity-100 scale-100' : 'hover:scale-105 opacity-60 hover:opacity-100'
                                 }`}
                                 title={color.label}
                               >
                                 {newRange.color === color.key && <div className={`w-2 h-2 rounded-full ${color.text} bg-current shadow-sm`} />}
                               </button>
                             ))}
                           </div>
                           <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5 mt-2">
                             {dividendRateColorRanges.map((range, index) => {
                               const colorStyle = COLOR_OPTIONS.find(c => c.key === range.color) || COLOR_OPTIONS[0];
                               return (
                                 <button
                                   type="button"
                                   key={index}
                                   onClick={() => {
                                     setNewRange({ min: range.min.toString(), max: range.max.toString(), color: range.color });
                                     setEditingRangeIndex(index);
                                   }}
                                   className={`inline-flex items-center justify-center px-1.5 h-[22px] rounded text-[10px] font-medium min-w-[60px] border transition-all ${colorStyle.bg} ${colorStyle.border} ${colorStyle.text} hover:opacity-80 ${editingRangeIndex === index ? 'ring-1 ring-indigo-500/50' : ''}`}
                                 >
                                   {range.min}-{range.max}%
                                   <button
                                     type="button"
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       if (dividendRateColorRanges.length > 1) {
                                         setDividendRateColorRanges(dividendRateColorRanges.filter((_, i) => i !== index));
                                         if (editingRangeIndex === index) {
                                           setEditingRangeIndex(null);
                                           setNewRange({ min: '', max: '', color: 'gray' });
                                         }
                                       }
                                     }}
                                     className="ml-1 opacity-0 hover:opacity-100 hover:text-red-400 transition-all"
                                   >
                                     <X size={10} />
                                   </button>
                                 </button>
                               );
                             })}
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-sm font-medium text-app-text block">
                              列表最大行数
                           </label>
                           <p className="text-xs text-app-subtext">
                              设置表格内部滚动时显示的最大行数，设为0则不限制高度。
                           </p>
                           <input
                             type="number"
                             value={maxRows}
                             onChange={(e) => {
                               const val = parseInt(e.target.value) || 0;
                               if (val >= 0) {
                                 setMaxRows(val);
                               }
                             }}
                             className="w-20 bg-app-input border border-white/5 rounded-lg px-2 py-1.5 text-xs text-app-text outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all [appearance:textfield]"
                             min="0"
                           />
                        </div>
                     </div>
                   </>
                 )}
              </div>
            )}

            {/* Tab: Cloud */}
            {activeTab === 'cloud' && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-200">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-app-text block">
                    Personal Access Token (PAT)
                  </label>
                  <input 
                    type="text" 
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    disabled={isVerifying}
                    className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm disabled:opacity-50"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                  />
                  <p className="text-xs text-app-subtext leading-relaxed">
                    需要拥有 <code>gist</code> 权限的 Token。
                    <a 
                      href="https://github.com/settings/tokens/new?scopes=gist&description=GoldCostPro" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline ml-1 inline-flex items-center gap-0.5"
                    >
                      点击生成 <ExternalLink size={10} />
                    </a>
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-app-text block">
                    Gist ID (可选)
                  </label>
                  <input 
                    type="text" 
                    value={gistId}
                    onChange={(e) => setGistId(e.target.value)}
                    placeholder="首次保存自动生成"
                    disabled={isVerifying}
                    className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-app-text focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-sm disabled:opacity-50"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
              </div>
            )}

            {/* Log Display Area (Global) */}
            {logState && (
              <div className={`rounded-lg p-3 text-xs font-mono border animate-in fade-in slide-in-from-top-2 ${
                logState.type === 'success' 
                  ? 'bg-green-500/10 border-green-500/30 text-green-200' 
                  : 'bg-red-500/10 border-red-500/30 text-red-200'
              }`}>
                {logState.lines.map((line, i) => (
                  <div key={i} className="mb-0.5 last:mb-0 break-all">
                    {line}
                  </div>
                ))}
              </div>
            )}

            {/* Save button only for Cloud tab */}
            {activeTab === 'cloud' && (
              <div className="pt-2">
                {isSuccess ? (
                  <button 
                    type="button" 
                    onClick={onClose}
                    className="w-full font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 bg-brand-green text-white hover:bg-brand-green/90 shadow-lg shadow-brand-green/20"
                  >
                    <CheckCircle2 size={18} />
                    完成并关闭
                  </button>
                ) : (
                  <button 
                    type="button" 
                    onClick={handleSave}
                    disabled={isVerifying}
                    className={`w-full font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 touch-manipulation
                      ${isVerifying 
                        ? 'bg-slate-700 text-slate-400 cursor-wait' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-500'
                      }`}
                  >
                    {isVerifying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                        验证连接中...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={18} />
                        保存设置
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          
          </form>
        </div>
      </div>
    </div>
  );
};
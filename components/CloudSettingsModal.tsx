

import React, { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, CheckCircle2, Sliders, Cloud, Touchpad, Columns3 } from 'lucide-react';
import { GithubConfig, AppSettings } from '../types';
import { validateConnection } from '../services/githubService';

// All available columns in trade list
const ALL_COLUMNS = [
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

interface CloudSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  githubConfig: GithubConfig;
  appSettings: AppSettings;
  onSave: (githubConfig: GithubConfig, appSettings: AppSettings) => void;
  initialTab?: 'general' | 'cloud';
}

export const CloudSettingsModal: React.FC<CloudSettingsModalProps> = ({
  isOpen,
  onClose,
  githubConfig,
  appSettings,
  onSave,
  initialTab = 'general',
}) => {
  // Config States
  const [token, setToken] = useState(githubConfig.token);
  const [gistId, setGistId] = useState(githubConfig.gistId);
  const [priceStep, setPriceStep] = useState(appSettings.priceStep.toString());
  const [gramsStep, setGramsStep] = useState(appSettings.gramsStep.toString());
  const [touchMode, setTouchMode] = useState(appSettings.touchMode ?? true);
  const [priceDisplayMode, setPriceDisplayMode] = useState<'breakEven' | 'avgCost' | 'both'>(appSettings.priceDisplayMode || 'breakEven');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => 
    appSettings.visibleColumns || ALL_COLUMNS.map(c => c.key)
  );

  const [activeTab, setActiveTab] = useState<'general' | 'cloud'>(initialTab);
  const [isVerifying, setIsVerifying] = useState(false);
  const [logState, setLogState] = useState<{ type: 'success' | 'error', lines: string[] } | null>(null);
  
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setToken(githubConfig.token);
      setGistId(githubConfig.gistId);
      setPriceStep(appSettings.priceStep.toString());
      setGramsStep(appSettings.gramsStep.toString());
      setTouchMode(appSettings.touchMode ?? true);
      setPriceDisplayMode(appSettings.priceDisplayMode || 'breakEven');
      setVisibleColumns(appSettings.visibleColumns || ALL_COLUMNS.map(c => c.key));
      setIsVerifying(false);
      setLogState(null);
      // Automatically switch to the requested tab when opening
      setActiveTab(initialTab);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, githubConfig, appSettings, initialTab]);

  const handleSave = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLogState(null);

    // Prepare App Settings
    const newPriceStep = parseFloat(priceStep);
    const newGramsStep = parseFloat(gramsStep);
    
    if (isNaN(newPriceStep) || newPriceStep <= 0 || isNaN(newGramsStep) || newGramsStep <= 0) {
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
        visibleColumns: visibleColumns
    };

    // If Cloud tab is not active and no changes to cloud config, just save app settings
    const cleanToken = token.trim();
    const cleanGistId = gistId.trim();

    if (!cleanToken) {
       // Just save local settings if no token provided (assuming user doesn't want cloud)
       onSave({ token: '', gistId: '' }, newAppSettings);
       onClose();
       return;
    }

    setIsVerifying(true);
    
    try {
      const username = await validateConnection(cleanToken, cleanGistId || undefined);
      
      const newGithubConfig = { token: cleanToken, gistId: cleanGistId };
      onSave(newGithubConfig, newAppSettings);
      
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
    
    if (isNaN(newPriceStep) || newPriceStep <= 0 || isNaN(newGramsStep) || newGramsStep <= 0) {
      return;
    }
    
    const newAppSettings: AppSettings = {
      priceStep: newPriceStep,
      gramsStep: newGramsStep,
      tagColors: appSettings.tagColors,
      touchMode: touchMode,
      priceDisplayMode: priceDisplayMode,
      totalCapital: appSettings.totalCapital,
      visibleColumns: visibleColumns
    };
    
    onSave({ token: '', gistId: '' }, newAppSettings);
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
                         {ALL_COLUMNS.map(col => (
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
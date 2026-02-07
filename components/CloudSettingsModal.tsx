import React, { useState, useEffect, useRef } from 'react';
import { X, ExternalLink, CheckCircle2, Sliders, Cloud } from 'lucide-react';
import { GithubConfig, AppSettings } from '../types';
import { validateConnection } from '../services/githubService';

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
        tagColors: appSettings.tagColors // Preserve existing tag colors
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
      onClose();
    }
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
            onClick={onClose} 
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
          
          </form>
        </div>
      </div>
    </div>
  );
};

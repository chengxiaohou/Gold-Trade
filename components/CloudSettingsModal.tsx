import React, { useState, useEffect, useRef } from 'react';
import { X, Github, ExternalLink, Activity, CheckCircle2 } from 'lucide-react';
import { GithubConfig } from '../types';
import { validateConnection } from '../services/githubService';

interface CloudSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: GithubConfig;
  onSave: (config: GithubConfig) => void;
}

export const CloudSettingsModal: React.FC<CloudSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [token, setToken] = useState(config.token);
  const [gistId, setGistId] = useState(config.gistId);
  const [isVerifying, setIsVerifying] = useState(false);
  const [logState, setLogState] = useState<{ type: 'success' | 'error', lines: string[] } | null>(null);
  
  // Track previous open state to only reset when opening
  const wasOpenRef = useRef(isOpen);

  // Sync internal state ONLY when the modal opens
  useEffect(() => {
    // Check if transitioning from closed (false) to open (true)
    if (isOpen && !wasOpenRef.current) {
      setToken(config.token);
      setGistId(config.gistId);
      setIsVerifying(false);
      setLogState(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, config]);

  const handleSave = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset log
    setLogState(null);

    const cleanToken = token.trim();
    const cleanGistId = gistId.trim();

    if (!cleanToken) {
      setLogState({
        type: 'error',
        lines: ["⚠️ 请填写 Personal Access Token (PAT)"]
      });
      return;
    }

    setIsVerifying(true);
    
    try {
      const username = await validateConnection(cleanToken, cleanGistId || undefined);
      
      // Update parent state
      onSave({ token: cleanToken, gistId: cleanGistId });
      
      const isNewGist = !cleanGistId;

      // Show success log (This will now persist because useEffect won't reset it)
      setLogState({
        type: 'success',
        lines: [
          `[System] Connecting to GitHub... OK`,
          `[Auth] User: ${username}`,
          isNewGist 
            ? `[Gist] 暂无 ID (将在首次上传时自动创建)`
            : `[Gist] 已验证现有 Gist ID`,
          `--------------------------------`,
          isNewGist
            ? `✅ 配置成功！请点击主界面的「上传」按钮来创建云端备份。`
            : `✅ 配置成功！现在可以进行上传或下载操作了。`
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
        {/* Header */}
        <div className="bg-brand-yellow/10 p-4 border-b border-brand-yellow/20 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2 text-brand-yellow">
            <Github size={20} />
            <h3 className="font-bold text-lg">GitHub Gist 同步配置</h3>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isVerifying}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="p-6 overflow-y-auto">
          <form className="space-y-5">
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300 block">
                Personal Access Token (PAT) <span className="text-red-400">*</span>
              </label>
              <input 
                type="text" 
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                disabled={isVerifying}
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow outline-none transition-all font-mono text-sm disabled:opacity-50"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
              />
              <p className="text-xs text-slate-500 leading-relaxed">
                需要拥有 <code>gist</code> 权限的 Token。
                <a 
                  href="https://github.com/settings/tokens/new?scopes=gist&description=GoldCostPro" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-brand-yellow hover:underline ml-1 inline-flex items-center gap-0.5"
                >
                  点击生成 <ExternalLink size={10} />
                </a>
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300 block">
                Gist ID (可选)
              </label>
              <input 
                type="text" 
                value={gistId}
                onChange={(e) => setGistId(e.target.value)}
                placeholder="首次保存自动生成"
                disabled={isVerifying}
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow outline-none transition-all font-mono text-sm disabled:opacity-50"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="text-xs text-slate-500">
                • 首次使用：留空，点击保存后去点「上传」。<br/>
                • 恢复数据：填入已有的 Gist ID。
              </p>
            </div>

            {/* Log Display Area */}
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
                      : 'bg-brand-yellow text-slate-900 hover:bg-[#fdd835]'
                    }`}
                >
                  {isVerifying ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                      验证连接中...
                    </>
                  ) : (
                    <>
                      <Activity size={18} />
                      验证并保存
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
import React, { useState, useEffect } from 'react';
import { X, Github, Save, ExternalLink } from 'lucide-react';
import { GithubConfig } from '../types';

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

  // Sync internal state when prop changes
  useEffect(() => {
    if (isOpen) {
      setToken(config.token);
      setGistId(config.gistId);
    }
  }, [isOpen, config]);

  const handleSave = () => {
    onSave({ token, gistId });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-app-card border border-app-border rounded-xl w-full max-w-md shadow-2xl relative overflow-hidden">
        {/* Header */}
        <div className="bg-brand-yellow/10 p-4 border-b border-brand-yellow/20 flex justify-between items-center">
          <div className="flex items-center gap-2 text-brand-yellow">
            <Github size={20} />
            <h3 className="font-bold text-lg">GitHub Gist 同步配置</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300 block">
              Personal Access Token (PAT) <span className="text-red-400">*</span>
            </label>
            <input 
              type="password" 
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow outline-none transition-all font-mono text-sm"
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
              className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow outline-none transition-all font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              如果已有备份，请填入 Gist ID。留空则会在首次保存时创建新的 Gist。
            </p>
          </div>

          <div className="pt-2">
            <button 
              onClick={handleSave}
              className="w-full bg-brand-yellow text-slate-900 font-bold py-3 rounded-lg hover:bg-[#fdd835] transition-colors flex items-center justify-center gap-2"
            >
              <Save size={18} />
              保存配置
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
};

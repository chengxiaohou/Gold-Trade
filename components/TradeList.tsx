import React from 'react';
import { TradeRecord } from '../types';
import { Trash2 } from 'lucide-react';

interface TradeListProps {
  trades: TradeRecord[];
  onDelete: (id: string) => void;
}

export const TradeList: React.FC<TradeListProps> = ({ trades, onDelete }) => {
  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm italic border border-dashed border-app-border rounded-xl">
        暂无交易记录
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-app-border bg-app-card">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-slate-400 uppercase bg-app-bg border-b border-app-border">
          <tr>
            <th className="px-4 py-3">方向</th>
            <th className="px-4 py-3">价格 (¥)</th>
            <th className="px-4 py-3">数量 (g)</th>
            <th className="px-4 py-3">总额 (¥)</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {trades.map((trade) => (
            <tr key={trade.id} className="hover:bg-app-border/30 transition-colors">
              <td className="px-4 py-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  trade.type === 'BUY' 
                    ? 'bg-brand-red/10 text-brand-red' 
                    : 'bg-brand-green/10 text-brand-green'
                }`}>
                  {trade.type === 'BUY' ? '买入' : '卖出'}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-slate-200">{trade.price.toFixed(2)}</td>
              <td className="px-4 py-3 font-mono text-slate-200">{trade.grams.toFixed(2)}</td>
              <td className="px-4 py-3 font-mono text-slate-300">{(trade.price * trade.grams).toLocaleString('zh-CN', {minimumFractionDigits: 2})}</td>
              <td className="px-4 py-3 text-right">
                <button 
                  onClick={() => onDelete(trade.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// 每日信号标签底部栏 —— 单一实现，列表页价格浮窗与回测图十字线悬浮共用。
// 计算复用 services/signalTagDetail.getSignalTagDetail（→ backtestEngine + tagAnalyzers，
// 与股票标签弹窗完全同源）；chip 配色 = tagAnalyzers 的 CHIP_CLS 单一数据源，
// 每个 chip hover/点击弹出「判定依据」「参考价值」两字段面板。
import React, { useMemo, useState } from 'react';
import type { BollKline } from '../services/bollService';
import type { TagParams } from '../types';
import { getSignalTagDetail, type SignalTagDetail } from '../services/signalTagDetail';

export interface SignalTagsFooterProps {
  win: BollKline[];      // 该日及其之前的前缀 K 线（末根=当日），勿含未来数据
  i: number;             // 当日索引 = win.length-1
  cfg?: TagParams;       // 标签判定参数（需与股票标签弹窗同一份）
  fmt?: (v: number) => string;
  onPin?: () => void;    // 点击 chip 将详情固定时通知宿主（如让父弹窗保持展开）
}

// chip 底座样式与标签弹窗一致（chipBase）
const CHIP_BASE = 'inline-flex items-center justify-center rounded text-[9px] font-medium border px-1 py-px cursor-pointer transition-colors';

export default function SignalTagsFooter({ win, i, cfg, fmt, onPin }: SignalTagsFooterProps) {
  const tags: SignalTagDetail[] = useMemo(
    () => getSignalTagDetail(win, i, cfg, fmt),
    [win, i, cfg, fmt],
  );
  const [pinnedLabel, setPinnedLabel] = useState<string | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  if (tags.length === 0) return null;

  const displayLabel = pinnedLabel ?? hoverLabel;
  const displayTag = displayLabel ? tags.find(t => t.label === displayLabel) : undefined;

  return (
    <div className="border-t border-app-border mt-1 pt-1.5">
      <div className="text-[9px] text-app-subtext mb-1">当日信号</div>
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map(t => {
          const active = displayLabel === t.label;
          return (
            <button
              key={t.label}
              type="button"
              className={`${CHIP_BASE} ${t.cls}${active ? t.sel : ''}`}
              onMouseEnter={() => setHoverLabel(t.label)}
              onMouseLeave={() => setHoverLabel(null)}
              onClick={(e) => {
                e.stopPropagation();
                const next = pinnedLabel === t.label ? null : t.label;
                if (next && onPin) onPin();
                setPinnedLabel(next);
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {displayTag && (
        <div className="mt-1 text-[9px] leading-relaxed bg-app-bg rounded border border-slate-500/20 px-1.5 py-1">
          <div className="text-app-subtext mb-0.5">判定依据</div>
          {displayTag.detail.length > 0 ? (
            <div className="text-app-rowtext break-all">{displayTag.detail.map((l, j) => <div key={j}>{l}</div>)}</div>
          ) : (
            <div className="text-app-rowtext/70">-</div>
          )}
          <div className="text-app-subtext mt-1 mb-0.5">参考价值</div>
          {displayTag.reference ? (
            <div className="text-app-rowtext break-all">{displayTag.reference}</div>
          ) : (
            <div className="text-app-rowtext/70">-</div>
          )}
        </div>
      )}
    </div>
  );
}
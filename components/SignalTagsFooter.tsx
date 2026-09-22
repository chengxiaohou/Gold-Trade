// 每日信号标签底部栏 —— 单一实现，列表页价格浮窗与回测图十字线悬浮共用。
// 计算复用 services/signalTagDetail.getDayTagSet（唯一权威：量能5档 + 价格态 + 形态 + 破位观测态，
// 与股票标签弹窗"近10交易日"当日行完全一致）；chip 配色 = tagAnalyzers 的 CHIP_CLS 单一数据源，
// 每个 chip hover/点击弹出「判定依据」「参考价值」两字段面板。
import React, { useMemo, useState } from 'react';
import type { BollKline } from '../services/bollService';
import type { TagParams, UserTagRule } from '../types';
import { getDayTagSet, type DayTag } from '../services/signalTagDetail';

export interface SignalTagsFooterProps {
  win: BollKline[];      // 该日及其之前的前缀 K 线（末根=当日），勿含未来数据
  i: number;             // 当日索引 = win.length-1
  cfg?: TagParams;       // 标签判定参数（需与股票标签弹窗同一份）
  customTags?: UserTagRule[]; // 用户自定义动态信号标签
  dividendPerShare?: number; // 每股税前派息（元）：供 dividendRate 自定义标签
  fmt?: (v: number) => string;
  onPin?: () => void;    // 点击 chip 将详情固定时通知宿主（如让父弹窗保持展开）
  envChips?: EnvChip[];  // 环境标签（渲染在"当日信号"上方）；chip 已带完整样式
}

// 环境 chip 描述（label + 完整 className，配色由宿主用共享 ENV_CHIP_CLS 生成）
export interface EnvChip { key: string; label: string; cls: string; }

// chip 底座样式与标签弹窗一致（chipBase）
const CHIP_BASE = 'inline-flex items-center justify-center rounded text-[9px] font-medium border px-1 py-px cursor-pointer transition-colors';

export default function SignalTagsFooter({ win, i, cfg, customTags, dividendPerShare, fmt, onPin, envChips }: SignalTagsFooterProps) {
  // 权威接口：与标签弹窗"当日行"同一套；i 恒与 win 末根一致
  const tags: DayTag[] = useMemo(
    () => getDayTagSet(win, cfg, fmt, { customTags, dividendPerShare }),
    [win, cfg, fmt, customTags, dividendPerShare],
  );
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  void i;

  if (tags.length === 0 && (!envChips || envChips.length === 0)) return null;

  const displayKey = pinnedKey ?? hoverKey;
  const displayTag = displayKey ? tags.find(t => t.key === displayKey) : undefined;

  return (
    <div className="border-t border-app-border mt-1 pt-1.5">
      {envChips && envChips.length > 0 && (
        <div className="mb-1.5">
          <div className="text-[9px] text-app-subtext mb-1">环境</div>
          <div className="flex items-center gap-1 flex-wrap">
            {envChips.map(c => <span key={c.key} className={c.cls}>{c.label}</span>)}
          </div>
        </div>
      )}
      <div className="text-[9px] text-app-subtext mb-1">当日信号</div>
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map(t => {
          const active = displayKey === t.key;
          return (
            <button
              key={t.key}
              type="button"
              className={`${CHIP_BASE} ${t.cls}${active ? t.sel : ''}`}
              onMouseEnter={() => setHoverKey(t.key)}
              onMouseLeave={() => setHoverKey(null)}
              onClick={(e) => {
                e.stopPropagation();
                const next = pinnedKey === t.key ? null : t.key;
                if (next && onPin) onPin();
                setPinnedKey(next);
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {displayTag && (
        <div className="mt-1 text-[9px] leading-relaxed">
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
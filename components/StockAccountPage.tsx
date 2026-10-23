import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, Trash2, FileSpreadsheet, Wallet, AlertTriangle, LogOut } from 'lucide-react';
import { parseXlsxFile } from '../services/xlsxLite';
import type { SheetCell } from '../services/xlsxLite';

interface StockAccountPageProps {
  onClose: () => void;
}

interface AccountSheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: SheetCell[][];
  updatedAt: number;
}

const STORAGE_KEY = 'stock_account_sheet_v1';
// 固定挪到表格最右侧的列
const MOVE_TO_END = ['关联板块', '板块涨幅', '组合盈亏', '组合涨幅'];

const reorderColumns = (headers: string[], rows: SheetCell[][]): { headers: string[]; rows: SheetCell[][] } => {
  let order = headers.map((_, i) => i);
  const moved = MOVE_TO_END.map(h => headers.indexOf(h)).filter(i => i >= 0);
  if (moved.length > 0) {
    order = [...order.filter(i => !moved.includes(i)), ...moved];
  }
  // “当日盈亏 / 当日盈亏率”放到“本周盈亏”左侧
  const daily = ['当日盈亏', '当日盈亏率'].map(h => headers.indexOf(h)).filter(i => i >= 0);
  const weekIdx = headers.indexOf('本周盈亏');
  if (daily.length > 0 && weekIdx >= 0) {
    const rest = order.filter(i => !daily.includes(i));
    const pos = rest.indexOf(weekIdx);
    if (pos >= 0) rest.splice(pos, 0, ...daily);
    order = rest;
  }
  return {
    headers: order.map(i => headers[i]),
    rows: rows.map(row => order.map(i => row[i] ?? null)),
  };
};

const toNum = (v: SheetCell | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// 在“持有金额”右侧插入“本金”列：
// 持有金额 = 持有数量 × 最新价，是市值；本金优先用 持有金额 − 持有盈亏 反推，
// 缺失盈亏时退回 持有数量 × 单位成本。
function withPrincipalColumn(headers: string[], rows: SheetCell[][]): { headers: string[]; rows: SheetCell[][] } {
  if (headers.includes('本金')) return { headers, rows };
  const amountIdx = headers.indexOf('持有金额');
  if (amountIdx < 0) return { headers, rows };
  const pnlIdx = headers.indexOf('持有盈亏');
  const qtyIdx = headers.indexOf('持有数量');
  const costIdx = headers.indexOf('单位成本');
  const newHeaders = [...headers.slice(0, amountIdx + 1), '本金', ...headers.slice(amountIdx + 1)];
  const newRows = rows.map(row => {
    const amount = toNum(row[amountIdx]);
    const pnl = pnlIdx >= 0 ? toNum(row[pnlIdx]) : null;
    const qty = qtyIdx >= 0 ? toNum(row[qtyIdx]) : null;
    const cost = costIdx >= 0 ? toNum(row[costIdx]) : null;
    let principal: number | null = null;
    if (amount != null) {
      if (qty === 0 && amount === 0) principal = 0;
      else if (pnl != null) principal = round2(amount - pnl);
      else if (qty != null && cost != null && qty > 0) principal = round2(qty * cost);
      else principal = amount;
    }
    return [...row.slice(0, amountIdx + 1), principal, ...row.slice(amountIdx + 1)];
  });
  return { headers: newHeaders, rows: newRows };
}

const isPercentCol = (h: string) => /率|涨幅|占比|比例/.test(h);
const isPriceCol = (h: string) => /价|成本/.test(h);
const isQtyCol = (h: string) => /数量|天数/.test(h);
const isMoneyCol = (h: string) => /金额|盈亏|本金|费用|市值/.test(h) && !isPercentCol(h);
const canSum = (h: string) => !isPercentCol(h) && /金额|盈亏|本金|费用/.test(h);
const isPnlCol = (h: string) => /盈亏|涨幅|跑赢/.test(h);

const formatCell = (v: SheetCell | undefined, header: string): string => {
  if (v == null || v === '') return '-';
  if (typeof v !== 'number') return String(v);
  if (header === '代码') return String(v);
  if (isPercentCol(header)) {
    const pct = v * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }
  if (isPriceCol(header)) return v.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
  if (isQtyCol(header)) return v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  if (isMoneyCol(header)) return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
};

const cellColor = (v: SheetCell | undefined, header: string): string => {
  if (typeof v !== 'number' || !isPnlCol(header)) return '';
  if (v > 0) return 'text-brand-red';
  if (v < 0) return 'text-brand-green';
  return '';
};

const formatMoney = (n: number | null) =>
  n == null ? '-' : n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const StockAccountPage: React.FC<StockAccountPageProps> = ({ onClose }) => {
  const [sheet, setSheet] = useState<AccountSheet | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AccountSheet;
      if (!Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) return null;
      const ordered = reorderColumns(parsed.headers, parsed.rows);
      return { ...parsed, headers: ordered.headers, rows: ordered.rows };
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      if (sheet) localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, [sheet]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError('仅支持 .xlsx 格式，请在 Excel 中另存为 xlsx 后重试');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseXlsxFile(file);
      const withPrincipal = withPrincipalColumn(parsed.headers, parsed.rows);
      const ordered = reorderColumns(withPrincipal.headers, withPrincipal.rows);
      setSheet({
        fileName: file.name,
        sheetName: parsed.sheetName,
        headers: ordered.headers,
        rows: ordered.rows,
        updatedAt: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败，请检查文件');
    } finally {
      setLoading(false);
    }
  };

  const headers = sheet?.headers || [];
  const rows = sheet?.rows || [];
  const hasPrincipal = headers.includes('本金');
  const amountIdx = headers.indexOf('持有金额');
  const principalIdx = headers.indexOf('本金');
  const pnlIdx = headers.indexOf('持有盈亏');
  const todayPnlIdx = headers.indexOf('当日盈亏');
  const cumPnlIdx = headers.indexOf('累计盈亏');

  const sumOf = (idx: number) => {
    if (idx < 0) return null;
    let total = 0;
    let has = false;
    for (const row of rows) {
      const v = toNum(row[idx]);
      if (v != null) { total += v; has = true; }
    }
    return has ? total : null;
  };

  const totals = useMemo(() => ({
    amount: sumOf(amountIdx),
    principal: sumOf(principalIdx),
    pnl: sumOf(pnlIdx),
    todayPnl: sumOf(todayPnlIdx),
    cumPnl: sumOf(cumPnlIdx),
  }), [rows, amountIdx, principalIdx, pnlIdx, todayPnlIdx, cumPnlIdx]);

  const footnote = useMemo(() => {
    if (!sheet || amountIdx < 0 || !hasPrincipal) return null;
    return '“持有金额”= 持有数量 × 最新价，属于市值；已按“持有金额 − 持有盈亏”反推新增“本金”列（缺盈亏时用 持有数量 × 单位成本）。';
  }, [sheet, amountIdx, hasPrincipal]);

  const deleteRow = (idx: number) => {
    setSheet(prev => prev ? { ...prev, rows: prev.rows.filter((_, i) => i !== idx) } : prev);
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-app-bg flex flex-col"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={(e) => { e.stopPropagation(); setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        void handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-app-border bg-app-card/80 backdrop-blur">
        <Wallet size={16} className="text-indigo-400 shrink-0" />
        <span className="text-sm font-semibold text-app-text shrink-0">股票账户</span>
        {sheet && (
          <span className="text-[10px] text-app-subtext truncate min-w-0">
            {sheet.fileName} · {sheet.sheetName} · {sheet.rows.length} 行
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {sheet && (
            <button
              type="button"
              onClick={() => { setSheet(null); setError(null); }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-app-border bg-app-input text-[11px] text-app-subtext hover:text-brand-red hover:border-brand-red/60 transition-colors"
              title="关闭当前 Excel，回到未上传状态"
            >
              <LogOut size={13} />
              推出 Excel
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-app-border bg-app-input text-[11px] text-app-subtext hover:text-indigo-400 hover:border-indigo-500 transition-colors disabled:opacity-50"
            title="上传 xlsx（也会替换当前数据）"
          >
            <Upload size={13} />
            {loading ? '解析中…' : '上传 Excel'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-app-subtext hover:text-app-text transition-colors p-1 rounded"
            title="关闭 (ESC)"
          >
            <X size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      <div className="p-3 flex-1 flex flex-col min-h-0 gap-2">
        {error && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-red/40 bg-brand-red/10 text-[11px] text-brand-red">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        {!sheet ? (
          <div
            className={`flex-1 flex flex-col items-center justify-center gap-3 m-2 rounded-xl border border-dashed transition-colors ${dragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-app-border'}`}
          >
            <FileSpreadsheet size={40} className="text-app-subtext/60" />
            <div className="text-sm text-app-text font-medium">拖入或上传股票账户 Excel</div>
            <div className="text-[11px] text-app-subtext">支持 .xlsx，解析「持仓数据」工作表</div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-bold hover:opacity-90 transition-opacity"
            >
              <Upload size={13} /> 选择文件
            </button>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-x-4 gap-y-1 flex-wrap px-3 py-2 rounded-lg border border-app-border bg-app-card/70 text-[11px]">
              <span className="text-app-subtext">市值合计 <b className="font-mono text-app-text text-xs">{formatMoney(totals.amount)}</b></span>
              <span className="text-app-subtext">本金合计 <b className="font-mono text-indigo-400 text-xs">{formatMoney(totals.principal)}</b></span>
              <span className="text-app-subtext">持有盈亏 <b className={`font-mono text-xs ${(totals.pnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.pnl)}</b></span>
              <span className="text-app-subtext">当日盈亏 <b className={`font-mono text-xs ${(totals.todayPnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.todayPnl)}</b></span>
              <span className="text-app-subtext">累计盈亏 <b className={`font-mono text-xs ${(totals.cumPnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.cumPnl)}</b></span>
            </div>

            {footnote && (
              <div className="shrink-0 px-1 text-[10px] leading-relaxed text-app-subtext">{footnote}</div>
            )}

            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar rounded-lg border border-app-border bg-app-card">
              <table className="text-[11px] border-separate border-spacing-0" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                <colgroup>
                  <col style={{ width: '40px' }} />
                  {headers.map(h => (
                    <col
                      key={h}
                      style={{ width: h.includes('名称') ? '86px' : h === '代码' ? '76px' : isPercentCol(h) ? '76px' : isPriceCol(h) || isQtyCol(h) ? '82px' : isMoneyCol(h) ? '96px' : '84px' }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-20 px-1 py-2 bg-app-input border-b border-app-border border-r border-app-border text-[10px] font-bold text-app-subtext whitespace-nowrap">操作</th>
                    {headers.map(h => (
                      <th
                        key={h}
                        className={`sticky top-0 z-10 px-2 py-2 bg-app-input border-b border-app-border border-r border-app-border text-[10px] font-bold whitespace-nowrap ${h === '本金' ? 'text-indigo-400' : 'text-app-subtext'}`}
                        title={h === '本金' ? '本金 = 持有金额 − 持有盈亏（缺盈亏时用 持有数量 × 单位成本）' : h}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className="group hover:bg-app-hover transition-colors">
                      <td className="px-1 py-1.5 border-b border-app-border border-r border-app-border text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(ri)}
                          className="p-0.5 rounded text-app-subtext/50 hover:text-brand-red hover:bg-app-text/5 transition-colors"
                          title="删除该行"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                      {headers.map((h, ci) => {
                        const v = row[ci];
                        return (
                          <td
                            key={h}
                            className={`px-2 py-1.5 border-b border-app-border border-r border-app-border font-mono whitespace-nowrap ${h === '本金' ? 'text-indigo-400 font-bold' : cellColor(v, h) || 'text-app-rowtext'}`}
                            title={h === '本金' ? '本金 = 持有金额 − 持有盈亏' : undefined}
                          >
                            {formatCell(v, h)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky bottom-0 z-20 px-1 py-2 bg-app-input border-t border-app-border border-r border-app-border text-[10px] font-bold text-app-text text-center">合计</td>
                    {headers.map((h, ci) => {
                      let content = '';
                      if (ci === 0) content = `${rows.length} 只`;
                      else if (canSum(h)) content = formatCell(sumOf(ci), h);
                      return (
                        <td
                          key={h}
                          className={`sticky bottom-0 z-10 px-2 py-2 bg-app-input border-t border-app-border border-r border-app-border font-mono font-bold whitespace-nowrap ${
                            h === '本金' ? 'text-indigo-400' : canSum(h) ? cellColor(sumOf(ci), h) || 'text-app-text' : 'text-app-subtext'
                          }`}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet, Sheet, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { parseXlsxFile } from '../services/xlsxLite';
import type { ParsedSheet, SheetCell } from '../services/xlsxLite';
import { calcPositionFromTrades } from '../services/realizedPnl';
import type { StockTrade } from '../types';
import { PopoverTitleBar, usePopoverDrag } from './PriceInfoPopover';

interface StockAccountPageProps {
  onClose: () => void;
  // 已添加的股票（股息率列表），用于按「已添加 / 未添加」过滤 Excel 行
  stockCodes?: string[];
  stockNames?: string[];
  // 当前有持仓的股票（份额 > 0），用于「已持仓」过滤
  heldStockCodes?: string[];
  heldStockNames?: string[];
  // 与 heldStockCodes/heldStockNames 一一对应的记账持仓份额，用于核对 Excel 的「持有数量」
  heldStockShares?: number[];
  // 项目记账的逐笔交易记录（按股票），用于差异浮窗对照展示
  stockTradeInfo?: { code: string; name: string; trades: StockTrade[] }[];
  // 点击差异浮窗右侧（Excel）的一条有差异记录：回填交易弹窗并指定成交时间
  onCreateTradeFromExcel?: (payload: {
    code: string;
    name: string;
    side: 'buy' | 'sell';
    price: number;
    shares: number;
    filledAt: number;
    anchor: DOMRect;
  }) => void;
}

// 股票代码归一化：去空格/点号/后缀，兼容 601318.SH / SH601318 / 601318 等写法
const normCode = (raw: string): string =>
  raw.toUpperCase().replace(/[\s._\-]/g, '').replace(/^(SH|SZ|BJ)/, '').replace(/(SH|SZ|BJ)$/, '');

// Excel「交易记录」工作表里的一行
interface ExcelTradeRecord {
  date: string;      // 成交日期（YYYY-MM-DD）
  time: string;      // 成交时间（可能为空）
  code: string;
  name: string;
  category: string;  // 买入 / 卖出 / 银行转存 …
  shares: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  note: string;
}

interface AccountSheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: SheetCell[][];
  updatedAt: number;
  // Excel 文件中的「交易记录」工作表（第三个表），没有则为空
  trades?: ExcelTradeRecord[];
}

// 从「交易记录」工作表解析成结构化记录
const parseTradeSheet = (headers: string[], rows: SheetCell[][]): ExcelTradeRecord[] => {
  const idx = (name: string) => headers.findIndex(h => h.trim() === name);
  const di = idx('成交日期'), ti = idx('成交时间'), ci = idx('代码'), ni = idx('名称');
  const ki = idx('交易类别'), si = idx('成交数量'), pi = idx('成交价格');
  const ai = idx('成交金额'), fi = idx('费用'), mi = idx('备注');
  if (di < 0 || ki < 0) return [];
  return rows
    .map(row => ({
      date: String(row[di] ?? '').trim(),
      time: ti >= 0 ? String(row[ti] ?? '').trim() : '',
      code: ci >= 0 ? String(row[ci] ?? '').trim() : '',
      name: ni >= 0 ? String(row[ni] ?? '').trim() : '',
      category: String(row[ki] ?? '').trim(),
      shares: si >= 0 ? toNum(row[si]) : null,
      price: pi >= 0 ? toNum(row[pi]) : null,
      amount: ai >= 0 ? toNum(row[ai]) : null,
      fee: fi >= 0 ? toNum(row[fi]) : null,
      note: mi >= 0 ? String(row[mi] ?? '').trim() : '',
    }))
    .filter(t => t.date !== '' && t.category !== '');
};

// 对账用的一行交易（项目记账 / Excel 两侧统一口径）
interface TradeLine {
  date: string;               // YYYY-MM-DD
  time: string;               // HH:mm
  side: 'buy' | 'sell';
  label: string;              // 买入 / 卖出 / 挂买 / 挂卖
  shares: number | null;
  price: number | null;
  amount: number | null;
  pending?: boolean;
}

// 逐行 diff 结果：same=一致，del=仅项目，ins=仅 Excel，change=两侧都有但字段有差异，split=一单对多单的拆分成交（不算差异）
type DiffRow = {
  kind: 'same' | 'del' | 'ins' | 'change' | 'split';
  left?: TradeLine;
  right?: TradeLine;
  fieldDiffs?: string[];      // change 时哪些字段不一致（shares/price/amount/date）
  split?: boolean;            // split 时标记该 Excel 行属于拆分成交
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateOf = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const timeOf = (ts: number) => {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// 两侧行键：日期 + 方向 + 数量 + 价格（时间不参与匹配，Excel 与记账时间口径不同）
const tradeLineKey = (l: TradeLine) =>
  `${l.date}|${l.side}|${l.shares ?? ''}|${l.price != null ? l.price.toFixed(3) : ''}`;

// 一侧一笔（项目记账，通常是合并后录入）对另一侧多笔（Excel 拆分成交）是否可视为同一单：
// 日期/方向一致、数量合计相等，且金额（优先）或单价相当
function isMergedGroup(one: TradeLine, parts: TradeLine[]): boolean {
  if (parts.length < 2) return false;
  if (parts.some(p => p.date !== one.date || p.side !== one.side)) return false;
  if (one.shares == null) return false;
  const sumShares = parts.reduce((s, p) => s + (p.shares ?? 0), 0);
  if (Math.abs(sumShares - one.shares) > 1e-6) return false;
  const partAmounts = parts.map(p => p.amount);
  if (one.amount != null && partAmounts.every(a => a != null)) {
    const sumAmount = partAmounts.reduce((s, a) => s + (a as number), 0);
    return Math.abs(sumAmount - one.amount) <= Math.max(0.05, Math.abs(one.amount) * 0.01);
  }
  const partPrices = parts.map(p => p.price);
  if (one.price != null && partPrices.every(p => p != null)) {
    return partPrices.every(p => Math.abs((p as number) - one.price!) <= 0.0005);
  }
  return true;
}

// 逐行对齐（LCS），再把相邻的“仅项目/仅Excel”配成 change 行，方便像 git diff 一样看差异
function diffTradeLines(left: TradeLine[], right: TradeLine[]): DiffRow[] {
  const n = left.length, m = right.length;
  const ka = left.map(tradeLineKey), kb = right.map(tradeLineKey);
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const base: DiffRow[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { base.push({ kind: 'same', left: left[i], right: right[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { base.push({ kind: 'del', left: left[i] }); i++; }
    else { base.push({ kind: 'ins', right: right[j] }); j++; }
  }
  while (i < n) { base.push({ kind: 'del', left: left[i] }); i++; }
  while (j < m) { base.push({ kind: 'ins', right: right[j] }); j++; }

  // 成对的删除/新增 → change（逐字段标记差异）；一单对多单且能对上的，视为拆单、不算差异
  const out: DiffRow[] = [];
  let k = 0;
  while (k < base.length) {
    if (base[k].kind === 'del') {
      const dels: TradeLine[] = [];
      while (k < base.length && base[k].kind === 'del') { if (base[k].left) dels.push(base[k].left!); k++; }
      const inss: TradeLine[] = [];
      while (k < base.length && base[k].kind === 'ins') { if (base[k].right) inss.push(base[k].right!); k++; }

      // 先挑出「一笔项目记录 ↔ 多笔 Excel 拆分成交」的组合
      const usedIns = new Set<number>();
      const splitOf = new Map<number, number[]>();
      for (let a = 0; a < dels.length; a++) {
        const cand = inss.map((t, i) => ({ t, i })).filter(({ t, i }) => !usedIns.has(i) && t.date === dels[a].date && t.side === dels[a].side);
        for (let size = 2; size <= 4; size++) {
          let hit: number[] | null = null;
          for (let s = 0; s + size <= cand.length; s++) {
            const group = cand.slice(s, s + size);
            if (isMergedGroup(dels[a], group.map(g => g.t))) { hit = group.map(g => g.i); break; }
          }
          if (hit) {
            hit.forEach(i => usedIns.add(i));
            splitOf.set(a, hit);
            break;
          }
        }
      }

      const restDels: TradeLine[] = [];
      for (let a = 0; a < dels.length; a++) {
        const idxs = splitOf.get(a);
        if (!idxs) { restDels.push(dels[a]); continue; }
        // 拆单如实逐条展示：项目侧只占第一行，Excel 侧每条一行，均不做差异着色
        idxs.forEach((ii, n) => {
          out.push({ kind: 'split', left: n === 0 ? dels[a] : undefined, right: inss[ii], split: true });
        });
      }
      const restInss = inss.filter((_, i) => !usedIns.has(i));

      const cnt = Math.max(restDels.length, restInss.length);
      for (let x = 0; x < cnt; x++) {
        const l = restDels[x], r = restInss[x];
        if (l && r) {
          const fieldDiffs: string[] = [];
          if (l.date !== r.date) fieldDiffs.push('date');
          if ((l.shares ?? null) !== (r.shares ?? null)) fieldDiffs.push('shares');
          if (l.price == null || r.price == null ? l.price !== r.price : Math.abs(l.price - r.price) > 0.0005) fieldDiffs.push('price');
          if (l.amount == null || r.amount == null ? l.amount !== r.amount : Math.abs(l.amount - r.amount) > 0.01) fieldDiffs.push('amount');
          out.push({ kind: 'change', left: l, right: r, fieldDiffs });
        } else if (l) out.push({ kind: 'del', left: l });
        else if (r) out.push({ kind: 'ins', right: r });
      }
    } else if (base[k].kind === 'ins') {
      while (k < base.length && base[k].kind === 'ins') { out.push(base[k]); k++; }
    } else { out.push(base[k]); k++; }
  }
  return out;
}

const STORAGE_KEY = 'stock_account_sheet_v1';
// 过滤档位（全部/已持仓/未持仓/已添加/未添加）的本地记忆键
const FILTER_MODE_KEY = 'stock_account_filter_mode';
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
    // 仓位占比只展示比例，不加正号；涨幅/率等涨跌口径仍保留正负号
    const sign = pct > 0 && !/占比/.test(header) ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
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

export const StockAccountPage: React.FC<StockAccountPageProps> = ({ onClose, stockCodes, stockNames, heldStockCodes, heldStockNames, heldStockShares, stockTradeInfo, onCreateTradeFromExcel }) => {
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
      // 交易记录：优先按名称找，找不到则取第三张表
      const tradeSheet: ParsedSheet | undefined = parsed.sheets.find(s => s.sheetName === '交易记录')
        || parsed.sheets[2];
      const trades = tradeSheet ? parseTradeSheet(tradeSheet.headers, tradeSheet.rows) : [];
      setSheet({
        fileName: file.name,
        sheetName: parsed.sheetName,
        headers: ordered.headers,
        rows: ordered.rows,
        updatedAt: Date.now(),
        trades,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败，请检查文件');
    } finally {
      setLoading(false);
    }
  };

  const headers = sheet?.headers || [];
  // 展示列顺序：交换「本金」与「持有金额（显示为市值）」；并把「持有数量」「仓位占比」移到名称列右侧
  const visibleCols = useMemo(() => {
    let cols = headers.map((h, i) => ({ h, i }));
    const a = cols.findIndex(c => c.h === '持有金额');
    const b = cols.findIndex(c => c.h === '本金');
    if (a >= 0 && b >= 0) {
      const tmp = cols[a];
      cols[a] = cols[b];
      cols[b] = tmp;
    }
    // 数量/占比两列整体后移到名称之后（相对顺序保持不变）
    const movables = cols.filter(c => c.h === '持有数量' || /占比/.test(c.h));
    const namePos = cols.findIndex(c => c.h.includes('名称'));
    if (namePos >= 0 && movables.length) {
      const movableIdx = new Set(movables.map(m => m.i));
      const rest = cols.filter(c => !movableIdx.has(c.i));
      const restNamePos = rest.findIndex(c => c.h.includes('名称'));
      rest.splice(restNamePos + 1, 0, ...movables);
      cols = rest;
    }
    return cols;
  }, [headers]);
  const rows = sheet?.rows || [];
  const amountIdx = headers.indexOf('持有金额');
  const principalIdx = headers.indexOf('本金');
  const pnlIdx = headers.indexOf('持有盈亏');
  const todayPnlIdx = headers.indexOf('当日盈亏');
  const cumPnlIdx = headers.indexOf('累计盈亏');

  // Excel 行过滤：all=全部 / held=我当前有持仓的 / notHeld=我当前没持仓的 / added=我已添加过的 / notAdded=我还没添加的
  // 选择结果本地记忆，下次打开沿用上次的过滤档位
  const [filterMode, setFilterMode] = useState<'all' | 'held' | 'notHeld' | 'added' | 'notAdded'>(() => {
    try {
      const raw = localStorage.getItem(FILTER_MODE_KEY);
      if (raw === 'all' || raw === 'held' || raw === 'notHeld' || raw === 'added' || raw === 'notAdded') return raw;
    } catch { /* 忽略 */ }
    return 'all';
  });
  useEffect(() => {
    try { localStorage.setItem(FILTER_MODE_KEY, filterMode); } catch { /* 忽略 */ }
  }, [filterMode]);
  // 小眼睛开关：被排除的行不计入底部合计（仅影响合计，不影响行数与过滤）
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  useEffect(() => { setExcludedRows(new Set()); }, [rows]);
  const toggleRowExcluded = (ri: number) => {
    setExcludedRows(prev => {
      const next = new Set(prev);
      if (next.has(ri)) next.delete(ri); else next.add(ri);
      return next;
    });
  };
  const codeIdx = headers.indexOf('代码');
  const nameIdx = headers.indexOf('名称') >= 0 ? headers.indexOf('名称') : headers.indexOf('股票名称');
  // 记账持仓份额（代码 / 名称双索引），用于核对 Excel 的「持有数量」
  const heldSharesByCode = useMemo(() => {
    const m = new Map<string, number>();
    (heldStockCodes || []).forEach((c, i) => {
      const s = heldStockShares?.[i];
      if (s != null) m.set(normCode(c), s);
    });
    return m;
  }, [heldStockCodes, heldStockShares]);
  const heldSharesByName = useMemo(() => {
    const m = new Map<string, number>();
    (heldStockNames || []).forEach((n, i) => {
      const s = heldStockShares?.[i];
      if (s != null) m.set(n.trim(), s);
    });
    return m;
  }, [heldStockNames, heldStockShares]);
  const bookSharesFor = (row: SheetCell[]): number | null => {
    if (codeIdx >= 0) {
      const code = row[codeIdx];
      if (code != null && String(code).trim() !== '') {
        const v = heldSharesByCode.get(normCode(String(code)));
        if (v != null) return v;
      }
    }
    if (nameIdx >= 0) {
      const name = row[nameIdx];
      if (name != null) {
        const v = heldSharesByName.get(String(name).trim());
        if (v != null) return v;
      }
    }
    return null;
  };
  // 项目记账交易记录（代码 / 名称双索引）
  const tradesByCode = useMemo(() => {
    const m = new Map<string, StockTrade[]>();
    (stockTradeInfo || []).forEach(info => m.set(normCode(info.code), info.trades || []));
    return m;
  }, [stockTradeInfo]);
  const tradesByName = useMemo(() => {
    const m = new Map<string, StockTrade[]>();
    (stockTradeInfo || []).forEach(info => m.set(info.name.trim(), info.trades || []));
    return m;
  }, [stockTradeInfo]);
  const tradesFor = (row: SheetCell[]): StockTrade[] => {
    if (codeIdx >= 0) {
      const code = row[codeIdx];
      if (code != null && String(code).trim() !== '') {
        const v = tradesByCode.get(normCode(String(code)));
        if (v) return v;
      }
    }
    if (nameIdx >= 0) {
      const name = row[nameIdx];
      if (name != null && String(name).trim() !== '') {
        const v = tradesByName.get(String(name).trim());
        if (v) return v;
      }
    }
    return [];
  };
  // 差异浮窗：点击标黄的持有数量时展开，展示项目记账与 Excel 的对账明细
  const [diffPopover, setDiffPopover] = useState<{ row: SheetCell[]; ri: number; pos: { top: number; left: number } } | null>(null);
  // 浮窗标题栏拖拽：与支撑/压力位弹窗共用同一套实现
  const diffPopoverRef = useRef<HTMLDivElement | null>(null);
  // setter 必须保持引用稳定，否则拖动时 usePopoverDrag 的 effect 会在每次刷新时移除监听，表现为“只能拖一点”
  const setDiffTop = useCallback((top: number) => {
    setDiffPopover(p => (p ? { ...p, pos: { ...p.pos, top } } : p));
  }, []);
  const setDiffLeft = useCallback((left: number) => {
    setDiffPopover(p => (p ? { ...p, pos: { ...p.pos, left } } : p));
  }, []);
  const diffDrag = usePopoverDrag(diffPopoverRef, setDiffTop, setDiffLeft);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 由 Excel 差异行呼出的交易弹窗叠在本页之上时，ESC 只关交易弹窗，不关闭对账单页
      if (document.querySelector('[data-trade-popup]')) return;
      // 对账明细浮窗打开时，ESC 只关浮窗，页面保留
      if (diffPopover) {
        setDiffPopover(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, diffPopover]);
  const openDiffPopover = (row: SheetCell[], ri: number, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const w = 560;
    const h = Math.min(620, window.innerHeight - 24);
    let left = rect.right + 8;
    if (left + w > window.innerWidth - 8) left = rect.left - w - 8;
    if (left < 8) left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - h - 8));
    setDiffPopover({ row, ri, pos: { top, left } });
  };
  const visibleRowList = useMemo(() => {
    const withIdx = rows.map((row, ri) => ({ row, ri }));
    if (filterMode === 'all') return withIdx;
    const addedCodes = new Set<string>((stockCodes || []).map(c => normCode(c)));
    const addedNames = new Set<string>((stockNames || []).map(n => n.trim()));
    const heldCodes = new Set<string>((heldStockCodes || []).map(c => normCode(c)));
    const heldNames = new Set<string>((heldStockNames || []).map(n => n.trim()));
    const matches = (row: SheetCell[], codes: Set<string>, names: Set<string>) => {
      const code = codeIdx >= 0 ? row[codeIdx] : null;
      if (code != null && String(code).trim() !== '') return codes.has(normCode(String(code)));
      const name = nameIdx >= 0 ? row[nameIdx] : null;
      return name != null && names.has(String(name).trim());
    };
    return withIdx.filter(({ row }) => {
      switch (filterMode) {
        case 'added': return matches(row, addedCodes, addedNames);
        case 'notAdded': return !matches(row, addedCodes, addedNames);
        case 'held': return matches(row, heldCodes, heldNames);
        case 'notHeld': return !matches(row, heldCodes, heldNames);
        default: return true;
      }
    });
  }, [rows, filterMode, codeIdx, nameIdx, stockCodes, stockNames, heldStockCodes, heldStockNames]);
  const rowsForTotals = useMemo(
    () => visibleRowList.filter(v => !excludedRows.has(v.ri)).map(v => v.row),
    [visibleRowList, excludedRows],
  );

  const sumOf = (idx: number) => {
    if (idx < 0) return null;
    let total = 0;
    let has = false;
    for (const row of rowsForTotals) {
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
  }), [rowsForTotals, amountIdx, principalIdx, pnlIdx, todayPnlIdx, cumPnlIdx]);

  // 市值合计 / 持有金额合计按持有盈亏方向着色（盈红亏绿，零灰、缺失用默认色）
  const profitCls = totals.pnl == null
    ? 'text-app-text'
    : (totals.pnl === 0 ? 'text-gray-500' : (totals.pnl > 0 ? 'text-brand-red' : 'text-brand-green'));
  // 个股「市值」单元格：按该行持有盈亏方向着色（零灰、缺失用默认色）
  const pnlCellCls = (v: SheetCell | null | undefined) => {
    const n = toNum(v);
    if (n == null) return '';
    if (n === 0) return 'text-gray-500';
    return n > 0 ? 'text-brand-red' : 'text-brand-green';
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
        <Sheet size={16} className="text-app-subtext shrink-0" />
        <span className="text-sm font-semibold text-app-subtext shrink-0">对账单</span>
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
              className="text-[11px] text-white/[0.01] hover:text-app-text transition-colors"
              title="退出当前 Excel，回到未上传状态"
            >
              退出
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="text-[11px] text-white/[0.01] hover:text-app-text transition-colors disabled:opacity-50"
            title="上传 xlsx（也会替换当前数据）"
          >
            {loading ? '解析中…' : '上传'}
          </button>
          <button
            type="button"
            onClick={() => {
              // 先通过自定义 URL scheme 唤起本机 HXFinance.app（投资账本），2 秒后再打开在线对账单页
              const a = document.createElement('a');
              a.href = 'tzzbdk://';
              a.rel = 'noopener';
              document.body.appendChild(a);
              a.click();
              a.remove();
              // 3 秒后：先让本机辅助接口退出投资账本，再用新的浏览器窗口打开在线对账单页
              window.setTimeout(() => {
                fetch('/api/quit-hxfinance', { method: 'POST' }).catch(() => {});
                const width = Math.min(1440, Math.round(window.screen.availWidth * 0.85));
                const height = Math.min(1000, Math.round(window.screen.availHeight * 0.9));
                window.open(
                  'https://tzzb.10jqka.com.cn/pc/index.html#/myAccount',
                  'tzzb_account_sync',
                  `popup=yes,width=${width},height=${height},left=120,top=80`,
                );
              }, 3000);
            }}
            className="text-[11px] text-app-subtext hover:text-app-text transition-colors"
            title="唤起 HXFinance 同步数据"
          >
            同步
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
            <div className="text-sm text-app-text font-medium">拖入或上传对账单 Excel</div>
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
              <div className="flex items-center gap-0.5 rounded-lg bg-app-input p-0.5 shrink-0">
                {([
                  { key: 'all', label: '全部' },
                  { key: 'held', label: '已持仓' },
                  { key: 'notHeld', label: '未持仓' },
                  { key: 'added', label: '已添加' },
                  { key: 'notAdded', label: '未添加' },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setFilterMode(m.key)}
                    className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${filterMode === m.key ? 'bg-app-card text-indigo-400 font-semibold shadow-sm' : 'text-app-subtext hover:text-app-text'}`}
                    title={
                      m.key === 'all' ? '展示 Excel 全部股票'
                        : m.key === 'held' ? '只保留股息率列表中当前有持仓的股票'
                        : m.key === 'notHeld' ? '只保留股息率列表中当前没有持仓的股票'
                        : m.key === 'added' ? '只保留股息率列表中已添加的股票'
                        : '只保留股息率列表中尚未添加的股票'
                    }
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="text-app-subtext">本金合计 <b className="font-mono text-indigo-400 text-xs">{formatMoney(totals.principal)}</b></span>
              <span className="text-app-subtext">市值合计 <b className={`font-mono text-xs ${profitCls}`}>{formatMoney(totals.amount)}</b></span>
              <span className="text-app-subtext">持有盈亏 <b className={`font-mono text-xs ${(totals.pnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.pnl)}</b></span>
              <span className="text-app-subtext">当日盈亏 <b className={`font-mono text-xs ${(totals.todayPnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.todayPnl)}</b></span>
              <span className="text-app-subtext">累计盈亏 <b className={`font-mono text-xs ${(totals.cumPnl ?? 0) >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{formatMoney(totals.cumPnl)}</b></span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar rounded-lg border border-app-border bg-app-card">
              <table className="text-[11px] border-separate border-spacing-0" style={{ tableLayout: 'fixed', width: 'max-content' }}>
                <colgroup>
                  <col style={{ width: '40px' }} />
                  {visibleCols.map(({ h, i }) => (
                    <col
                      key={`${h}-${i}`}
                      style={{ width: h.includes('名称') ? '86px' : h === '代码' ? '76px' : /占比/.test(h) ? '58px' : isPercentCol(h) ? '76px' : h === '持有数量' ? '62px' : isPriceCol(h) || isQtyCol(h) ? '82px' : isMoneyCol(h) ? '96px' : '84px' }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-20 px-1 py-2 bg-app-input border-b border-app-border border-r border-app-border text-[10px] font-bold text-app-subtext whitespace-nowrap">操作</th>
                    {visibleCols.map(({ h, i }) => (
                      <th
                        key={`${h}-${i}`}
                        className={`sticky top-0 z-10 px-2 py-2 bg-app-input border-b border-app-border border-r border-app-border text-[10px] font-bold whitespace-nowrap ${h === '本金' ? 'text-indigo-400' : 'text-app-subtext'}`}
                        title={h === '本金' ? '本金 = 市值 − 持有盈亏（缺盈亏时用 持有数量 × 单位成本）' : h === '持有金额' ? '市值 = 持有数量 × 最新价' : h}
                      >
                        {h === '持有金额' ? '市值' : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRowList.map(({ row, ri }) => (
                    <tr key={ri} className={`group hover:bg-app-hover transition-colors ${excludedRows.has(ri) ? 'opacity-40' : ''}`}>
                      <td className="px-1 py-1.5 border-b border-app-border border-r border-app-border text-center">
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => toggleRowExcluded(ri)}
                            className={`p-0.5 rounded transition-colors ${excludedRows.has(ri) ? 'text-gray-500 hover:text-app-text' : 'text-app-subtext hover:text-app-text'}`}
                            title={excludedRows.has(ri) ? '已排除，不计入合计（点击恢复）' : '计入合计（点击排除）'}
                          >
                            {excludedRows.has(ri) ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        </div>
                      </td>
                      {visibleCols.map(({ h, i: ci }) => {
                        const v = row[ci];
                        // 「已持仓」视图下核对持有数量：与记账份额不一致时标黄，并附上记账数量
                        const bookShares = h === '持有数量' && filterMode === 'held' ? bookSharesFor(row) : null;
                        const sheetQty = toNum(v);
                        const mismatch = bookShares != null && sheetQty != null && Math.abs(sheetQty - bookShares) > 1e-6 ? bookShares : null;
                        return (
                          <td
                            key={`${h}-${ci}`}
                            className={`px-2 py-1.5 border-b border-app-border border-r border-app-border font-mono whitespace-nowrap ${mismatch != null ? 'cursor-pointer hover:bg-app-input/40 text-indigo-400' : h === '本金' ? 'text-indigo-400 font-bold' : h === '持有金额' ? (pnlCellCls(pnlIdx >= 0 ? row[pnlIdx] : null) || 'text-app-rowtext') : cellColor(v, h) || 'text-app-rowtext'}`}
                            title={mismatch != null ? `Excel 持有数量与记账持仓不一致，记账为 ${mismatch.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : h === '本金' ? '本金 = 持有金额 − 持有盈亏' : undefined}
                            onClick={mismatch != null ? (e) => openDiffPopover(row, ri, e.currentTarget) : undefined}
                          >
                            {formatCell(v, h)}
                            {mismatch != null && (
                              <span>{' '}({mismatch.toLocaleString('zh-CN', { maximumFractionDigits: 2 })})</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky bottom-0 z-20 px-1 py-2 bg-app-input border-t border-app-border border-r border-app-border text-[10px] font-bold text-app-text text-center">合计</td>
                    {visibleCols.map(({ h, i: ci }, pos) => {
                      let content = '';
                      if (pos === 0) content = `${rowsForTotals.length} 只`;
                      else if (canSum(h)) content = formatCell(sumOf(ci), h);
                      return (
                        <td
                          key={`${h}-${ci}`}
                          className={`sticky bottom-0 z-10 px-2 py-2 bg-app-input border-t border-app-border border-r border-app-border font-mono font-bold whitespace-nowrap ${
                            h === '本金' ? 'text-indigo-400' : h === '持有金额' ? profitCls : canSum(h) ? cellColor(sumOf(ci), h) || 'text-app-text' : 'text-app-subtext'
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

      {/* 差异浮窗：项目记账与 Excel 对账明细 + 项目逐笔交易流水（从新到旧） */}
      {diffPopover && (() => {
        const { row, pos } = diffPopover;
        const trades = tradesFor(row);
        const position = calcPositionFromTrades(trades);
        const nameVal = nameIdx >= 0 ? String(row[nameIdx] ?? '') : '';
        const codeVal = codeIdx >= 0 ? String(row[codeIdx] ?? '') : '';
        const exQty = headers.indexOf('持有数量') >= 0 ? toNum(row[headers.indexOf('持有数量')]) : null;
        const exCost = headers.indexOf('单位成本') >= 0 ? toNum(row[headers.indexOf('单位成本')]) : null;
        const exAmount = amountIdx >= 0 ? toNum(row[amountIdx]) : null;
        const exPrincipal = principalIdx >= 0 ? toNum(row[principalIdx]) : null;
        const exPnl = pnlIdx >= 0 ? toNum(row[pnlIdx]) : null;
        const priceIdx = headers.indexOf('最新价');
        const impliedPrice = exAmount != null && exQty ? exAmount / exQty : null;
        const price = (priceIdx >= 0 ? toNum(row[priceIdx]) : null) ?? impliedPrice;
        const projShares = position.shares;
        const projCost = position.avgCost;
        const projAmount = price != null ? projShares * price : null;
        const projPrincipal = projShares * projCost;
        const projPnl = projAmount != null ? projAmount - projPrincipal : null;
        const rowsToCompare: { label: string; book: number | null; excel: number | null; tol: number; digits: number }[] = [
          { label: '持有数量', book: projShares, excel: exQty, tol: 1e-6, digits: 2 },
          { label: '单位成本', book: projCost, excel: exCost, tol: 0.0005, digits: 3 },
          { label: '市值', book: projAmount, excel: exAmount, tol: 0.01, digits: 2 },
          { label: '本金', book: projPrincipal, excel: exPrincipal, tol: 0.01, digits: 2 },
          { label: '持有盈亏', book: projPnl, excel: exPnl, tol: 0.01, digits: 2 },
        ];
        const fmtNum = (n: number | null, digits: number) => n == null
          ? '-'
          : n.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
        // 左侧：项目记账（从新到旧）；右侧：Excel「交易记录」中的该股票买卖记录（从新到旧）
        // 只对比已成交记录；挂单未成交，不参与对账
        const pendingCount = trades.filter(t => !t.isDeleted && t.status === 'pending').length;
        const projectLines: TradeLine[] = trades
          .filter(t => !t.isDeleted && t.status !== 'pending')
          .sort((a, b) => (b.filledAt ?? b.createdAt) - (a.filledAt ?? a.createdAt))
          .map(t => {
            const ts = t.filledAt ?? t.createdAt;
            return {
              date: dateOf(ts), time: timeOf(ts), side: t.side,
              label: t.side === 'buy' ? '买入' : '卖出',
              shares: t.shares ?? null,
              price: t.price ?? null,
              amount: t.amount ?? (t.price || 0) * (t.shares || 0),
            };
          });
        const excelLines: TradeLine[] = (sheet?.trades || [])
          .filter(t => /买入|卖出/.test(t.category))
          .filter(t => (codeVal && normCode(t.code) === normCode(codeVal)) || (nameVal && t.name.trim() === nameVal))
          .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
          .map(t => ({
            date: t.date,
            time: t.time.slice(0, 5),
            side: t.category.includes('买') ? 'buy' as const : 'sell' as const,
            label: t.category.includes('买') ? '买入' : '卖出',
            shares: t.shares,
            price: t.price,
            amount: t.amount,
          }));
        const diffRows = diffTradeLines(projectLines, excelLines);
        // 拆单（一单对多单但能对上）不算差异
        const diffCount = diffRows.filter(d => d.kind !== 'same' && d.kind !== 'split').length;
        const renderLineCell = (line: TradeLine | undefined, tone: 'same' | 'del' | 'ins' | 'change' | 'split', fieldDiffs?: string[], onLabelClick?: (e: React.MouseEvent<HTMLElement>) => void, split?: boolean) => {
          if (!line) return <div className="px-2 py-1 text-[10px] font-mono text-app-subtext/60 bg-app-card">-</div>;
          const sideCls = line.pending ? 'text-orange-400' : (line.side === 'buy' ? 'text-brand-red' : 'text-brand-green');
          const flagCls = (f: string) => tone === 'change' && fieldDiffs?.includes(f)
            ? 'bg-[rgba(210,153,34,0.25)] text-[#e3b341] px-0.5 rounded'
            : 'text-app-text';
          return (
            <div className={`px-2 py-1 text-[10px] font-mono flex items-center gap-1 whitespace-nowrap ${tone === 'change' ? 'bg-[rgba(210,153,34,0.08)]' : ''}`}>
              <span className={`w-[74px] shrink-0 text-app-subtext ${tone === 'change' && fieldDiffs?.includes('date') ? 'bg-[rgba(210,153,34,0.25)] text-[#e3b341] px-0.5 rounded' : ''}`}>{line.date.slice(5)} {line.time}</span>
              <span
                className={`shrink-0 font-bold ${split ? '' : 'w-[26px]'} ${sideCls} ${onLabelClick ? 'cursor-pointer hover:underline underline-offset-2 decoration-current' : ''}`}
                onClick={onLabelClick}
              >{line.label}{split ? '（拆）' : ''}</span>
              <span className={`flex-1 text-right ${flagCls('price')}`}>{line.price != null ? line.price.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : '-'}</span>
              <span className={`w-[60px] text-right ${flagCls('shares')}`}>×{line.shares != null ? line.shares.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) : '-'}</span>
            </div>
          );
        };
        return (
          <div className="fixed inset-0 z-40" onClick={() => setDiffPopover(null)}>
            <div
              ref={diffPopoverRef}
              className="absolute flex flex-col bg-app-input border border-slate-500/40 rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.55)] overflow-hidden"
              style={{ top: pos.top, left: pos.left, width: 560, maxHeight: Math.min(620, window.innerHeight - 16) }}
              onClick={(e) => e.stopPropagation()}
            >
              <PopoverTitleBar
                title={<>{nameVal}{codeVal ? `（${codeVal}）` : ''} <span className="font-normal text-app-subtext">对账明细</span></>}
                onPointerDown={diffDrag.onPointerDown}
                right={(
                  <button type="button" onClick={() => setDiffPopover(null)} className="p-0.5 rounded text-app-subtext hover:bg-app-input">
                    <X size={12} />
                  </button>
                )}
              />

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-app-card">
              <div className="px-3 py-2">
                <div className="text-[10px] font-bold text-app-subtext mb-1">持仓数据核对</div>
                <div className="grid grid-cols-4 gap-px bg-app-border rounded-md overflow-hidden border border-app-border text-[11px]">
                  <div className="bg-app-input px-2 py-1 text-[10px] text-app-subtext">字段</div>
                  <div className="bg-app-input px-2 py-1 text-[10px] text-app-subtext text-right">项目记账</div>
                  <div className="bg-app-input px-2 py-1 text-[10px] text-app-subtext text-right">Excel</div>
                  <div className="bg-app-input px-2 py-1 text-[10px] text-app-subtext text-right">差值</div>
                  {rowsToCompare.map((r) => {
                    const diff = r.book != null && r.excel != null ? r.book - r.excel : null;
                    const flagged = diff != null && Math.abs(diff) > r.tol;
                    return (
                      <React.Fragment key={r.label}>
                        <div className={`bg-app-card px-2 py-1 text-app-subtext ${flagged ? 'font-semibold' : ''}`}>{r.label}</div>
                        <div className="bg-app-card px-2 py-1 text-right font-mono text-app-subtext">{fmtNum(r.book, r.digits)}</div>
                        <div className="bg-app-card px-2 py-1 text-right font-mono text-app-subtext">{fmtNum(r.excel, r.digits)}</div>
                        <div className={`bg-app-card px-2 py-1 text-right font-mono text-app-subtext ${flagged ? 'font-semibold' : ''}`}>{flagged && diff != null ? `${diff > 0 ? '+' : ''}${fmtNum(diff, r.digits)}` : '-'}</div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-app-subtext">
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-[rgba(248,81,73,0.6)]" />仅项目有</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-[rgba(63,185,80,0.7)]" />仅 Excel 有</span>
                  <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-sm bg-[rgba(210,153,34,0.6)]" />两侧字段不一致</span>
                </div>
              </div>

              <div className="px-3 pb-3">
                <div className="mb-1 text-[10px] font-bold text-app-subtext">
                  交易记录核对（{diffCount > 0 ? `${diffCount} 处差异` : '两侧一致'}）
                </div>
                {diffRows.length === 0 ? (
                  <div className="text-[11px] text-app-subtext py-2">两侧都没有该股票的交易记录</div>
                ) : (
                  <div className="grid grid-cols-2 gap-px bg-app-border rounded-md overflow-hidden border border-app-border">
                    <div className="bg-app-input px-2 py-1 text-[10px] font-bold text-app-subtext">项目记账</div>
                    <div className="bg-app-input px-2 py-1 text-[10px] font-bold text-app-subtext">Excel 交易记录</div>
                    {diffRows.map((d, idx) => {
                      // 右侧 Excel 记录：有差异且具备价格/数量时，「买入/卖出」文字可点击回填交易弹窗（成交时间取 Excel 的记录时间）
                      // 拆单行属于已对上的记录，不提供回填入口
                      const canBackfill = !!onCreateTradeFromExcel
                        && d.kind !== 'same' && d.kind !== 'split'
                        && d.right?.price != null && d.right?.shares != null;
                      const handleBackfill = (e: React.MouseEvent<HTMLElement>) => {
                        if (!canBackfill || !d.right) return;
                        const time = d.right.time && d.right.time.length >= 5 ? d.right.time : '09:30';
                        const ts = new Date(`${d.right.date}T${time}:00`).getTime();
                        // 以对账浮窗右边缘作为锚点，让交易弹窗出现在浮窗旁边，避免盖住对照表
                        const cellRect = e.currentTarget.getBoundingClientRect();
                        const popRect = diffPopoverRef.current?.getBoundingClientRect();
                        onCreateTradeFromExcel!({
                          code: codeVal,
                          name: nameVal,
                          side: d.right.side,
                          price: d.right.price!,
                          shares: d.right.shares!,
                          filledAt: Number.isFinite(ts) ? ts : Date.now(),
                          anchor: popRect
                            ? new DOMRect(popRect.right, cellRect.top, 0, cellRect.height)
                            : cellRect,
                        });
                      };
                      return (
                      <React.Fragment key={`diff-${idx}`}>
                        <div className={`${d.kind === 'del' ? 'bg-[rgba(248,81,73,0.12)]' : 'bg-app-card'}`}>
                          {renderLineCell(d.left, d.kind, d.fieldDiffs)}
                        </div>
                        <div className={`${d.kind === 'ins' ? 'bg-[rgba(63,185,80,0.20)]' : d.kind === 'change' ? 'bg-[rgba(210,153,34,0.12)]' : 'bg-app-card'}`}>
                          {renderLineCell(d.right, d.kind, d.fieldDiffs, canBackfill ? handleBackfill : undefined, d.split)}
                        </div>
                      </React.Fragment>
                      );
                    })}
                  </div>
                )}
                {pendingCount > 0 && (
                  <div className="mt-1 text-[10px] text-app-subtext">另有 {pendingCount} 条挂单未成交，不参与对账。</div>
                )}
                {excelLines.length === 0 && (
                  <div className="mt-1 text-[10px] text-app-subtext">Excel「交易记录」中没有该股票的买入/卖出记录（请确认导入的文件含第三个表）。</div>
                )}
              </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

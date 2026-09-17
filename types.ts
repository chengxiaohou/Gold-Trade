
export type OrderType = 'BUY' | 'SELL' | 'DIVIDEND';

export interface TradeRecord {
  id: string;
  type: OrderType;
  grams: number;
  price: number;
  timestamp: number;
  tag?: string; // New: User defined tag for filtering or categorization
  isDisabled?: boolean; // New: If true, this trade is ignored in calculations
  isPlan?: boolean; // New: If true, this is a simulated plan record
  dividendAmount?: number; // New: For DIVIDEND type, the dividend amount
  annualDividendRate?: number; // New: For DIVIDEND type, the annual dividend rate (%)
  dividendPeriodMonths?: number; // New: For DIVIDEND type, the dividend period in months
  positionValue?: number; // New: For DIVIDEND type, the position value at dividend time
}

export interface HoldingState {
  grams: number;
  avgCost: number;
  totalCost: number;
  realizedPnL: number;
  breakEvenPrice: number;
}

export interface OrderState {
  grams: number;
  price: number;
}

export interface SimulationResult {
  newTotalGrams: number;
  newAvgCost: number;
  newBreakEvenPrice: number;
  totalInvestment: number;
  costDifference: number; // Percent change in avg cost
  totalValueChange: number; // Percent change in total position value
  projectedPnL?: number; // For SELL simulation
}

export interface AIAnalysisState {
  loading: boolean;
  result: string | null;
  error: string | null;
}

export interface GithubConfig {
  token: string;
  gistId: string;
}

export type ApiSource = 'sina' | 'tencent';

export interface AppSettings {
  priceStep: number;
  gramsStep: number;
  tagColors: Record<string, string>; // Maps tag text to a color key (e.g., "short_term" -> "red")
  touchMode: boolean; // New: Enable touch drag to adjust values
  priceDisplayMode: 'breakEven' | 'avgCost' | 'both';
  totalCapital?: number; // New: Total planned investment capital
  visibleColumns?: string[]; // New: Which columns to show in trade list
  buyTaxFee?: number; // New: Tax fee per buy transaction
  sellTaxFee?: number; // New: Tax fee per sell transaction
  apiSource?: ApiSource; // New: API source for stock data ('sina' or 'tencent')
  cacheTTLMinutes?: number; // Cache TTL for real-time price during trading hours, default 10
  bollCacheTTLMinutes?: number; // Cache TTL for BOLL data during trading hours, default 120
  dividendYearLeft?: number; // Left dividend year column, default = right - 1
  dividendYearRight?: number; // Right dividend year column, default 2025
  manualFxRate?: number; // Manual USD/CNY fallback rate for price conversion (元/克 <-> 美元)
}

export type MarketStatus = 'pre_open' | 'morning_session' | 'midday_break' | 'afternoon_session' | 'closed' | 'full_day_closed';

export interface CacheInfo {
  lastFetchAt: number | null; // Timestamp of last full fetch for this source
  expiresAt: number | null; // When the cache expires
  marketStatus: MarketStatus; // Current market status
  isTradingHours: boolean; // Whether currently in trading hours
}

export type StockDividendRates = Record<string, number>;

export interface StockEntry {
  id: string;
  code: string;
  name: string;
  price: number;
  changePercent: number;
  high: number;
  low: number;
  open?: number; // 今日开盘价（实时行情，用于价格浮窗合并今日K线）
  volume?: number; // 今日成交量（手，实时行情，用于价格浮窗合并今日K线）
  dividend2024: number;
  dividend2025: number;
  dividendByYear: Record<number, number>; // key=年份, value=每股税前派息（全年汇总）
  dividendRate2025: number;
  positionShares: number; // 持仓股数（0 = 未持仓）
  positionCost: number;   // 每股成本（买入均价，元；仅编辑模式展示）
  nickname?: string;      // 自定义代号（为空时使用内置默认代号）
  priceUpdatedAt: number | null;
  dividendRates: StockDividendRates;
  tag?: string; // User defined tag for filtering or categorization
  selectedDividendYear?: number; // Which dividend year this stock uses for rate calc, default = right year
  bollHidden?: boolean; // Whether BOLL data is hidden for this stock
  registerDate?: string; // 最近一次股权登记日（同步分红数据时获取）
  stockTrades?: StockTrade[]; // 该股的买卖/挂单记录，随股票整体同步到 Gist（软删 isDeleted 随记录携带）
}

export type StockTradeSide = 'buy' | 'sell';
export type StockTradeStatus = 'pending' | 'filled'; // 挂单中 / 已成交

export interface StockTrade {
  id: string;
  side: StockTradeSide;      // 买入 / 卖出
  price: number;             // 点位（合并记录为加权均价）
  shares: number;            // 股数
  status: StockTradeStatus;  // 挂单中 / 已成交
  createdAt: number;         // 创建时间戳
  filledAt?: number;         // 成交时间戳
  note?: string;             // 备注
  realizedPnL?: number;      // 卖出成交时按当前均价结算的落袋盈亏
  isMerged?: boolean;        // 是否为超出上限后自动合并的汇总记录（只读，不计入上限）
  amount?: number;           // 合并记录该段成交总金额（用于精确追溯成本链）
  isDeleted?: boolean;       // 软删标记：不展示、不计入持仓/盈亏/统计，仅保留在流水账中做墓碑锚点
}

export interface DividendRateColorRange {
  min: number;
  max: number;
  color: string;
}

export interface TagParamEntry {
  enabled: boolean; // 该参数的开关
  value: number;    // 比例/容差数值
}

// 标签判定参数：仅比例/容差类。feng=风系加/减，classic=原有形态/环境。随 stockSettings 云端同步。
export interface TagParams {
  feng: Record<'fengLowBuy' | 'fengPullback' | 'fengVolBreak', TagParamEntry>;
  classic: Record<'classicDojiBody' | 'classicSmallBody' | 'classicNearHigh' | 'classicNearLow' | 'classicMaSqueeze', TagParamEntry>;
}
export type TagParamKey = keyof TagParams['feng'] | keyof TagParams['classic'];

export const DEFAULT_TAG_PARAMS: TagParams = {
  feng: {
    fengLowBuy: { enabled: true, value: 1.05 },    // 缩量入场·低位容差
    fengPullback: { enabled: true, value: 1.01 },  // 回踩放量·触达容差
    fengVolBreak: { enabled: true, value: 1.2 },   // 放量突破·倍数
  },
  classic: {
    classicDojiBody: { enabled: true, value: 0.05 },  // 十字星实体比例
    classicSmallBody: { enabled: true, value: 0.1 },  // 小实体比例
    classicNearHigh: { enabled: true, value: 0.95 },  // 接近近20日新高
    classicNearLow: { enabled: true, value: 1.05 },   // 接近近20日新低
    classicMaSqueeze: { enabled: true, value: 0.04 }, // 均线粘合比例
  },
};

// ===== 回测弹窗 =====
// 回测策略规则：把"标签信号"映射为买卖动作
export interface BacktestRule {
  id: string;
  tagKey: string;          // 对应标签目录 BACKTEST_TAG_CATALOG 的稳定 key
  label: string;           // 规则展示名（标签名）
  action: 'buy' | 'sell';
  pct: number;             // 仓位百分比 1-100
  enabled: boolean;
}
export interface BacktestStrategy {
  rules: BacktestRule[];
  initialCapital: number;  // 初始现金（默认 100000）
  feeRate?: number;        // 单边手续费比例（默认 0，如 0.00025 = 万2.5）【已废弃，改用下面三字段】
  commissionRate?: number; // 佣金费率（单边比例，买卖双向收取，默认 0.00025=万2.5）
  commissionMin?: number;  // 单笔最低佣金（元），默认 5
  stampTaxRate?: number;   // 印花税率（仅卖出单边收取，默认 0.0005=万分之5）
  rangePreset?: 'w1' | 'w2' | 'm1' | 'm3' | 'h1' | 'y1' | 'y2' | 'y3' | 'y5' | 'custom'; // 回测周期预设
  rangeStart?: string;     // 自定义开始日期 YYYY-MM-DD（仅 rangePreset='custom' 生效）
  rangeEnd?: string;       // 自定义结束日期 YYYY-MM-DD（仅 rangePreset='custom' 生效）
}

// ===== 命名的策略组合模板（回测）=====
// 仅规则列表，全局模板，可应用到任意股票；随云端以独立一级字段 backtestStrategyPresets 同步
export interface BacktestStrategyPreset {
  id: string;
  name: string;            // 组合名（用户可命名）
  rules: BacktestRule[];   // 仅规则列表，不含资金/周期/费用
  createdAt: number;       // 创建时间戳
  updatedAt: number;       // 最后更新时间戳
}
// 回测操作记录（与 K线图买卖点一一对应）
export interface BacktestTrade {
  id: string;
  date: string;
  barIndex: number;
  tagKey: string;
  tagName: string;
  action: 'buy' | 'sell';
  price: number;
  shares: number;
  amount: number;
  cashAfter: number;
  sharesAfter: number;
  avgCostAfter: number;
  realizedPnl?: number;
}
export interface BacktestResult {
  trades: BacktestTrade[];
  finalValue: number;
  totalReturnPct: number;
  winRate: number;
  maxDrawdownPct: number;
  tradeCount: number;
}
// 标签目录分组（策略编辑器的下拉选项结构）
export type BacktestTagGroup = 'feng-add' | 'feng-reduce' | 'pattern' | 'env' | 'break' | 'daily';

export interface StockSettings {
  visibleColumns?: string[];
  dividendRateColumns?: string[];
  dividendRateColorRanges?: DividendRateColorRange[];
  maxRows?: number; // 最大显示行数，用于固定高度内部滚动
  maxWidth?: number; // 列表最大宽度(px)，默认812
  tagColors?: Record<string, string>; // 标签颜色配置，与黄金页面独立
  sortMode?: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly' | 'changePercent' | 'costPct' | 'tradePct'; // 列表排序规则
  memo?: string; // 股息率列表下方备忘录文字（随云端同步）
  memoUpdatedAt?: number; // 备忘录最后编辑时间戳（ms）
  tagParams?: TagParams; // 标签判定比例/容差参数（风系 + 原有），随云端同步
  buyOrderPlaceholder?: string; // 买入挂单备注占位文字（随云端同步）
  sellOrderPlaceholder?: string; // 卖出挂单备注占位文字（随云端同步）
}

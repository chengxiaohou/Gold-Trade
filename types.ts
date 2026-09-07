
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
  stockTrades?: StockTrade[]; // 该股的买卖/挂单记录，随股票整体同步到 Gist
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
}

export interface DividendRateColorRange {
  min: number;
  max: number;
  color: string;
}

export interface StockSettings {
  visibleColumns?: string[];
  dividendRateColumns?: string[];
  dividendRateColorRanges?: DividendRateColorRange[];
  maxRows?: number; // 最大显示行数，用于固定高度内部滚动
  maxWidth?: number; // 列表最大宽度(px)，默认812
  tagColors?: Record<string, string>; // 标签颜色配置，与黄金页面独立
  sortMode?: 'default' | 'dividendRate' | 'tag' | 'daily' | 'weekly' | 'monthly'; // 列表排序规则
  memo?: string; // 股息率列表下方备忘录文字（随云端同步）
  memoUpdatedAt?: number; // 备忘录最后编辑时间戳（ms）
}

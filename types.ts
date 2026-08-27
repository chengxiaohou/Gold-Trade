
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
  sortMode?: 'default' | 'dividendRate' | 'tag'; // 列表排序规则
}


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
  dividendRate?: number; // New: Dividend annual rate (%)
  dividendPeriod?: number; // New: Dividend period in months
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
  dividendRate2025: number;
  priceUpdatedAt: number | null;
  dividendRates: StockDividendRates;
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
}

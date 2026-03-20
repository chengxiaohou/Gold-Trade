
export type OrderType = 'BUY' | 'SELL';

export interface TradeRecord {
  id: string;
  type: OrderType;
  grams: number;
  price: number;
  timestamp: number;
  tag?: string; // New: User defined tag for filtering or categorization
  isDisabled?: boolean; // New: If true, this trade is ignored in calculations
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
}

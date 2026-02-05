
export type OrderType = 'BUY' | 'SELL';

export interface TradeRecord {
  id: string;
  type: OrderType;
  grams: number;
  price: number;
  timestamp: number;
}

export interface HoldingState {
  grams: number;
  avgCost: number;
  totalCost: number;
  realizedPnL: number;
}

export interface OrderState {
  grams: number;
  price: number;
}

export interface SimulationResult {
  newTotalGrams: number;
  newAvgCost: number;
  totalInvestment: number;
  costDifference: number; // Percent change in avg cost
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

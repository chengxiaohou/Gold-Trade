
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RefreshCcw, BrainCircuit, Wallet, History, TrendingUp, TrendingDown, CheckCircle2, Download, Upload, FileJson, CloudUpload, CloudDownload, Settings, ArrowRight, ChevronUp, ChevronDown, Moon, Sun, Plus, Minus, X, Check, AlertTriangle, Zap, Activity, BarChart3, Receipt, Percent, LayoutGrid, RefreshCw, Trash2 } from 'lucide-react';
import { InputGroup } from './components/InputGroup';
import { CostChart } from './components/CostChart';
import { TradeList } from './components/TradeList';
import { TradingPlanPanel } from './components/TradingPlanPanel';
import { CloudSettingsModal } from './components/CloudSettingsModal';
import { StockDividendPage } from './components/StockDividendPage';
import { analyzeTrade } from './services/geminiService';
import { saveToGist, loadFromGist } from './services/githubService';
import { HoldingState, OrderState, SimulationResult, AIAnalysisState, TradeRecord, OrderType, GithubConfig, AppSettings, StockEntry, StockSettings } from './types';

const APP_VERSION = 'v2.0.6';

export default function App() {
  // --- Theme State ---
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('gold_app_theme');
    if (saved === 'light') return 'light';
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    localStorage.setItem('gold_app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // --- Page Switch State ---
  const [currentPage, setCurrentPage] = useState<'gold' | 'stocks'>(() => {
    const saved = localStorage.getItem('gold_current_page');
    return saved === 'stocks' ? 'stocks' : 'gold';
  });

  useEffect(() => {
    localStorage.setItem('gold_current_page', currentPage);
  }, [currentPage]);

  const togglePage = () => {
    setCurrentPage(prev => prev === 'gold' ? 'stocks' : 'gold');
  };

  // --- Stock State ---
  const [stocks, setStocks] = useState<StockEntry[]>(() => {
    const saved = localStorage.getItem('stock_dividend_stocks');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    return [
      { id: '1', code: '601318.SH', name: '中国平安', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.550, dividend2025: 2.700, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 90, '3.5%': 77.14, '4%': 67.5, '4.5%': 60, '5%': 54, '5.5%': 49.09, '6%': 45, '6.5%': 41.54, '7%': 38.57 } },
      { id: '2', code: '600036.SH', name: '招商银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.000, dividend2025: 2.016, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 67.2, '3.5%': 57.6, '4%': 50.4, '4.5%': 44.8, '5%': 40.32, '5.5%': 36.65, '6%': 33.6, '6.5%': 31.02, '7%': 28.8 } },
      { id: '3', code: '601166.SH', name: '兴业银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.060, dividend2025: 1.066, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 35.53, '3.5%': 30.46, '4%': 26.65, '4.5%': 23.69, '5%': 21.32, '5.5%': 19.38, '6%': 17.77, '6.5%': 16.40, '7%': 15.23 } },
      { id: '4', code: '002142.SZ', name: '宁波银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.900, dividend2025: 1.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 40, '3.5%': 34.29, '4%': 30, '4.5%': 26.67, '5%': 24, '5.5%': 21.82, '6%': 20, '6.5%': 18.46, '7%': 17.14 } },
      { id: '5', code: '600030.SH', name: '中信证券', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.280, dividend2025: 0.700, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 23.33, '3.5%': 20, '4%': 17.5, '4.5%': 15.56, '5%': 14, '5.5%': 12.73, '6%': 11.67, '6.5%': 10.77, '7%': 10 } },
      { id: '6', code: '601066.SH', name: '中信建投', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.255, dividend2025: 0.340, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 11.33, '3.5%': 9.71, '4%': 8.5, '4.5%': 7.56, '5%': 6.8, '5.5%': 6.18, '6%': 5.67, '6.5%': 5.23, '7%': 4.86 } },
      { id: '7', code: '000333.SZ', name: '美的集团', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.500, dividend2025: 4.300, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 143.33, '3.5%': 122.86, '4%': 107.5, '4.5%': 95.56, '5%': 86, '5.5%': 78.18, '6%': 71.67, '6.5%': 66.15, '7%': 61.43 } },
      { id: '8', code: '600690.SH', name: '海尔智家', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.965, dividend2025: 1.156, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 38.53, '3.5%': 33.03, '4%': 28.9, '4.5%': 25.69, '5%': 23.12, '5.5%': 21.02, '6%': 19.27, '6.5%': 17.79, '7%': 16.51 } },
      { id: '9', code: '000651.SZ', name: '格力电器', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.000, dividend2025: 3.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 100, '3.5%': 85.71, '4%': 75, '4.5%': 66.67, '5%': 60, '5.5%': 54.55, '6%': 50, '6.5%': 46.15, '7%': 42.86 } },
      { id: '10', code: '600329.SH', name: '达仁堂', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.280, dividend2025: 4.790, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 159.67, '3.5%': 136.86, '4%': 119.75, '4.5%': 106.44, '5%': 95.8, '5.5%': 87.09, '6%': 79.83, '6.5%': 73.69, '7%': 68.43 } },
      { id: '11', code: '000423.SZ', name: '东阿阿胶', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.270, dividend2025: 2.701, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 90.03, '3.5%': 77.17, '4%': 67.53, '4.5%': 60.02, '5%': 54.02, '5.5%': 49.10, '6%': 45.02, '6.5%': 41.55, '7%': 38.59 } },
      { id: '12', code: '000538.SZ', name: '云南白药', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.398, dividend2025: 2.602, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 86.73, '3.5%': 74.34, '4%': 65.05, '4.5%': 57.82, '5%': 52.04, '5.5%': 47.31, '6%': 43.37, '6.5%': 40.03, '7%': 37.17 } },
      { id: '13', code: '000858.SZ', name: '五粮液', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.169, dividend2025: 2.580, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 86, '3.5%': 73.71, '4%': 64.5, '4.5%': 56.67, '5%': 51.6, '5.5%': 46.91, '6%': 43, '6.5%': 39.69, '7%': 36.86 } },
      { id: '14', code: '000568.SZ', name: '泸州老窖', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 5.950, dividend2025: 5.775, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 192.33, '3.5%': 164.43, '4%': 144.25, '4.5%': 128.17, '5%': 115.4, '5.5%': 104.91, '6%': 96.17, '6.5%': 88.54, '7%': 82.43 } },
      { id: '15', code: '600887.SH', name: '伊利股份', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.220, dividend2025: 0.900, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 30, '3.5%': 25.71, '4%': 22.5, '4.5%': 20, '5%': 18, '5.5%': 16.36, '6%': 15, '6.5%': 13.85, '7%': 12.86 } },
      { id: '16', code: '601919.SH', name: '中远海控', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.030, dividend2025: 1.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 33.33, '3.5%': 28.57, '4%': 25, '4.5%': 22.22, '5%': 20, '5.5%': 18.18, '6%': 16.67, '6.5%': 15.38, '7%': 14.29 } },
      { id: '17', code: '601000.SH', name: '唐山港', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.200, dividend2025: 0.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6.67, '3.5%': 5.71, '4%': 5, '4.5%': 4.44, '5%': 4, '5.5%': 3.64, '6%': 3.33, '6.5%': 3.08, '7%': 2.86 } },
      { id: '18', code: '601298.SH', name: '青岛港', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.201, dividend2025: 0.199, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6.63, '3.5%': 5.69, '4%': 4.98, '4.5%': 4.42, '5%': 3.98, '5.5%': 3.62, '6%': 3.32, '6.5%': 3.06, '7%': 2.84 } },
      { id: '19', code: '000429.SZ', name: '粤高速A', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.523, dividend2025: 0.604, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 20.13, '3.5%': 17.26, '4%': 15.1, '4.5%': 13.42, '5%': 12.08, '5.5%': 10.98, '6%': 10.07, '6.5%': 9.32, '7%': 8.63 } },
      { id: '20', code: '600886.SH', name: '国投电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.457, dividend2025: 0.508, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 16.93, '3.5%': 14.51, '4%': 12.7, '4.5%': 11.29, '5%': 10.16, '5.5%': 9.24, '6%': 8.47, '6.5%': 7.82, '7%': 7.26 } },
      { id: '21', code: '600900.SH', name: '长江电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.943, dividend2025: 1.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 33.33, '3.5%': 28.57, '4%': 25, '4.5%': 22.22, '5%': 20, '5.5%': 18.18, '6%': 16.67, '6.5%': 15.38, '7%': 14.29 } },
      { id: '22', code: '600795.SH', name: '国电电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.110, dividend2025: 0.241, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 8.03, '3.5%': 6.88, '4%': 6.03, '4.5%': 5.36, '5%': 4.82, '5.5%': 4.38, '6%': 4.02, '6.5%': 3.70, '7%': 3.44 } },
      { id: '23', code: '600011.SH', name: '华能国际', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.270, dividend2025: 0.400, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 13.33, '3.5%': 11.43, '4%': 10, '4.5%': 8.89, '5%': 8, '5.5%': 7.27, '6%': 6.67, '6.5%': 6.15, '7%': 5.71 } },
      { id: '24', code: '601985.SH', name: '中国核电', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.160, dividend2025: 0.180, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6, '3.5%': 5.14, '4%': 4.5, '4.5%': 4, '5%': 3.6, '5.5%': 3.27, '6%': 3, '6.5%': 2.77, '7%': 2.57 } },
      { id: '25', code: '003816.SZ', name: '中国广核', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.095, dividend2025: 0.086, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 2.87, '3.5%': 2.46, '4%': 2.15, '4.5%': 1.91, '5%': 1.72, '5.5%': 1.56, '6%': 1.43, '6.5%': 1.32, '7%': 1.23 } },
      { id: '26', code: '600938.SH', name: '中国海油', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.290, dividend2025: 1.145, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 38.17, '3.5%': 32.71, '4%': 28.63, '4.5%': 25.44, '5%': 22.9, '5.5%': 20.82, '6%': 19.08, '6.5%': 17.62, '7%': 16.36 } },
      { id: '27', code: '600941.SH', name: '中国移动', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.290, dividend2025: 2.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 73.33, '3.5%': 62.86, '4%': 55, '4.5%': 48.89, '5%': 44, '5.5%': 40, '6%': 36.67, '6.5%': 33.85, '7%': 31.43 } },
      { id: '28', code: '601088.SH', name: '中国神华', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.260, dividend2025: 2.010, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 67, '3.5%': 57.43, '4%': 50.25, '4.5%': 44.67, '5%': 40.2, '5.5%': 36.55, '6%': 33.5, '6.5%': 30.92, '7%': 28.71 } },
      { id: '29', code: '561580.SH', name: '央企红利ETF华泰柏瑞', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0, dividend2025: 0.0095, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 0.32, '3.5%': 0.27, '4%': 0.24, '4.5%': 0.21, '5%': 0.19, '5.5%': 0.17, '6%': 0.16, '6.5%': 0.15, '7%': 0.14 } },
      { id: '30', code: '515080.SH', name: '中证红利ETF招商', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.070, dividend2025: 0.065, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 2.17, '3.5%': 1.86, '4%': 1.63, '4.5%': 1.44, '5%': 1.3, '5.5%': 1.18, '6%': 1.08, '6.5%': 1, '7%': 0.93 } },
      { id: '31', code: '000001.SZ', name: '平安银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.608, dividend2025: 0.596, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 19.87, '3.5%': 17.03, '4%': 14.9, '4.5%': 13.25, '5%': 11.92, '5.5%': 10.84, '6%': 9.93, '6.5%': 9.17, '7%': 8.51 } },
      { id: '32', code: '000768.SZ', name: '中航西飞', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.120, dividend2025: 0.150, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 5, '3.5%': 4.29, '4%': 3.75, '4.5%': 3.33, '5%': 3, '5.5%': 2.73, '6%': 2.5, '6.5%': 2.31, '7%': 2.14 } },
    ];
  });

  const [isAddingStock, setIsAddingStock] = useState(false);
  const [isRefreshingStockPrices, setIsRefreshingStockPrices] = useState(false);

  const handleRefreshStockPrices = async () => {
    if (stocks.length === 0) return;
    setIsRefreshingStockPrices(true);
    try {
      const newStocks = await Promise.all(stocks.map(async (stock) => {
        try {
          let market = 'sh';
          let code = stock.code;
          if (code.endsWith('.SZ')) {
            market = 'sz';
            code = code.replace('.SZ', '');
          } else if (code.endsWith('.SH')) {
            code = code.replace('.SH', '');
          }
          const res = await fetch(`https://qt.gtimg.cn/q=${market}${code}`);
          const buffer = await res.arrayBuffer();
          const decoder = new TextDecoder('gb18030');
          const text = decoder.decode(buffer);
          const match = text.match(/v_\w+="([^"]+)"/);
          if (match && match[1]) {
            const data = match[1].split('~');
            if (data.length >= 8) {
              const price = parseFloat(data[3]);
              const prevClose = parseFloat(data[4]);
              const high = parseFloat(data[7]) || price;
              const low = parseFloat(data[6]) || price;
              let changePercent = 0;
              if (prevClose > 0) {
                changePercent = ((price - prevClose) / prevClose) * 100;
              }
              const dividendRate = price > 0 ? (stock.dividend2025 / price) * 100 : 0;
              return {
                ...stock,
                price,
                changePercent,
                priceUpdatedAt: Date.now(),
                dividendRate2025: dividendRate,
              };
            }
          }
        } catch {}
        return stock;
      }));
      setStocks(newStocks);
    } finally {
      setIsRefreshingStockPrices(false);
    }
  };

  // --- State ---
  
  // 1. Trades History
  const [trades, setTrades] = useState<TradeRecord[]>(() => {
    const saved = localStorage.getItem('gold_trades_local');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isDragging, setIsDragging] = useState(false);
  
  // 2. Inputs Draft
  const [inputs, setInputs] = useState(() => {
    const saved = localStorage.getItem('gold_inputs_draft');
    return saved ? JSON.parse(saved) : { price: '', grams: '' };
  });

  // 3. Market Price
  const [marketPrice, setMarketPrice] = useState(() => {
    const saved = localStorage.getItem('gold_market_price');
    return saved || '';
  });

  // 4. Global App Settings (New)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gold_app_settings');
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      priceStep: parsed.priceStep || 5,
      gramsStep: parsed.gramsStep || 1,
      tagColors: parsed.tagColors || {},
      touchMode: parsed.touchMode ?? true,
      priceDisplayMode: parsed.priceDisplayMode || 'both',
      totalCapital: parsed.totalCapital || 0,
      buyTaxFee: parsed.buyTaxFee ?? 5,
      sellTaxFee: parsed.sellTaxFee ?? 5
    };
  });

  const [aiState, setAiState] = useState<AIAnalysisState>({
    loading: false,
    result: null,
    error: null
  });

  // Github Cloud Config State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'general' | 'cloud'>('general');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  
  // Localized Cloud Confirmation Popover State
  const [cloudConfirm, setCloudConfirm] = useState<'upload' | 'download' | null>(null);

  const [githubConfig, setGithubConfig] = useState<GithubConfig>(() => {
    const saved = localStorage.getItem('gold_github_config');
    return saved ? JSON.parse(saved) : { token: '', gistId: '' };
  });

  // Stock Settings
  const [stockSettings, setStockSettings] = useState<StockSettings>(() => {
    try {
      const saved = localStorage.getItem('stock_dividend_settings');
      const parsed = saved ? JSON.parse(saved) : {};
      return {
        visibleColumns: parsed.visibleColumns || ['code', 'name', 'price', 'changePercent', 'high', 'low', 'dividend2024', 'dividend2025', 'dividendRate2025', 'dividendRates'],
        dividendRateColumns: parsed.dividendRateColumns || ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'],
        dividendRateColorRanges: parsed.dividendRateColorRanges || [
          { min: 0, max: 4.5, color: 'red' },
          { min: 4.5, max: 5.5, color: 'yellow' },
          { min: 5.5, max: 100, color: 'green' }
        ],
        tagColors: parsed.tagColors || {}
      };
    } catch {
      return {
        visibleColumns: ['code', 'name', 'price', 'changePercent', 'high', 'low', 'dividend2024', 'dividend2025', 'dividendRate2025', 'dividendRates'],
        dividendRateColumns: ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'],
        dividendRateColorRanges: [
          { min: 0, max: 4.5, color: 'red' },
          { min: 4.5, max: 5.5, color: 'yellow' },
          { min: 5.5, max: 100, color: 'green' }
        ],
        tagColors: {}
      };
    }
  });

  useEffect(() => {
    localStorage.setItem('stock_dividend_settings', JSON.stringify(stockSettings));
  }, [stockSettings]);

  const resetStockData = () => {
    const defaultStocks = [
      { id: '1', code: '601318.SH', name: '中国平安', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.550, dividend2025: 2.700, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 90, '3.5%': 77.14, '4%': 67.5, '4.5%': 60, '5%': 54, '5.5%': 49.09, '6%': 45, '6.5%': 41.54, '7%': 38.57 } },
      { id: '2', code: '600036.SH', name: '招商银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.000, dividend2025: 2.016, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 67.2, '3.5%': 57.6, '4%': 50.4, '4.5%': 44.8, '5%': 40.32, '5.5%': 36.65, '6%': 33.6, '6.5%': 31.02, '7%': 28.8 } },
      { id: '3', code: '601166.SH', name: '兴业银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.060, dividend2025: 1.066, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 35.53, '3.5%': 30.46, '4%': 26.65, '4.5%': 23.69, '5%': 21.32, '5.5%': 19.38, '6%': 17.77, '6.5%': 16.40, '7%': 15.23 } },
      { id: '4', code: '002142.SZ', name: '宁波银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.900, dividend2025: 1.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 40, '3.5%': 34.29, '4%': 30, '4.5%': 26.67, '5%': 24, '5.5%': 21.82, '6%': 20, '6.5%': 18.46, '7%': 17.14 } },
      { id: '5', code: '600030.SH', name: '中信证券', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.280, dividend2025: 0.700, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 23.33, '3.5%': 20, '4%': 17.5, '4.5%': 15.56, '5%': 14, '5.5%': 12.73, '6%': 11.67, '6.5%': 10.77, '7%': 10 } },
      { id: '6', code: '601066.SH', name: '中信建投', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.255, dividend2025: 0.340, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 11.33, '3.5%': 9.71, '4%': 8.5, '4.5%': 7.56, '5%': 6.8, '5.5%': 6.18, '6%': 5.67, '6.5%': 5.23, '7%': 4.86 } },
      { id: '7', code: '000333.SZ', name: '美的集团', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.500, dividend2025: 4.300, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 143.33, '3.5%': 122.86, '4%': 107.5, '4.5%': 95.56, '5%': 86, '5.5%': 78.18, '6%': 71.67, '6.5%': 66.15, '7%': 61.43 } },
      { id: '8', code: '600690.SH', name: '海尔智家', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.965, dividend2025: 1.156, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 38.53, '3.5%': 33.03, '4%': 28.9, '4.5%': 25.69, '5%': 23.12, '5.5%': 21.02, '6%': 19.27, '6.5%': 17.79, '7%': 16.51 } },
      { id: '9', code: '000651.SZ', name: '格力电器', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.000, dividend2025: 3.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 100, '3.5%': 85.71, '4%': 75, '4.5%': 66.67, '5%': 60, '5.5%': 54.55, '6%': 50, '6.5%': 46.15, '7%': 42.86 } },
      { id: '10', code: '600329.SH', name: '达仁堂', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.280, dividend2025: 4.790, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 159.67, '3.5%': 136.86, '4%': 119.75, '4.5%': 106.44, '5%': 95.8, '5.5%': 87.09, '6%': 79.83, '6.5%': 73.69, '7%': 68.43 } },
      { id: '11', code: '000423.SZ', name: '东阿阿胶', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.270, dividend2025: 2.701, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 90.03, '3.5%': 77.17, '4%': 67.53, '4.5%': 60.02, '5%': 54.02, '5.5%': 49.10, '6%': 45.02, '6.5%': 41.55, '7%': 38.59 } },
      { id: '12', code: '000538.SZ', name: '云南白药', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.398, dividend2025: 2.602, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 86.73, '3.5%': 74.34, '4%': 65.05, '4.5%': 57.82, '5%': 52.04, '5.5%': 47.31, '6%': 43.37, '6.5%': 40.03, '7%': 37.17 } },
      { id: '13', code: '000858.SZ', name: '五粮液', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 3.169, dividend2025: 2.580, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 86, '3.5%': 73.71, '4%': 64.5, '4.5%': 56.67, '5%': 51.6, '5.5%': 46.91, '6%': 43, '6.5%': 39.69, '7%': 36.86 } },
      { id: '14', code: '000568.SZ', name: '泸州老窖', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 5.950, dividend2025: 5.775, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 192.33, '3.5%': 164.43, '4%': 144.25, '4.5%': 128.17, '5%': 115.4, '5.5%': 104.91, '6%': 96.17, '6.5%': 88.54, '7%': 82.43 } },
      { id: '15', code: '600887.SH', name: '伊利股份', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.220, dividend2025: 0.900, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 30, '3.5%': 25.71, '4%': 22.5, '4.5%': 20, '5%': 18, '5.5%': 16.36, '6%': 15, '6.5%': 13.85, '7%': 12.86 } },
      { id: '16', code: '601919.SH', name: '中远海控', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.030, dividend2025: 1.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 33.33, '3.5%': 28.57, '4%': 25, '4.5%': 22.22, '5%': 20, '5.5%': 18.18, '6%': 16.67, '6.5%': 15.38, '7%': 14.29 } },
      { id: '17', code: '601000.SH', name: '唐山港', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.200, dividend2025: 0.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6.67, '3.5%': 5.71, '4%': 5, '4.5%': 4.44, '5%': 4, '5.5%': 3.64, '6%': 3.33, '6.5%': 3.08, '7%': 2.86 } },
      { id: '18', code: '601298.SH', name: '青岛港', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.201, dividend2025: 0.199, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6.63, '3.5%': 5.69, '4%': 4.98, '4.5%': 4.42, '5%': 3.98, '5.5%': 3.62, '6%': 3.32, '6.5%': 3.06, '7%': 2.84 } },
      { id: '19', code: '000429.SZ', name: '粤高速A', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.523, dividend2025: 0.604, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 20.13, '3.5%': 17.26, '4%': 15.1, '4.5%': 13.42, '5%': 12.08, '5.5%': 10.98, '6%': 10.07, '6.5%': 9.32, '7%': 8.63 } },
      { id: '20', code: '600886.SH', name: '国投电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.457, dividend2025: 0.508, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 16.93, '3.5%': 14.51, '4%': 12.7, '4.5%': 11.29, '5%': 10.16, '5.5%': 9.24, '6%': 8.47, '6.5%': 7.82, '7%': 7.26 } },
      { id: '21', code: '600900.SH', name: '长江电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.943, dividend2025: 1.000, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 33.33, '3.5%': 28.57, '4%': 25, '4.5%': 22.22, '5%': 20, '5.5%': 18.18, '6%': 16.67, '6.5%': 15.38, '7%': 14.29 } },
      { id: '22', code: '600795.SH', name: '国电电力', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.110, dividend2025: 0.241, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 8.03, '3.5%': 6.88, '4%': 6.03, '4.5%': 5.36, '5%': 4.82, '5.5%': 4.38, '6%': 4.02, '6.5%': 3.70, '7%': 3.44 } },
      { id: '23', code: '600011.SH', name: '华能国际', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.270, dividend2025: 0.400, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 13.33, '3.5%': 11.43, '4%': 10, '4.5%': 8.89, '5%': 8, '5.5%': 7.27, '6%': 6.67, '6.5%': 6.15, '7%': 5.71 } },
      { id: '24', code: '601985.SH', name: '中国核电', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.160, dividend2025: 0.180, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 6, '3.5%': 5.14, '4%': 4.5, '4.5%': 4, '5%': 3.6, '5.5%': 3.27, '6%': 3, '6.5%': 2.77, '7%': 2.57 } },
      { id: '25', code: '003816.SZ', name: '中国广核', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.095, dividend2025: 0.086, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 2.87, '3.5%': 2.46, '4%': 2.15, '4.5%': 1.91, '5%': 1.72, '5.5%': 1.56, '6%': 1.43, '6.5%': 1.32, '7%': 1.23 } },
      { id: '26', code: '600938.SH', name: '中国海油', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 1.290, dividend2025: 1.145, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 38.17, '3.5%': 32.71, '4%': 28.63, '4.5%': 25.44, '5%': 22.9, '5.5%': 20.82, '6%': 19.08, '6.5%': 17.62, '7%': 16.36 } },
      { id: '27', code: '600941.SH', name: '中国移动', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.290, dividend2025: 2.200, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 73.33, '3.5%': 62.86, '4%': 55, '4.5%': 48.89, '5%': 44, '5.5%': 40, '6%': 36.67, '6.5%': 33.85, '7%': 31.43 } },
      { id: '28', code: '601088.SH', name: '中国神华', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 2.260, dividend2025: 2.010, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 67, '3.5%': 57.43, '4%': 50.25, '4.5%': 44.67, '5%': 40.2, '5.5%': 36.55, '6%': 33.5, '6.5%': 30.92, '7%': 28.71 } },
      { id: '29', code: '561580.SH', name: '央企红利ETF华泰柏瑞', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0, dividend2025: 0.0095, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 0.32, '3.5%': 0.27, '4%': 0.24, '4.5%': 0.21, '5%': 0.19, '5.5%': 0.17, '6%': 0.16, '6.5%': 0.15, '7%': 0.14 } },
      { id: '30', code: '515080.SH', name: '中证红利ETF招商', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.070, dividend2025: 0.065, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 2.17, '3.5%': 1.86, '4%': 1.63, '4.5%': 1.44, '5%': 1.3, '5.5%': 1.18, '6%': 1.08, '6.5%': 1, '7%': 0.93 } },
      { id: '31', code: '000001.SZ', name: '平安银行', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.608, dividend2025: 0.596, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 19.87, '3.5%': 17.03, '4%': 14.9, '4.5%': 13.25, '5%': 11.92, '5.5%': 10.84, '6%': 9.93, '6.5%': 9.17, '7%': 8.51 } },
      { id: '32', code: '000768.SZ', name: '中航西飞', price: 0, changePercent: 0, high: 0, low: 0, dividend2024: 0.120, dividend2025: 0.150, dividendRate2025: 0, priceUpdatedAt: null, dividendRates: { '3%': 5, '3.5%': 4.29, '4%': 3.75, '4.5%': 3.33, '5%': 3, '5.5%': 2.73, '6%': 2.5, '6.5%': 2.31, '7%': 2.14 } },
    ];
    setStocks(defaultStocks);
    setStockSettings({
      tagColors: {},
      visibleColumns: ['code', 'name', 'price', 'changePercent', 'high', 'low', 'dividend2024', 'dividend2025', 'dividendRate2025', 'dividendRates'],
      dividendRateColumns: ['3%', '3.5%', '4%', '4.5%', '5%', '5.5%', '6%', '6.5%', '7%'],
      dividendRateColorRanges: [
        { min: 0, max: 4.5, color: 'red' },
        { min: 4.5, max: 5.5, color: 'yellow' },
        { min: 5.5, max: 100, color: 'green' }
      ]
    });
  };

  // Modal States
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isEditingCapital, setIsEditingCapital] = useState(false);

  // 5. Preview Type
  const [previewType, setPreviewType] = useState<OrderType>(() => {
    const saved = localStorage.getItem('gold_preview_type');
    return (saved === 'SELL') ? 'SELL' : 'BUY';
  });
  
  const [activeSimPanel, setActiveSimPanel] = useState<'manual' | 'plan' | 'none'>('manual');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const marketPriceInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const gramsInputRef = useRef<HTMLInputElement>(null);

  const [dividendRate, setDividendRate] = useState(() => {
    const saved = localStorage.getItem('gold_dividend_rate');
    return saved || '0';
  }); // 年收益率（百分比）
  const [dividendPeriod, setDividendPeriod] = useState(() => {
    const saved = localStorage.getItem('gold_dividend_period');
    return saved || '12';
  }); // 分红周期（月）

  // --- Refs for Event Listeners (Prevent Stale Closures in Touch/Wheel Handlers) ---
  const marketPriceValueRef = useRef(marketPrice);
  useEffect(() => {
    marketPriceValueRef.current = marketPrice;
  }, [marketPrice]);

  // --- Effects: Auto-save locally ---
  
  useEffect(() => {
    localStorage.setItem('gold_trades_local', JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem('gold_inputs_draft', JSON.stringify(inputs));
  }, [inputs]);

  useEffect(() => {
    localStorage.setItem('gold_dividend_rate', dividendRate);
  }, [dividendRate]);

  useEffect(() => {
    localStorage.setItem('gold_dividend_period', dividendPeriod);
  }, [dividendPeriod]);

  useEffect(() => {
    localStorage.setItem('gold_market_price', marketPrice);
  }, [marketPrice]);

  useEffect(() => {
    localStorage.setItem('gold_preview_type', previewType);
  }, [previewType]);

  useEffect(() => {
    localStorage.setItem('gold_app_settings', JSON.stringify(appSettings));
  }, [appSettings]);


  // --- Position Calculation ---
  const currentPosition: HoldingState = useMemo(() => {
    let grams = 0;
    let totalCost = 0;
    let realizedPnL = 0;

    trades.forEach(t => {
      if (t.isDisabled) return;
      if (t.type === 'DIVIDEND') {
        realizedPnL += t.dividendAmount || 0;
        return;
      }
      const tradeValue = t.grams * t.price;
      if (t.type === 'BUY') {
        grams += t.grams;
        totalCost += tradeValue;
      } else {
        const currentAvg = grams > 0 ? totalCost / grams : 0;
        const costBasis = t.grams * currentAvg;
        grams = Math.max(0, grams - t.grams);
        totalCost -= costBasis; 
        realizedPnL += (tradeValue - costBasis);
      }
    });

    if (grams < 0.0001) { grams = 0; totalCost = 0; }
    const avgCost = grams > 0 ? totalCost / grams : 0;
    const breakEvenPrice = grams > 0 ? Math.max(0, (totalCost - realizedPnL) / grams) : 0;
    return { grams, avgCost, totalCost, realizedPnL, breakEvenPrice };
  }, [trades]);

  const availableFunds = Math.max(0, (appSettings.totalCapital || 0) - currentPosition.totalCost);

  const floatingPnL = useMemo(() => {
    const market = parseFloat(marketPrice) || 0;
    if (market <= 0 || currentPosition.grams <= 0) return 0;
    return (market - currentPosition.avgCost) * currentPosition.grams;
  }, [marketPrice, currentPosition]);

  // 税费统计（不纳入盈亏计算，仅作为独立参考）
  const taxFeeStats = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    trades.forEach(t => {
      if (t.isDisabled) return;
      if (t.type === 'BUY') buyCount++;
      else sellCount++;
    });
    const buyTaxFeeTotal = buyCount * (appSettings.buyTaxFee || 5);
    const sellTaxFeeTotal = sellCount * (appSettings.sellTaxFee || 5);
    return {
      buyCount,
      sellCount,
      buyTaxFeeTotal,
      sellTaxFeeTotal,
      totalTaxFee: buyTaxFeeTotal + sellTaxFeeTotal
    };
  }, [trades, appSettings.buyTaxFee, appSettings.sellTaxFee]);

  // 收益率统计（依赖总资金）
  const returnRateStats = useMemo(() => {
    const totalCapital = appSettings.totalCapital || 0;
    if (totalCapital <= 0) {
      return {
        floatingReturnRate: null,
        realizedReturnRate: null,
        totalReturnRate: null
      };
    }
    const floatingReturnRate = (floatingPnL / totalCapital) * 100;
    const realizedReturnRate = (currentPosition.realizedPnL / totalCapital) * 100;
    const totalReturnRate = ((floatingPnL + currentPosition.realizedPnL) / totalCapital) * 100;
    return {
      floatingReturnRate,
      realizedReturnRate,
      totalReturnRate
    };
  }, [floatingPnL, currentPosition.realizedPnL, appSettings.totalCapital]);

  // --- Handlers ---
  const handleInputChange = (field: keyof typeof inputs, value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    
    let processedValue = value;
    const numVal = parseFloat(value) || 0;

    if (field === 'grams' && previewType === 'SELL') {
      if (numVal > currentPosition.grams) {
        processedValue = currentPosition.grams.toString();
      }
    }

    if (previewType === 'BUY' && field === 'grams') {
      if (value.includes('.')) {
        processedValue = value.split('.')[0];
      }
    }

    if (previewType === 'BUY' && appSettings.totalCapital && appSettings.totalCapital > 0) {
      const availableCapital = appSettings.totalCapital - currentPosition.totalCost;
      const otherField = field === 'grams' ? 'price' : 'grams';
      // Use the current input state for the other field
      const otherVal = parseFloat(inputs[otherField]) || 0;
      
      if (availableCapital > 0) {
        if (numVal * otherVal > availableCapital) {
          if (field === 'grams' && otherVal > 0) {
            const maxGrams = availableCapital / otherVal;
            processedValue = Math.floor(maxGrams).toString();
          } else if (field === 'price' && otherVal > 0) {
            const maxPrice = availableCapital / otherVal;
            processedValue = (Math.floor(maxPrice * 100) / 100).toString();
          }
        }
      } else {
        // No available capital, force to 0 if they try to enter a positive number
        if (numVal > 0) {
          processedValue = "0";
        }
      }
    }
    
    setInputs(prev => ({ ...prev, [field]: processedValue }));
  };

  const handleMarketPriceChange = (value: string) => {
    if (!/^\d*\.?\d*$/.test(value)) return;
    setMarketPrice(value);
    
    // Real-time synchronization: Update simulation input price when market price changes
    setInputs(prev => {
      let newGrams = prev.grams;
      const newPriceNum = parseFloat(value) || 0;
      const currentGramsNum = parseFloat(prev.grams) || 0;
      
      if (previewType === 'BUY' && appSettings.totalCapital && appSettings.totalCapital > 0) {
        const availableCapital = appSettings.totalCapital - currentPosition.totalCost;
        if (availableCapital > 0) {
          if (newPriceNum * currentGramsNum > availableCapital && newPriceNum > 0) {
            const maxGrams = availableCapital / newPriceNum;
            newGrams = (Math.floor(maxGrams * 100) / 100).toString();
          }
        } else if (currentGramsNum > 0) {
          newGrams = "0";
        }
      }
      
      return { price: value, grams: newGrams };
    });
  };

  // Keep a ref to the handler to use in Effect without triggering re-binds
  const handleMarketPriceChangeRef = useRef(handleMarketPriceChange);
  useEffect(() => {
    handleMarketPriceChangeRef.current = handleMarketPriceChange;
  }, [handleMarketPriceChange]);

  // Sync market price with the latest active trade when trades change
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const activeTrades = trades.filter(t => !t.isDisabled && !t.isPlan && t.type !== 'DIVIDEND');
    if (activeTrades.length > 0) {
      const latestTrade = activeTrades[activeTrades.length - 1];
      const priceStr = latestTrade.price.toString();
      if (priceStr !== marketPriceValueRef.current) {
        handleMarketPriceChangeRef.current(priceStr);
      }
    }
  }, [trades]);

  const updateMarketPrice = (delta: number) => {
    const currentVal = parseFloat(marketPrice) || 0;
    const nextVal = Math.max(0, currentVal + delta);
    const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
    handleMarketPriceChange(nextStr);
  };

  // Switch Order Type logic: keeps price and grams unchanged
  const changeOrderType = (type: OrderType) => {
    setPreviewType(type);
  };

  // Wheel listener for Market Price
  useEffect(() => {
    const el = marketPriceInputRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      updateMarketPrice(direction * appSettings.priceStep);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [marketPrice, appSettings.priceStep]);

  // Touch listener for Market Price (Slide to adjust)
  useEffect(() => {
    if (!appSettings.touchMode || !marketPriceInputRef.current) return;
    
    const el = marketPriceInputRef.current;
    let lastY = 0;
    const threshold = 15;
    let accumulator = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      lastY = e.touches[0].clientY;
      accumulator = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      
      if (e.cancelable) e.preventDefault();
      
      const currentY = e.touches[0].clientY;
      const deltaY = lastY - currentY; 
      
      accumulator += deltaY;
      
      const steps = Math.floor(Math.abs(accumulator) / threshold);
      
      if (steps > 0) {
         const direction = accumulator > 0 ? 1 : -1;
         
         const currentVal = parseFloat(marketPriceValueRef.current) || 0;
         const changeAmount = direction * appSettings.priceStep * steps;
         const nextVal = Math.max(0, currentVal + changeAmount);
         const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
         
         handleMarketPriceChangeRef.current(nextStr);
         
         accumulator -= (direction * steps * threshold);
      }
      
      lastY = currentY;
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [appSettings.touchMode, appSettings.priceStep]);

  // --- Cloud & Settings Handlers ---
  const handleSaveSettings = (newGithubConfig: GithubConfig, newAppSettings: AppSettings, newStockSettings?: StockSettings) => {
    console.log('handleSaveSettings 被调用, newStockSettings:', newStockSettings);
    setGithubConfig(newGithubConfig);
    localStorage.setItem('gold_github_config', JSON.stringify(newGithubConfig));
    setAppSettings(newAppSettings);
    if (newStockSettings) {
      console.log('保存 stockSettings 到 localStorage:', newStockSettings);
      setStockSettings(newStockSettings);
      localStorage.setItem('stock_dividend_settings', JSON.stringify(newStockSettings));
    }
  };
  
  const handleSettingsUpdate = (updates: Partial<AppSettings>) => {
    setAppSettings(prev => ({ ...prev, ...updates }));
  };

  const openSettings = (tab: 'general' | 'cloud' = 'general') => {
    setSettingsDefaultTab(tab);
    setIsSettingsOpen(true);
  };

  const requestCloudAction = (action: 'upload' | 'download') => {
    if (!githubConfig.token) {
        if (action === 'download') alert("请先配置 GitHub Token");
        openSettings('cloud');
        return;
    }
    if (action === 'download' && !githubConfig.gistId) {
        alert("无法下载：未检测到 Gist ID。\n\n• 如果您是首次使用，请先点击「上传」按钮来创建新备份。\n• 如果您要恢复已有数据，请在设置中填入您的 Gist ID。");
        openSettings('cloud');
        return;
    }
    setCloudConfirm(action);
  };

  const handleCloudUpload = async () => {
    setCloudConfirm(null);
    setIsSyncing(true);
    setUploadSuccess(false);
    try {
      let existingTrades: TradeRecord[] = [];
      let existingSettings: AppSettings | undefined;
      let existingStocks: StockEntry[] = [];
      let existingStockSettings: StockSettings | undefined;
      
      if (githubConfig.gistId) {
        try {
          const existing = await loadFromGist(githubConfig.token, githubConfig.gistId);
          if (existing) {
            existingTrades = existing.trades || [];
            existingSettings = existing.settings;
            existingStocks = existing.stocks || [];
            existingStockSettings = existing.stockSettings;
          }
        } catch {
        }
      }
      
      let dataToUpload;
      if (currentPage === 'gold') {
        dataToUpload = {
          trades,
          settings: appSettings,
          stocks: existingStocks,
          stockSettings: existingStockSettings
        };
      } else {
        dataToUpload = {
          trades: existingTrades,
          settings: existingSettings,
          stocks,
          stockSettings
        };
      }
      
      const newGistId = await saveToGist(
        githubConfig.token, 
        dataToUpload, 
        githubConfig.gistId || undefined
      );
      
      if (newGistId && newGistId !== githubConfig.gistId) {
        const newConfig = { ...githubConfig, gistId: newGistId };
        setGithubConfig(newConfig);
        localStorage.setItem('gold_github_config', JSON.stringify(newConfig));
      }
      
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 2000);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCloudDownload = async () => {
    setCloudConfirm(null);
    setIsDownloading(true);
    setDownloadSuccess(false);
    try {
      const result = await loadFromGist(githubConfig.token, githubConfig.gistId);
      if (result) {
        if (currentPage === 'gold') {
          setTrades(result.trades);
          
          if (result.settings) {
            setAppSettings(prev => ({
              ...prev,
              ...result.settings
            }));
          }
        } else {
          if (result.stocks) {
            setStocks(result.stocks);
          }
          
          if (result.stockSettings) {
            setStockSettings(result.stockSettings);
            localStorage.setItem('stock_dividend_settings', JSON.stringify(result.stockSettings));
          }
        }
        
        setDownloadSuccess(true);
        setTimeout(() => setDownloadSuccess(false), 2000);
      }
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setIsDownloading(false);
    }
  };

  // --- Data Persistence Handlers ---

  const handleExportClick = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    
    setExportFileName(`gold-trades-${timestamp}`);
    setShowExportModal(true);
  };

  const confirmExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportFileName.trim()) return;

    const exportData = {
      version: 1,
      timestamp: Date.now(),
      trades: trades,
      settings: appSettings
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    let fileName = exportFileName.trim();
    if (!fileName.toLowerCase().endsWith('.json')) {
      fileName += '.json';
    }
    
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setShowExportModal(false);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const processFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result === 'string') {
          const parsed = JSON.parse(result);
          
          if (Array.isArray(parsed)) {
            const isValid = parsed.every(t => t.id && t.type && typeof t.price === 'number');
            if (isValid) {
              setTrades(parsed);
              alert(`成功导入 ${parsed.length} 条交易记录`);
            } else {
              alert('文件格式错误：无效的交易记录');
            }
            return;
          }
          
          if (parsed.trades && Array.isArray(parsed.trades)) {
             setTrades(parsed.trades);
             if (parsed.settings) setAppSettings(prev => ({ ...prev, ...parsed.settings }));
             alert(`成功导入 ${parsed.trades.length} 条交易记录`);
             return;
          }
          
          alert('无法识别的文件格式');
        }
      } catch (error) {
        alert('文件解析失败');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/json" || file.name.endsWith('.json')) {
        processFile(file);
      } else {
        alert("请拖入 JSON 文件");
      }
    }
  };

  const getSimulation = (type: OrderType): SimulationResult => {
    const price = parseFloat(inputs.price) || 0;
    const grams = parseFloat(inputs.grams) || 0;
    let newTotalGrams = 0;
    let newTotalCost = 0;
    let projectedPnL = 0;
    let newRealizedPnL = currentPosition.realizedPnL;

    if (type === 'BUY') {
      newTotalGrams = currentPosition.grams + grams;
      newTotalCost = currentPosition.totalCost + (price * grams);
    } else {
      newTotalGrams = Math.max(0, currentPosition.grams - grams);
      const costBasis = grams * currentPosition.avgCost;
      newTotalCost = currentPosition.totalCost - costBasis;
      projectedPnL = (price * grams) - costBasis;
      newRealizedPnL += projectedPnL;
    }

    const newAvgCost = newTotalGrams > 0 ? newTotalCost / newTotalGrams : 0;
    const newBreakEvenPrice = newTotalGrams > 0 ? Math.max(0, (newTotalCost - newRealizedPnL) / newTotalGrams) : 0;
    
    const costDifference = currentPosition.avgCost > 0 
      ? ((newAvgCost - currentPosition.avgCost) / currentPosition.avgCost) * 100 
      : 0;
    
    const totalValueChange = currentPosition.totalCost > 0
      ? ((newTotalCost - currentPosition.totalCost) / currentPosition.totalCost) * 100
      : (currentPosition.totalCost === 0 && newTotalCost > 0 ? 100 : 0);

    return { 
      newTotalGrams, 
      newAvgCost, 
      newBreakEvenPrice,
      totalInvestment: newTotalCost, 
      costDifference, 
      totalValueChange,
      projectedPnL: type === 'SELL' ? projectedPnL : undefined 
    };
  };

  const simulation = useMemo(() => getSimulation(previewType), [currentPosition, inputs, previewType]);

  const executeTrade = () => {
    const type = previewType;
    const price = parseFloat(inputs.price);
    const grams = parseFloat(inputs.grams);
    if (!price || !grams) return;
    if (type === 'SELL' && grams > currentPosition.grams) { alert("卖出数量不能大于持仓量"); return; }
    const newTrade: TradeRecord = { id: Date.now().toString(), type, price, grams, timestamp: Date.now(), isDisabled: false };
    setTrades(prev => [...prev, newTrade]);
    setMarketPrice(inputs.price);
    setInputs({ price: inputs.price, grams: inputs.grams }); // Keep both price and grams
    setAiState({ loading: false, result: null, error: null });
  };

  // 回车键处理：在两个输入框之间智能跳转或触发成交
  const handlePriceEnter = () => {
    const price = parseFloat(inputs.price);
    const grams = parseFloat(inputs.grams);
    if (price > 0 && grams > 0) {
      // 两个都有合法值：直接成交，不取消焦点，方便连续修改
      executeTrade();
    } else if (price > 0 && !grams) {
      // 只有价格合法：聚焦到数量输入框
      gramsInputRef.current?.focus();
      gramsInputRef.current?.select();
    }
  };

  const handleGramsEnter = () => {
    const price = parseFloat(inputs.price);
    const grams = parseFloat(inputs.grams);
    if (price > 0 && grams > 0) {
      // 两个都有合法值：直接成交，不取消焦点
      executeTrade();
    } else if (grams > 0 && !price) {
      // 只有数量合法：聚焦到价格输入框
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    }
  };

  // 处理 [ 和 ] 键切换买入/卖出，' 键来回切换
  const handleTypeSwitch = (key: string): boolean => {
    if (key === '[') {
      changeOrderType('BUY');
      return true;
    } else if (key === ']') {
      changeOrderType('SELL');
      return true;
    } else if (key === "'") {
      // 来回切换：买入变卖出，卖出变买入
      changeOrderType(previewType === 'BUY' ? 'SELL' : 'BUY');
      return true;
    }
    return false;
  };

  // 处理 Tab 键在两个输入框间循环切换
  const handlePriceTab = (): boolean => {
    gramsInputRef.current?.focus();
    gramsInputRef.current?.select();
    return true;
  };

  const handleGramsTab = (): boolean => {
    priceInputRef.current?.focus();
    priceInputRef.current?.select();
    return true;
  };

  const handleApplyPlan = (planTrades: TradeRecord[]) => {
    // Remove existing plan trades
    setTrades(prev => {
      const filtered = prev.filter(t => !t.isPlan);
      return [...filtered, ...planTrades];
    });
  };

  // 处理分红结算
  const handleDividendSettlement = () => {
    const rate = parseFloat(dividendRate);
    const period = parseFloat(dividendPeriod);
    if (rate <= 0 || period <= 0) return;

    const currentMarketPrice = parseFloat(marketPrice) || 0;
    const positionValue = currentMarketPrice * currentPosition.grams;
    if (positionValue <= 0) return;

    const singleDividendRate = rate / 100 * (period / 12);
    const dividendAmount = positionValue * singleDividendRate;
    if (dividendAmount <= 0) return;

    const dividendTrade: TradeRecord = {
      id: `trade-${Date.now()}`,
      type: 'DIVIDEND',
      grams: 0,
      price: 0,
      timestamp: Date.now(),
      tag: '分红',
      dividendAmount,
      annualDividendRate: rate,
      dividendPeriodMonths: period,
      positionValue
    };

    setTrades(prev => [...prev, dividendTrade]);
  };

  const handleClearPlan = () => {
    setTrades(prev => prev.filter(t => !t.isPlan));
  };

  const hasPlan = useMemo(() => trades.some(t => t.isPlan), [trades]);

  const deleteTrade = (id: string) => setTrades(prev => prev.filter(t => t.id !== id));
  const updateTrade = (id: string, updates: Partial<TradeRecord>) => setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  const handleReorderTrades = (newTrades: TradeRecord[]) => setTrades(newTrades);

  const requestReset = () => setShowResetConfirm(true);
  const confirmReset = () => {
    setTrades([]);
    setInputs({ price: '', grams: '' });
    setMarketPrice('');
    setAiState({ loading: false, result: null, error: null });
    setPreviewType('BUY');
    setShowResetConfirm(false);
  };

  const handleAIAnalysis = async () => {
    const order: OrderState = { price: parseFloat(inputs.price) || 0, grams: parseFloat(inputs.grams) || 0 };
    if (!order.price || !order.grams) return;
    setAiState({ loading: true, result: null, error: null });
    const resultText = await analyzeTrade(currentPosition, order, previewType === 'BUY', simulation);
    setAiState({ loading: false, result: resultText, error: null });
  };

  const renderPriceLabel = (baseLabel: string) => {
    const isAvg = baseLabel.includes('均价') || baseLabel.includes('平均成本');
    if (!isAvg) return baseLabel;
    
    if (appSettings.priceDisplayMode === 'breakEven') return baseLabel.replace('均价', '回本价').replace('平均成本', '回本价');
    if (appSettings.priceDisplayMode === 'avgCost') return baseLabel.replace('回本价', '持仓均价').replace('平均成本', '持仓均价');
    return (
      <span className="flex flex-col leading-tight">
        <span>{baseLabel.replace('均价', '回本价').replace('平均成本', '回本价')}</span>
        <span className="text-[10px] opacity-70">持仓均价</span>
      </span>
    );
  };

  const renderPriceValue = (breakEven: number, avgCost: number, smallClassName: string = "text-sm text-app-subtext") => {
    if (appSettings.priceDisplayMode === 'breakEven') return breakEven.toFixed(2);
    if (appSettings.priceDisplayMode === 'avgCost') return avgCost.toFixed(2);
    return (
      <span className="flex flex-col leading-tight">
        <span>{breakEven.toFixed(2)}</span>
        <span className={smallClassName}>{avgCost.toFixed(2)}</span>
      </span>
    );
  };

  const renderPriceDiff = (newBreakEven: number, oldBreakEven: number, newAvg: number, oldAvg: number) => {
    const diffBreakEven = newBreakEven - oldBreakEven;
    const diffAvg = newAvg - oldAvg;
    
    const renderSingleDiff = (diff: number) => {
      if (Math.abs(diff) < 0.001) return <div className="flex items-center h-4 text-xs text-app-subtext font-mono">-</div>;
      return (
        <div className={`flex items-center h-4 text-xs font-bold font-mono ${diff < 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            {diff > 0 ? (
              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current mr-1" />
            ) : (
              <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current mr-1" />
            )}
            {Math.abs(diff).toFixed(2)}
        </div>
      );
    };

    if (appSettings.priceDisplayMode === 'breakEven') return renderSingleDiff(diffBreakEven);
    if (appSettings.priceDisplayMode === 'avgCost') return renderSingleDiff(diffAvg);
    
    return (
      <div className="flex flex-col items-end leading-tight">
        {renderSingleDiff(diffBreakEven)}
        <div className="opacity-70 scale-90 origin-right">
          {renderSingleDiff(diffAvg)}
        </div>
      </div>
    );
  };

  const renderActionButtons = () => (
    <div className="relative">
      {/* Cloud Confirmation Popover */}
      {cloudConfirm && (
        <div 
          className="absolute bottom-full mb-3 z-[100] animate-in fade-in zoom-in slide-in-from-bottom-2 duration-200 pointer-events-none"
          style={{ 
            left: cloudConfirm === 'download' 
              ? 'calc((100% / 7) * 1 + (100% / 14))' 
              : 'calc((100% / 7) * 2 + (100% / 14))',
            transform: 'translateX(-50%)'
          }}
        >
           <div className="bg-app-card border border-app-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-xl p-3 flex flex-col items-center text-center w-max min-w-[160px] max-w-[200px] pointer-events-auto">
              <div className="text-brand-yellow mb-1.5">
                 <AlertTriangle size={18} />
              </div>
              <h4 className="text-xs font-bold text-app-text mb-0.5 whitespace-nowrap">
                {cloudConfirm === 'upload' ? '确定上传？' : '确定下载？'}
              </h4>
              <p className="text-[10px] text-app-subtext mb-3 leading-tight">
                {cloudConfirm === 'upload' 
                   ? '覆盖云端备份数据' 
                   : '覆盖本地交易记录'}
              </p>
              <div className="grid grid-cols-2 gap-1.5 w-full">
                 <button 
                   onClick={() => setCloudConfirm(null)}
                   className="py-1 rounded-lg border border-app-border text-[10px] text-app-subtext hover:bg-app-input transition-colors font-medium"
                 >
                   取消
                 </button>
                 <button 
                   onClick={cloudConfirm === 'upload' ? handleCloudUpload : handleCloudDownload}
                   className={`py-1 rounded-lg text-[10px] text-white font-bold transition-opacity hover:opacity-90 ${cloudConfirm === 'upload' ? 'bg-brand-yellow' : 'bg-indigo-600'}`}
                 >
                   确定
                 </button>
              </div>
              <div 
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-app-card border-r border-b border-app-border rotate-45"
              ></div>
           </div>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 lg:gap-2">
          <button 
              onClick={() => openSettings('general')}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
              title="设置"
            >
              <Settings size={16} />
          </button>
          
          <button 
              onClick={() => requestCloudAction('download')}
              disabled={isDownloading || downloadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all ${downloadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-indigo-400 hover:text-indigo-300 hover:border-indigo-500'} disabled:opacity-30`}
              title="从云端下载"
            >
              {isDownloading ? (
                <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              ) : downloadSuccess ? (
                <Check size={16} className="animate-in zoom-in duration-300" />
              ) : (
                <CloudDownload size={16} />
              )}
          </button>

          <button 
              onClick={() => requestCloudAction('upload')}
              disabled={isSyncing || uploadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all ${uploadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-brand-yellow hover:bg-brand-yellow/10 hover:border-brand-yellow'} disabled:opacity-30`}
              title="上传到云端"
            >
               {isSyncing ? (
                 <div className="w-4 h-4 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin"></div>
               ) : uploadSuccess ? (
                 <Check size={16} className="animate-in zoom-in duration-300" />
               ) : (
                 <CloudUpload size={16} />
               )}
          </button>

          <button 
              onClick={handleExportClick}
              disabled={trades.length === 0}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors disabled:opacity-50"
              title="导出数据"
            >
              <Download size={16} />
          </button>

          <button 
              onClick={handleImportClick} 
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors"
              title="导入数据"
            >
              <Upload size={16} />
          </button>

          <button 
              onClick={requestReset} 
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-red-400 hover:border-red-400 transition-colors"
              title="重置"
            >
              <RefreshCcw size={16} />
          </button>

          <button
              onClick={toggleTheme}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-brand-yellow hover:border-brand-yellow transition-colors"
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
      </div>
    </div>
  );

  const renderStockActionButtons = () => (
    <div className="relative">
      {cloudConfirm && (
        <div 
          className="absolute bottom-full mb-3 z-[100] animate-in fade-in zoom-in slide-in-from-bottom-2 duration-200 pointer-events-none"
          style={{ 
            left: cloudConfirm === 'download' 
              ? 'calc((100% / 6) * 1 + (100% / 12))' 
              : 'calc((100% / 6) * 2 + (100% / 12))',
            transform: 'translateX(-50%)'
          }}
        >
           <div className="bg-app-card border border-app-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-xl p-3 flex flex-col items-center text-center w-max min-w-[160px] max-w-[200px] pointer-events-auto">
              <div className="text-brand-yellow mb-1.5">
                 <AlertTriangle size={18} />
              </div>
              <h4 className="text-xs font-bold text-app-text mb-0.5 whitespace-nowrap">
                {cloudConfirm === 'upload' ? '确定上传？' : '确定下载？'}
              </h4>
              <p className="text-[10px] text-app-subtext mb-3 leading-tight">
                {cloudConfirm === 'upload' 
                   ? '覆盖云端备份数据' 
                   : '覆盖本地交易记录'}
              </p>
              <div className="grid grid-cols-2 gap-1.5 w-full">
                 <button 
                   onClick={() => setCloudConfirm(null)}
                   className="py-1 rounded-lg border border-app-border text-[10px] text-app-subtext hover:bg-app-input transition-colors font-medium"
                 >
                   取消
                 </button>
                 <button 
                   onClick={cloudConfirm === 'upload' ? handleCloudUpload : handleCloudDownload}
                   className={`py-1 rounded-lg text-[10px] text-white font-bold transition-opacity hover:opacity-90 ${cloudConfirm === 'upload' ? 'bg-brand-yellow' : 'bg-indigo-600'}`}
                 >
                   确定
                 </button>
              </div>
              <div 
                className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-app-card border-r border-b border-app-border rotate-45"
              ></div>
           </div>
        </div>
      )}

      <div className="flex gap-1 lg:gap-2">
          <button 
              onClick={() => openSettings('general')}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors w-10"
              title="设置"
            >
              <Settings size={16} />
          </button>
          <button 
              onClick={() => requestCloudAction('download')}
              disabled={isDownloading || downloadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all w-10 ${downloadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-indigo-400 hover:text-indigo-300 hover:border-indigo-500'} disabled:opacity-30`}
              title="从云端下载"
            >
              {isDownloading ? (
                <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              ) : downloadSuccess ? (
                <CheckCircle2 size={16} className="animate-in zoom-in duration-300" />
              ) : (
                <CloudDownload size={16} />
              )}
          </button>
          <button 
              onClick={() => requestCloudAction('upload')}
              disabled={isSyncing || uploadSuccess || !!cloudConfirm}
              className={`flex items-center justify-center bg-app-card border border-app-border py-2.5 rounded-md transition-all w-10 ${uploadSuccess ? 'text-brand-green border-brand-green bg-brand-green/10' : 'text-brand-yellow hover:bg-brand-yellow/10 hover:border-brand-yellow'} disabled:opacity-30`}
              title="上传到云端"
            >
              {isSyncing ? (
                <div className="w-4 h-4 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin"></div>
              ) : uploadSuccess ? (
                <CheckCircle2 size={16} className="animate-in zoom-in duration-300" />
              ) : (
                <CloudUpload size={16} />
              )}
          </button>
          <button 
              onClick={() => setIsAddingStock(true)}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-app-text hover:border-app-text transition-colors w-10"
              title="添加股票"
            >
              <Plus size={16} />
          </button>
          <button 
              onClick={() => { if (confirm('确定要重置所有股票数据吗？')) resetStockData(); }}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-red-400 hover:border-red-400 transition-colors w-10"
              title="重置数据"
            >
              <Trash2 size={16} />
          </button>
          <button
              onClick={toggleTheme}
              className="flex items-center justify-center bg-app-card border border-app-border text-app-subtext py-2.5 rounded-md hover:text-brand-yellow hover:border-brand-yellow transition-colors w-10"
              title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
      </div>
    </div>
  );

  return (
    <div 
      className="min-h-screen bg-app-bg text-app-text font-sans p-4 md:p-8 flex justify-center relative transition-colors duration-300"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <CloudSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        githubConfig={githubConfig}
        appSettings={appSettings}
        stockSettings={stockSettings}
        currentPage={currentPage === 'gold' ? 'gold' : 'stock'}
        onSave={handleSaveSettings}
        initialTab={settingsDefaultTab}
      />

      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowExportModal(false)}>
          <div className="bg-app-card border border-app-border rounded-xl w-full max-w-sm shadow-2xl relative p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-app-text">导出数据</h3>
              <button onClick={() => setShowExportModal(false)} className="text-app-subtext hover:text-app-text transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={confirmExport} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-app-subtext font-medium">文件名称</label>
                <div className="flex items-center relative">
                  <input type="text" value={exportFileName} onChange={(e) => setExportFileName(e.target.value)} className="w-full bg-app-input border border-app-border rounded-lg pl-3 pr-14 py-2 text-app-text focus:border-brand-yellow outline-none transition-all font-mono text-sm" autoFocus />
                  <span className="absolute right-3 text-app-subtext text-xs pointer-events-none">.json</span>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowExportModal(false)} className="flex-1 py-2.5 rounded-lg border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text font-medium text-sm">取消</button>
                <button type="submit" disabled={!exportFileName.trim()} className="flex-1 py-2.5 rounded-lg bg-brand-yellow text-slate-900 hover:bg-[#fdd835] font-bold text-sm disabled:opacity-50">确认导出</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowResetConfirm(false)}>
          <div className="bg-app-card border border-app-border rounded-xl w-full max-sm shadow-2xl relative p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
             <div className="flex justify-between items-center">
               <h3 className="text-lg font-bold text-app-text">确认重置</h3>
                <button onClick={() => setShowResetConfirm(false)} className="text-app-subtext hover:text-app-text transition-colors"><X size={20} /></button>
             </div>
             <p className="text-app-subtext text-sm leading-relaxed">确定要清空所有交易记录和临时输入吗？<br/><span className="text-brand-red font-bold">此操作无法撤销。</span></p>
             <div className="flex gap-2 pt-2">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 rounded-lg border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text font-medium text-sm">取消</button>
                <button onClick={confirmReset} className="flex-1 py-2.5 rounded-lg bg-brand-red text-white hover:bg-red-500 font-bold text-sm">确认重置</button>
              </div>
          </div>
        </div>
      )}

      {isDragging && (
        <div className="absolute inset-0 bg-brand-yellow/10 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-brand-yellow m-4 rounded-3xl pointer-events-none text-center">
           <div><FileJson size={64} className="mx-auto text-brand-yellow mb-4" /><h3 className="text-2xl font-bold text-app-text">松开以导入数据</h3></div>
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".json" />

      <div className="max-w-[1400px] w-full pb-12 flex flex-col">
        {currentPage === 'gold' && (
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-app-subtext tracking-wide">黄金交易模拟</h1>
            <span className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text ml-1">{APP_VERSION}</span>
            <button
              onClick={togglePage}
              className="text-[10px] text-white/[0.01] font-mono select-all hover:text-app-text ml-1 transition-colors"
              title="切换到股票股息率计算器"
            >
              [股票]
            </button>
          </div>

        </header>
        )}

        {currentPage === 'gold' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6 items-start">
            <div className="lg:col-span-8 flex flex-col gap-6 order-2 lg:order-1">
               <div className="space-y-3">
                  <div className="flex items-center gap-2 text-app-subtext pl-1"><Wallet size={16} /><h3 className="font-medium text-sm">持仓详情</h3></div>
                  <div className="bg-app-card border border-app-border rounded-xl p-6 shadow-sm grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5 transition-colors relative group hover:border-indigo-500/50 focus-within:border-indigo-500">
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">总资金</span>
                              {isEditingCapital ? (
                                  <input 
                                      autoFocus
                                      type="number" 
                                      value={appSettings.totalCapital || ''} 
                                      onChange={(e) => handleSettingsUpdate({ totalCapital: parseFloat(e.target.value) || 0 })} 
                                      onBlur={() => setIsEditingCapital(false)}
                                      placeholder="0.00" 
                                      className="no-spinners text-sm font-bold text-app-text font-mono bg-transparent border-none p-0 text-right outline-none w-24" 
                                  />
                              ) : (
                                  <span 
                                      onClick={() => setIsEditingCapital(true)}
                                      className="text-sm font-bold font-mono text-app-text cursor-pointer hover:text-indigo-400 transition-colors"
                                  >
                                      {appSettings.totalCapital ? appSettings.totalCapital.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0.00'}
                                  </span>
                              )}
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">可用资金</span>
                              <span className="text-sm font-bold font-mono text-app-text">
                                  {appSettings.totalCapital ? (appSettings.totalCapital - currentPosition.totalCost).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}
                              </span>
                          </div>
                      </div>
                      <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">持仓净值</span>
                              <span className="text-sm font-bold font-mono text-app-text">
                                  {marketPrice ? (currentPosition.grams * (parseFloat(marketPrice) || 0)).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}
                              </span>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">持仓数量</span>
                              <span className="text-sm font-bold font-mono text-app-text">{currentPosition.grams.toFixed(2)} 克</span>
                          </div>
                      </div>
                      <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">持仓总投入</span>
                              <span className="text-sm font-bold font-mono text-app-text">
                                  {currentPosition.totalCost.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                              </span>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">仓位占比</span>
                              <span className="text-sm font-bold font-mono text-app-text">
                                  {appSettings.totalCapital && appSettings.totalCapital > 0 ? ((currentPosition.totalCost / appSettings.totalCapital) * 100).toFixed(1) + '%' : '--'}
                              </span>
                          </div>
                      </div>
                      <div className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5">
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">浮动盈亏</span>
                              <span className={`text-sm font-bold font-mono ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{marketPrice ? (floatingPnL > 0 ? '+' : '') + floatingPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">已实现盈亏</span>
                              <span className={`text-sm font-bold font-mono ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{currentPosition.realizedPnL >= 0 ? '+' : ''}{currentPosition.realizedPnL.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                          </div>
                      </div>
                      <div 
                          onClick={() => {
                              const nextMode = appSettings.priceDisplayMode === 'breakEven' ? 'avgCost' : 'breakEven';
                              handleSettingsUpdate({ priceDisplayMode: nextMode });
                          }}
                          className="bg-app-bg p-3 rounded-lg border border-app-border flex flex-col justify-center gap-1.5 cursor-pointer hover:border-brand-yellow/50 transition-colors"
                      >
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">回本价</span>
                              <span className={`text-sm font-bold font-mono ${parseFloat(marketPrice) > currentPosition.breakEvenPrice ? 'text-brand-red' : parseFloat(marketPrice) < currentPosition.breakEvenPrice ? 'text-brand-green' : 'text-app-text'}`}>{currentPosition.breakEvenPrice.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                              <span className="text-[11px] text-app-subtext">持仓均价</span>
                              <span className={`text-sm font-bold font-mono ${parseFloat(marketPrice) > currentPosition.avgCost ? 'text-brand-red' : parseFloat(marketPrice) < currentPosition.avgCost ? 'text-brand-green' : 'text-app-text'}`}>{currentPosition.avgCost.toFixed(2)}</span>
                          </div>
                      </div>
                      <div className="bg-app-bg p-3 rounded-lg border border-app-border relative group hover:border-brand-yellow/50 focus-within:border-brand-yellow transition-colors">
                          <span className="text-xs text-app-subtext block mb-1">参考市价 (元/克)</span>
                          <div className="flex items-center">
                              <input 
                                  ref={marketPriceInputRef} 
                                  type="number" 
                                  value={marketPrice} 
                                  onChange={(e) => handleMarketPriceChange(e.target.value)} 
                                  placeholder="0.00" 
                                  className={`no-spinners text-xl font-bold font-mono bg-transparent border-none p-0 w-full outline-none ${appSettings.touchMode ? 'cursor-ns-resize' : ''} text-app-text`} 
                              />
                              <div className="flex flex-col gap-0.5 ml-2">
                                  <button onClick={() => updateMarketPrice(appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronUp size={10} strokeWidth={3} /></button>
                                  <button onClick={() => updateMarketPrice(-appSettings.priceStep)} className="bg-app-text/5 hover:bg-brand-yellow/20 text-app-subtext hover:text-brand-yellow rounded-sm p-0.5"><ChevronDown size={10} strokeWidth={3} /></button>
                              </div>
                          </div>
                      </div>
                  </div>
               </div>
               <div className="space-y-3">
                 <div className="flex items-center gap-2 text-app-subtext pl-1"><History size={16} /><h3 className="font-medium text-sm">成交记录</h3></div>
                 <TradeList trades={trades} onDelete={deleteTrade} onUpdate={updateTrade} onReorder={handleReorderTrades} settings={appSettings} onSettingsChange={handleSettingsUpdate} />
               </div>
               <div className="bg-app-card border border-app-border rounded-xl p-4 transition-colors">
                 <div className="flex items-center gap-2 mb-3">
                   <BarChart3 size={16} className="text-indigo-400"/>
                   <h3 className="text-app-text font-medium text-sm">数据分析</h3>
                 </div>
                 
                 {/* 税费统计 */}
                 <div className="mb-4 p-3 bg-app-input rounded-lg border border-app-border">
                   <div className="text-sm text-app-subtext font-bold mb-2">税费统计<span className="text-xs opacity-70">（未计入盈亏）</span></div>
                   <div className="grid grid-cols-2 gap-1.5 text-xs">
                     <div className="flex items-center gap-2">
                       <span className="text-app-subtext w-16">买入笔数：</span>
                       <span className="text-app-text font-mono font-medium">{taxFeeStats.buyCount}</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <span className="text-app-subtext w-16">卖出笔数：</span>
                       <span className="text-app-text font-mono font-medium">{taxFeeStats.sellCount}</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <span className="text-app-subtext w-16">买入税费：</span>
                       <span className="text-app-text font-mono font-medium">{taxFeeStats.buyTaxFeeTotal.toFixed(2)}元</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <span className="text-app-subtext w-16">卖出税费：</span>
                       <span className="text-app-text font-mono font-medium">{taxFeeStats.sellTaxFeeTotal.toFixed(2)}元</span>
                     </div>
                     <div className="col-span-2 flex items-center gap-2 pt-1 border-t border-app-border">
                       <span className="text-app-subtext w-16 font-medium">总税费：</span>
                       <span className="text-app-text font-mono font-bold">{taxFeeStats.totalTaxFee.toFixed(2)}元</span>
                     </div>
                   </div>
                 </div>
                 
                 {/* 收益率统计 */}
                 <div className="p-3 bg-app-input rounded-lg border border-app-border">
                   <div className="text-sm text-app-subtext font-bold mb-2">收益率统计</div>
                   {returnRateStats.floatingReturnRate === null ? (
                     <div className="text-xs text-app-subtext italic text-center py-2">
                       请在设置中填写总资金以计算收益率
                     </div>
                   ) : (
                     <div className="flex flex-col gap-1.5 text-xs">
                       <div className="flex items-center gap-2">
                         <span className="text-app-subtext whitespace-nowrap">浮动盈亏收益率：</span>
                         <span className={`font-mono font-bold ${floatingPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                           {returnRateStats.floatingReturnRate >= 0 ? '+' : ''}{returnRateStats.floatingReturnRate.toFixed(2)}%
                         </span>
                       </div>
                       <div className="flex items-center gap-2">
                         <span className="text-app-subtext whitespace-nowrap">已实现盈亏收益率：</span>
                         <span className={`font-mono font-bold ${currentPosition.realizedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                           {returnRateStats.realizedReturnRate >= 0 ? '+' : ''}{returnRateStats.realizedReturnRate.toFixed(2)}%
                         </span>
                       </div>
                       <div className="flex items-center gap-2 pt-1 border-t border-app-border">
                         <span className="text-app-subtext whitespace-nowrap font-medium">总体收益率：</span>
                         <span className={`font-mono font-bold text-sm ${returnRateStats.totalReturnRate >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                           {returnRateStats.totalReturnRate >= 0 ? '+' : ''}{returnRateStats.totalReturnRate.toFixed(2)}%
                         </span>
                       </div>
                     </div>
                   )}
                 </div>
               </div>
            </div>

            <div className="lg:col-span-4 lg:col-start-9 order-1 lg:order-2 lg:sticky lg:top-6 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-app-subtext pl-1"><TrendingUp size={16} /><h3 className="font-medium text-sm">模拟交易</h3></div>
                <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl flex flex-col">
                  <button 
                    onClick={() => setActiveSimPanel(prev => prev === 'manual' ? 'none' : 'manual')}
                    className="flex items-center justify-between p-3 bg-app-input/50 hover:bg-app-hover transition-colors"
                  >
                    <div className="flex items-center gap-2 text-app-text font-medium text-sm">
                      <Activity size={16} className={previewType === 'BUY' ? 'text-brand-red' : 'text-brand-green'} />
                      交易窗口
                    </div>
                    <ChevronDown size={16} className={`text-app-subtext transition-transform ${activeSimPanel === 'manual' ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {activeSimPanel === 'manual' && (
                    <div className="p-4 flex flex-col gap-3 border-t border-app-border">
                      {/* 买入/卖出切换 */}
                      <div className="grid grid-cols-2 p-1 bg-app-input rounded-lg">
                        <button onClick={() => changeOrderType('BUY')} className={`py-2 pr-2 rounded-md text-sm font-bold flex items-center justify-center transition-all ${previewType === 'BUY' ? 'bg-brand-red text-white shadow-lg shadow-brand-red/20' : 'text-app-subtext hover:text-app-text'}`}>
                          <span className="inline-flex items-center gap-2"><TrendingUp size={16} />买入</span>
                        </button>
                        <button onClick={() => changeOrderType('SELL')} className={`py-2 pr-2 rounded-md text-sm font-bold flex items-center justify-center transition-all ${previewType === 'SELL' ? 'bg-brand-green text-white shadow-lg shadow-brand-green/20' : 'text-app-subtext hover:text-app-text'}`}>
                          <span className="inline-flex items-center gap-2"><TrendingDown size={16} />卖出</span>
                        </button>
                      </div>
                      {/* 价格和数量输入 */}
                      <div className="grid grid-cols-2 gap-2">
                        <InputGroup 
                          label="价格 (元/克)" 
                          value={inputs.price} 
                          onChange={(v) => handleInputChange('price', v)} 
                          placeholder="0.00" 
                          step={appSettings.priceStep}
                          touchMode={appSettings.touchMode} 
                          onEnter={handlePriceEnter}
                          inputRef={priceInputRef}
                          onTypeSwitch={handleTypeSwitch}
                          onTab={handlePriceTab}
                        />
                        <InputGroup 
                          label="数量 (克)" 
                          value={inputs.grams} 
                          onChange={(v) => handleInputChange('grams', v)} 
                          placeholder="0.00" 
                          step={appSettings.gramsStep} 
                          isQuantity={true}
                          touchMode={appSettings.touchMode} 
                          onEnter={handleGramsEnter}
                          inputRef={gramsInputRef}
                          onTypeSwitch={handleTypeSwitch}
                          onTab={handleGramsTab}
                        />
                      </div>
                      {/* 成交后预估模块 */}
                      <div className="bg-app-input/30 rounded-xl p-4 border border-app-border space-y-3">
                          <div className="flex justify-between items-start">
                              <div>
                                  <span className="text-[10px] font-bold text-app-subtext uppercase block mb-1">{renderPriceLabel('成交后均价预估')}</span>
                                  <div className="flex items-baseline gap-1.5"><span className="text-3xl font-bold text-app-text tracking-tight font-mono">{renderPriceValue(simulation.newBreakEvenPrice, simulation.newAvgCost, "text-sm text-app-subtext font-bold")}</span><span className="text-[10px] text-app-subtext font-bold">¥</span></div>
                              </div>
                              <div className="flex items-center gap-1.5 self-end">
                                  <span className="text-[10px] text-app-subtext font-medium opacity-80">较当前</span>
                                  {renderPriceDiff(simulation.newBreakEvenPrice, currentPosition.breakEvenPrice, simulation.newAvgCost, currentPosition.avgCost)}
                              </div>
                          </div>
                          <div className="h-px bg-white/5 w-full" />
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                              <div>
                                  <p className="text-app-subtext text-[10px] font-medium">预计总持仓 (金额)</p>
                                  <div className="flex flex-col">
                                      <div className="flex items-baseline gap-1">
                                          <span className="text-lg font-bold text-app-text font-mono">{simulation.totalInvestment.toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                                          <span className="text-[10px] text-app-subtext">¥</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                          <span className="text-[10px] text-app-subtext font-medium opacity-80">较当前</span>
                                          {Math.abs(simulation.totalValueChange) > 0.001 ? (
                                          <div className={`flex items-center h-4 text-xs font-bold font-mono ${simulation.totalValueChange > 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                                              {simulation.totalValueChange > 0 ? (
                                                <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-current mr-1" />
                                              ) : (
                                                <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-current mr-1" />
                                              )}
                                              {Math.abs(simulation.totalValueChange).toFixed(2)}%
                                          </div>
                                          ) : (
                                          <div className="flex items-center h-4 text-xs text-app-subtext font-mono">-</div>
                                          )}
                                      </div>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <p className="text-app-subtext text-[10px] font-medium">本次交易额</p>
                                  <div className="flex items-baseline gap-1 justify-end">
                                      <span className="text-lg font-bold text-app-text font-mono">{((parseFloat(inputs.price)||0) * (parseFloat(inputs.grams)||0)).toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                                      <span className="text-[10px] text-app-subtext">¥</span>
                                  </div>
                              </div>
                              {previewType === 'SELL' && simulation.projectedPnL !== undefined && (<div className="col-span-2 border-t border-white/[0.03] pt-2 flex justify-between items-center"><span className="text-app-subtext text-[10px] font-bold">预计本次盈亏：</span><span className={`font-mono font-bold text-sm ${simulation.projectedPnL >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>{simulation.projectedPnL >= 0 ? '+' : ''}{simulation.projectedPnL.toFixed(2)}</span></div>)}
                          </div>
                          {inputs.grams && inputs.price && (
                            <CostChart currentValue={currentPosition.totalCost} newValue={simulation.totalInvestment} />
                          )}
                      </div>
                      {/* 成交按钮 */}
                      <button onClick={executeTrade} disabled={!inputs.price || !inputs.grams} className={`w-full py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 shadow-md ${previewType === 'BUY' ? 'bg-brand-red text-white hover:bg-red-500' : 'bg-brand-green text-white hover:bg-green-500'}`}><CheckCircle2 size={16} />{previewType === 'BUY' ? '买入成交' : '卖出成交'}</button>
                    </div>
                  )}
                </div>
                
                <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-2xl">
                  <div className="p-4 border-t border-app-border space-y-3">
                    <div className="flex items-center gap-2 text-app-subtext pl-1">
                      <Receipt size={16} className="text-brand-red" />
                      <h3 className="font-medium text-sm">分红结算</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">年收益率 (%)</label>
                        <input 
                          type="number" 
                          value={dividendRate} 
                          onChange={(e) => setDividendRate(e.target.value)} 
                          placeholder="0.00" 
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2.5 text-app-text font-mono text-sm focus:border-brand-red focus:ring-1 focus:ring-brand-red/50 outline-none transition-all"
                          min="0"
                          step="0.1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">分红周期 (月/次)</label>
                        <input 
                          type="number" 
                          value={dividendPeriod} 
                          onChange={(e) => setDividendPeriod(e.target.value)} 
                          placeholder="12" 
                          className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2.5 text-app-text font-mono text-sm focus:border-brand-red focus:ring-1 focus:ring-brand-red/50 outline-none transition-all"
                          min="1"
                          step="1"
                        />
                      </div>
                    </div>
                    <button 
                      onClick={handleDividendSettlement} 
                      disabled={parseFloat(dividendRate) <= 0 || parseFloat(dividendPeriod) <= 0 || currentPosition.grams <= 0}
                      className="w-full py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 shadow-md bg-brand-red text-white hover:bg-red-500"
                    >
                      <Receipt size={16} />分红结算
                    </button>
                  </div>
                </div>
                
                <TradingPlanPanel 
                  marketPrice={marketPrice}
                  onMarketPriceChange={handleMarketPriceChange}
                  priceStep={appSettings.priceStep}
                  touchMode={appSettings.touchMode}
                  availableFunds={availableFunds}
                  isExpanded={activeSimPanel === 'plan'}
                  onToggle={() => setActiveSimPanel(prev => prev === 'plan' ? 'none' : 'plan')}
                  onApplyPlan={handleApplyPlan}
                  onClearPlan={handleClearPlan}
                  hasPlan={hasPlan}
                />
              </div>
              <div className="hidden lg:block">{renderActionButtons()}</div>
            </div>
          </div>
        ) : (
          <StockDividendPage 
            stocks={stocks} 
            onStocksChange={setStocks}
            isAdding={isAddingStock}
            onCloseAdding={() => setIsAddingStock(false)}
            dividendRateColumns={stockSettings.dividendRateColumns}
            colorRanges={stockSettings.dividendRateColorRanges}
            tagColors={stockSettings.tagColors || {}}
            onTagColorsChange={(colors) => setStockSettings(prev => ({ ...prev, tagColors: colors }))}
            maxRows={stockSettings.maxRows}
            actionButtons={renderStockActionButtons()}
            appVersion={APP_VERSION}
            onTogglePage={togglePage}
          />
        )}
        <div className="lg:hidden mt-2 order-3">{currentPage === 'gold' && renderActionButtons()}</div>
      </div>
    </div>
  );
}

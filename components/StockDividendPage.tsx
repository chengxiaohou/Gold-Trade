import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, RefreshCw, Edit2, Check, TrendingUp, TrendingDown, Settings, CloudDownload, CloudUpload, Moon, Sun, CheckCircle2, Trash2 } from 'lucide-react';
import { StockEntry, StockDividendRates, DividendRateColorRange } from '../types';

interface StockDividendPageProps {
  stocks: StockEntry[];
  onStocksChange: (stocks: StockEntry[]) => void;
  isAdding: boolean;
  onCloseAdding: () => void;
  visibleColumns?: string[];
  dividendRateColumns?: string[];
  colorRanges?: DividendRateColorRange[];
}

const DEFAULT_DIVIDEND_RATES: StockDividendRates = {
  '2%': 0,
  '3%': 0,
  '4%': 0,
  '5%': 0,
  '6%': 0,
  '7%': 0,
};

const calculateDividendRates = (dividend: number, rateColumns: string[] = ['2%', '3%', '4%', '5%', '6%', '7%']): StockDividendRates => {
  const rates: StockDividendRates = {};
  rateColumns.forEach(rate => {
    const rateNum = parseFloat(rate) / 100;
    if (!isNaN(rateNum) && rateNum > 0) {
      rates[rate] = dividend / rateNum;
    }
  });
  return rates;
};

const formatPrice = (price: number): string => {
  return price.toFixed(2);
};

const getDividendRateColor = (rate: number, colorRanges: DividendRateColorRange[]): string => {
  if (!rate || rate <= 0) return 'text-app-text';
  const COLOR_MAP: Record<string, string> = {
    'indigo': 'text-indigo-500',
    'gray': 'text-gray-500',
    'red': 'text-red-500',
    'green': 'text-green-500',
    'yellow': 'text-yellow-500',
    'blue': 'text-blue-500',
    'purple': 'text-purple-500',
    'pink': 'text-pink-500',
  };
  for (const range of colorRanges) {
    if (rate >= range.min && rate <= range.max) {
      return COLOR_MAP[range.color] || 'text-app-text';
    }
  }
  return 'text-app-text';
};

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
};

const formatPercent = (percent: number): string => {
  return percent.toFixed(2) + '%';
};

export const StockDividendPage: React.FC<StockDividendPageProps> = ({ stocks, onStocksChange, isAdding, onCloseAdding, visibleColumns, dividendRateColumns, colorRanges }) => {
  const defaultVisibleColumns = ['code', 'name', 'price', 'changePercent', 'dividend2024', 'dividend2025', 'dividendRate2025', 'dividendRates'];
  const cols = visibleColumns || defaultVisibleColumns;
  const rateCols = dividendRateColumns || ['2%', '3%', '4%', '5%', '6%', '7%'];
  const ranges = colorRanges || [
    { min: 3, max: 4, color: 'red' },
    { min: 4.5, max: 5.5, color: 'gray' },
    { min: 6, max: 7, color: 'green' }
  ];
  
  const latestUpdateTime = stocks.reduce((max, stock) => Math.max(max, stock.priceUpdatedAt || 0), 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDividendRate, setEditingDividendRate] = useState<string | null>(null);
  const [newStock, setNewStock] = useState({
    code: '',
    name: '',
  });
  const [isRefreshing, setIsRefreshing] = useState<Set<string>>(new Set());
  const [refreshFailed, setRefreshFailed] = useState<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem('stock_dividend_stocks', JSON.stringify(stocks));
  }, [stocks]);

  const fetchStockPrice = useCallback(async (stockCode: string): Promise<{
    price: number;
    name: string;
    changePercent: number;
    high: number;
    low: number;
  } | null> => {
    try {
      let market = 'sh';
      let code = stockCode;
      
      if (code.endsWith('.SZ')) {
        market = 'sz';
        code = code.replace('.SZ', '');
      } else if (code.endsWith('.SH')) {
        code = code.replace('.SH', '');
      } else if (parseInt(code) >= 300000 || parseInt(code) >= 2000) {
        market = 'sz';
      }
      
      const url = `https://qt.gtimg.cn/q=${market}${code}`;
      const response = await fetch(url);
      const text = await response.text();
      
      const match = text.match(/v_\w+="([^"]+)"/);
      if (match && match[1]) {
        const data = match[1].split('~');
        if (data.length >= 11) {
          const price = parseFloat(data[3]);
          const prevClose = parseFloat(data[4]);
          const high = parseFloat(data[5]);
          const low = parseFloat(data[6]);
          let changePercent = 0;
          
          if (prevClose > 0) {
            changePercent = ((price - prevClose) / prevClose) * 100;
          }
          
          return {
            name: data[1],
            price: price,
            changePercent: changePercent,
            high: high || price,
            low: low || price,
          };
        }
      }
      return null;
    } catch (error) {
      console.error('获取股价失败:', error);
      return null;
    }
  }, []);

  const handleRefreshPrice = useCallback(async (id: string) => {
    const stock = stocks.find(s => s.id === id);
    if (!stock) return;

    setIsRefreshing(prev => new Set(prev).add(id));
    setRefreshFailed(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      const result = await fetchStockPrice(stock.code);
      if (result) {
        const dividendRate = result.price > 0 ? (stock.dividend2025 / result.price) * 100 : 0;
        onStocksChange(stocks.map(s => 
          s.id === id ? {
            ...s,
            price: result.price,
            changePercent: result.changePercent,
            priceUpdatedAt: Date.now(),
            dividendRate2025: dividendRate,
          } : s
        ));
      } else {
        setRefreshFailed(prev => new Set(prev).add(id));
      }
    } catch {
      setRefreshFailed(prev => new Set(prev).add(id));
    } finally {
      setIsRefreshing(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [stocks, onStocksChange, fetchStockPrice]);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(new Set(stocks.map(s => s.id)));
    setRefreshFailed(new Set());
    try {
      const updatedStocks = [...stocks];
      const failedIds = new Set<string>();
      for (let i = 0; i < updatedStocks.length; i++) {
        const stock = updatedStocks[i];
        const result = await fetchStockPrice(stock.code);
        if (result) {
          const dividendRate = result.price > 0 ? (stock.dividend2025 / result.price) * 100 : 0;
          updatedStocks[i] = {
            ...updatedStocks[i],
            price: result.price,
            changePercent: result.changePercent,
            priceUpdatedAt: Date.now(),
            dividendRate2025: dividendRate,
          };
        } else {
          failedIds.add(stock.id);
        }
      }
      onStocksChange(updatedStocks);
      if (failedIds.size > 0) {
        setRefreshFailed(failedIds);
      }
    } catch {
      setRefreshFailed(new Set(stocks.map(s => s.id)));
    } finally {
      setIsRefreshing(new Set());
    }
  }, [stocks, onStocksChange, fetchStockPrice]);

  const handleAddStock = useCallback(async () => {
    if (!newStock.code.trim()) return;

    const existing = stocks.find(s => s.code.toLowerCase() === newStock.code.toLowerCase());
    if (existing) {
      alert('该股票已存在');
      return;
    }

    setIsRefreshing(new Set(['new']));
    try {
      let result = null;
      const stockCode = newStock.code;
      result = await fetchStockPrice(stockCode);

      const dividend2024 = 0;
      const dividend2025 = 0;

      const newEntry: StockEntry = {
        id: Date.now().toString(),
        code: stockCode,
        name: result?.name || newStock.name || stockCode,
        price: result?.price || 0,
        changePercent: result?.changePercent || 0,
        high: result?.high || 0,
        low: result?.low || 0,
        dividend2024,
        dividend2025,
        dividendRate2025: 0,
        priceUpdatedAt: result ? Date.now() : null,
        dividendRates: calculateDividendRates(dividend2025),
      };

      onStocksChange([...stocks, newEntry]);
      setNewStock({ code: '', name: '' });
      onCloseAdding();
    } catch {
      alert('添加股票失败');
    } finally {
      setIsRefreshing(new Set());
    }
  }, [newStock, stocks, onStocksChange, fetchStockPrice]);

  const handleDeleteStock = useCallback((id: string) => {
    onStocksChange(stocks.filter(s => s.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
  }, [stocks, onStocksChange, editingId]);

  const handleUpdateField = useCallback((id: string, field: keyof StockEntry, value: string | number) => {
    onStocksChange(stocks.map(s => {
      if (s.id !== id) return s;
      
      let newStock = { ...s, [field]: value };
      
      if (field === 'dividend2025') {
        const dividend = typeof value === 'number' ? value : parseFloat(value) || 0;
        newStock.dividendRates = calculateDividendRates(dividend);
        newStock.dividendRate2025 = s.price > 0 ? (dividend / s.price) * 100 : 0;
      }
      
      return newStock;
    }));
  }, [stocks, onStocksChange]);

  const handleDividendRatePriceChange = useCallback((id: string, rateKey: string, price: string) => {
    const stock = stocks.find(s => s.id === id);
    if (!stock) return;
    
    const newPrice = parseFloat(price) || 0;
    if (newPrice <= 0) return;
    
    const rate = parseFloat(rateKey) / 100;
    const newDividend = newPrice * rate;
    
    onStocksChange(stocks.map(s => {
      if (s.id !== id) return s;
      
      return {
        ...s,
        dividend2025: newDividend,
        dividendRates: calculateDividendRates(newDividend),
        dividendRate2025: s.price > 0 ? (newDividend / s.price) * 100 : 0,
      };
    }));
    
    setEditingDividendRate(null);
  }, [stocks, onStocksChange]);

  const formatUpdateTime = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {isAdding && (
        <div className="bg-app-card border border-app-border rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">股票代码</label>
              <input
                type="text"
                value={newStock.code}
                onChange={(e) => setNewStock(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                placeholder="如 600519.SH"
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2.5 text-app-text font-mono text-sm focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow/50 outline-none transition-all"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-app-subtext tracking-wider ml-0.5">股票名称</label>
              <input
                type="text"
                value={newStock.name}
                onChange={(e) => setNewStock(prev => ({ ...prev, name: e.target.value }))}
                placeholder="可选"
                className="w-full bg-app-input border border-app-border rounded-lg px-3 py-2.5 text-app-text font-mono text-sm focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow/50 outline-none transition-all"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAddStock}
              disabled={!newStock.code.trim() || isRefreshing.has('new')}
              className="flex-1 py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] disabled:opacity-50 bg-brand-yellow text-slate-900 hover:bg-[#fdd835]"
            >
              <Plus size={16} />添加股票
            </button>
            <button
              onClick={() => {
                onCloseAdding();
                setNewStock({ code: '', name: '' });
              }}
              className="flex-1 py-2.5 rounded-lg font-semibold text-base flex items-center justify-center gap-2 transform active:scale-[0.98] border border-app-border text-app-subtext hover:bg-app-input hover:text-app-text"
            >
              <X size={16} />取消
            </button>
          </div>
        </div>
      )}

      <div className="bg-app-card border border-app-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-app-input">
                {(cols.includes('code') || cols.includes('name')) && <th className="px-3 py-2 text-left text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[100px] border-b border-app-border">股票名称</th>}
                {cols.includes('dividendRate2025') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[80px] border-b border-app-border">股息率</th>}
                {cols.includes('price') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[100px] border-b border-app-border">价格</th>}
                {cols.includes('changePercent') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[70px] border-b border-app-border">涨跌幅</th>}
                {cols.includes('dividend2024') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[70px] border-b border-app-border">分红</th>}
                {cols.includes('dividend2025') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[70px] border-b border-app-border">分红</th>}
                {cols.includes('dividendRates') && <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[200px] border-b border-app-border" colSpan={rateCols.length}>股息率对应股价</th>}
                <th className="px-3 py-2 text-center text-sm uppercase font-bold text-app-subtext tracking-wider min-w-[40px]" rowSpan={2}>操作</th>
              </tr>
              <tr className="bg-app-input">
                {(cols.includes('code') || cols.includes('name')) && <th className="px-3 py-1 text-left text-xs font-bold text-app-subtext">股票代码</th>}
                {cols.includes('dividendRate2025') && <th className="px-3 py-1 text-center text-xs font-bold text-app-subtext"></th>}
                {cols.includes('price') && <th className="px-3 py-1 text-center text-xs font-bold text-app-subtext">{latestUpdateTime > 0 ? formatRelativeTime(latestUpdateTime) : '--'}</th>}
                {cols.includes('changePercent') && <th className="px-3 py-1 text-center text-xs font-bold text-app-subtext"></th>}
                {cols.includes('dividend2024') && <th className="px-3 py-1 text-center text-xs font-bold text-app-subtext">2024</th>}
                {cols.includes('dividend2025') && <th className="px-3 py-1 text-center text-xs font-bold text-app-subtext">2025</th>}
                {cols.includes('dividendRates') && rateCols.map(rate => (
                  <th key={rate} className="px-2 py-1 text-center text-xs font-bold text-app-subtext min-w-[30px]">{rate}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.map(stock => (
                <tr key={stock.id} className="border-t border-app-border hover:bg-app-hover transition-colors">
                  {(cols.includes('code') || cols.includes('name')) && <td className="px-3 py-2 text-left">
                    {editingId === stock.id ? (
                      <div className="flex flex-col gap-1">
                        {cols.includes('name') && <input
                          type="text"
                          value={stock.name}
                          onChange={(e) => handleUpdateField(stock.id, 'name', e.target.value)}
                          className="w-full bg-app-input border border-brand-yellow rounded px-2 py-1 text-xs text-app-text outline-none"
                        />}
                        {cols.includes('code') && <input
                          type="text"
                          value={stock.code}
                          onChange={(e) => handleUpdateField(stock.id, 'code', e.target.value.toUpperCase())}
                          className="w-full bg-app-input border border-brand-yellow rounded px-2 py-1 text-xs font-mono text-app-text outline-none"
                        />}
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <span className="text-xs text-app-text">{stock.name}</span>
                        <span className="font-mono text-[10px] text-app-subtext/70">{stock.code}</span>
                      </div>
                    )}
                  </td>}
                  {cols.includes('dividendRate2025') && <td className="px-3 py-2 text-center">
                    <span className={`font-mono text-xs font-bold ${getDividendRateColor(stock.dividendRate2025, ranges)}`}>
                      {stock.dividendRate2025 > 0 ? formatPercent(stock.dividendRate2025) : '--'}
                    </span>
                  </td>}
                  {cols.includes('price') && <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`font-mono text-sm font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                        {formatPrice(stock.price)}
                      </span>
                      {refreshFailed.has(stock.id) && (
                        <button
                          onClick={() => handleRefreshPrice(stock.id)}
                          className="p-0.5 hover:bg-app-input rounded transition-colors"
                          title="重新刷新股价"
                        >
                          <RefreshCw size={12} className="text-brand-yellow" />
                        </button>
                      )}
                    </div>
                  </td>}
                  {cols.includes('changePercent') && <td className="px-3 py-2 text-center">
                    <span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-brand-red' : 'text-brand-green'}`}>
                      {stock.changePercent >= 0 ? '+' : ''}{formatPercent(stock.changePercent)}
                    </span>
                  </td>}
                  {cols.includes('dividend2024') && <td className="px-3 py-2 text-center">
                    {editingId === stock.id ? (
                      <input
                        type="number"
                        value={stock.dividend2024}
                        onChange={(e) => handleUpdateField(stock.id, 'dividend2024', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        className="w-full bg-app-input border border-brand-yellow rounded px-2 py-1 text-xs font-mono text-app-text outline-none text-center"
                      />
                    ) : (
                      <span className="font-mono text-xs text-app-text">{formatPrice(stock.dividend2024)}</span>
                    )}
                  </td>}
                  {cols.includes('dividend2025') && <td className="px-3 py-2 text-center">
                    {editingId === stock.id ? (
                      <input
                        type="number"
                        value={stock.dividend2025}
                        onChange={(e) => handleUpdateField(stock.id, 'dividend2025', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        className="w-full bg-app-input border border-brand-yellow rounded px-2 py-1 text-xs font-mono text-app-text outline-none text-center"
                      />
                    ) : (
                      <span className="font-mono text-xs text-app-text">{formatPrice(stock.dividend2025)}</span>
                    )}
                  </td>}
                  {cols.includes('dividendRates') && rateCols.map(rate => (
                    <td key={rate} className="px-2 py-2 text-center min-w-[40px]">
                      {editingDividendRate === `${stock.id}-${rate}` ? (
                        <input
                          type="number"
                          defaultValue={formatPrice(stock.dividendRates[rate] || 0)}
                          onBlur={(e) => handleDividendRatePriceChange(stock.id, rate, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.target.blur();
                            } else if (e.key === 'Escape') {
                              setEditingDividendRate(null);
                            }
                          }}
                          step="0.01"
                          className="w-full bg-app-input border border-brand-yellow rounded px-1 py-0.5 text-xs font-mono text-app-text outline-none text-center"
                          autoFocus
                        />
                      ) : (
                        <span 
                          className="font-mono text-xs text-app-text cursor-pointer hover:text-brand-yellow"
                          onClick={() => setEditingDividendRate(`${stock.id}-${rate}`)}
                        >
                          {formatPrice(stock.dividendRates[rate] || 0)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {editingId === stock.id ? (
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 hover:bg-app-input rounded transition-colors"
                          title="保存"
                        >
                          <Check size={14} className="text-brand-green" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditingId(stock.id)}
                          className="p-1 hover:bg-app-input rounded transition-colors"
                          title="编辑"
                        >
                          <Edit2 size={14} className="text-app-subtext" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteStock(stock.id)}
                        className="p-1 hover:bg-brand-red/20 rounded transition-colors"
                        title="删除"
                      >
                        <X size={14} className="text-app-subtext hover:text-brand-red" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {stocks.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-3 py-8 text-center text-app-subtext text-sm">
                    暂无股票数据，点击上方按钮添加股票
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-app-card border border-app-border rounded-xl p-4">
        <div className="text-xs text-app-subtext">
          <p className="mb-2">计算公式：<span className="font-mono">股价 = 分红金额 / 股息率</span></p>
          <p>例如：分红 ¥2.00，股息率 5%，对应股价 = 2.00 / 0.05 = ¥40.00</p>
          <p className="mt-2 text-[10px] opacity-70">股息率(2025) = 分红(2025) / 当前股价 × 100%</p>
        </div>
      </div>
    </div>
  );
};
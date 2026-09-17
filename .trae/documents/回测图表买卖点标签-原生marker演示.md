# 回测图表买卖点标签：原生 marker 演示

## Context

股息率项目的回测功能目前停留在 UI 阶段（[BacktestModal.tsx](file:///Users/chengxiaohou/Documents/GitHub/Gold-Trade/components/BacktestModal.tsx)）。本目标是给回测的 K 线图加上 B/S 买卖点小标签，使其日后能与回测的交易记录一一对应。

第一步**只看效果**：在 lightweight-charts 上用**原生 `createSeriesMarkers()`** 画出一批买卖点标签，配合**假数据**先把渲染链路跑通，验证「标签是否随 K 线缩放/平移、能否区分买卖」后再决定是否换成截图样式的自定义绘制。

已确认的技术事实：
- 项目采用 lightweight-charts **v5.2.1**（`package.json`），非方案文档所说的 klinecharts。回测弹窗已用 `CandlestickSeries` + `LineSeries`。
- 原生 marker **文字与形状同色**（fillStyle 统一），做不出截图那种「蓝底白字」。因此本轮先接受纯色表现，只验证效果。
- marker 支持 `id`，且点击命中时 `chart.subscribeClick` 的 hitTest 返回 `externalId`，可用于日后点击标签高亮对应交易记录。
- K 线 time 为字符串 `YYYY-MM-DD`，可直接作为 marker 的 `time` 字段。

## 方案（本轮：原生 marker + 假数据）

只改一个文件：`components/BacktestModal.tsx`。

### 1. 引入与状态
```ts
import { createSeriesMarkers } from 'lightweight-charts';
import type { ISeriesMarkersPluginApi, SeriesMarker } from 'lightweight-charts';
```
新增 ref：
```ts
const markersRef = useRef<ISeriesMarkersPluginApi<string> | null>(null);
```

### 2. 图表初始化时创建 markers 插件（挂到 K 线 series）
在建立 `seriesRef.current` 之后：
```ts
markersRef.current = createSeriesMarkers(series);
```
清理函数里置空 `markersRef.current`。

### 3. 假数据：由 klines 生成一批 B/S 点
新增一个由 `klines` 推导的标记数组（演示用，不落业务类型）：
- 买入（`buy`）：`position: 'belowBar'`，`shape: 'circle'`，`color` 用现有 K 线看多色 `#10b981`，`text: 'B'`，`size: 0`（只显示文字，避免与方块同色混叠）。
- 卖出（`sell`）：`position: 'aboveBar'`，`shape: 'circle'`，`color` 用看空色 `#ef4444`，`text: 'S'`，`size: 0`。
- 取 K 线序列的中段/尾部若干索引（例如首尾各留白，挑 5~8 个分散位置交替 buy/sell）作为展示点。
- 每个点 `id` 用 index 字符串占位（供之后 replace 成交易 id）。

> 说明：`size: 0` 会只画文字（源码中 `drawShape` 对 `size===0` 直接 return，仅保留 `drawText`），这样 B/S 文字既不与 K 线重叠又被不同颜色区分，最接近「看效果」的目标；若想同时看方块形状，改 `size: 1` 即可，两者都保留 `text`。

### 4. 在 klines 到达的 effect 中写入 markers
在已有「真实数据到达后更新图表」effect（`[klines]` 依赖）末尾追加：
```ts
markersRef.current?.setMarkers(demoMarkers);
```

### 5.（可选）点击联动占位
`chart.subscribeClick`：当命中 `itemType === 'marker'` 时，用 `hitTest.externalId` 更新 `selectedTradeId`。本轮可先加这个订阅以验证「点击标签能命中」，为下一步「标签-交易记录一一对应」铺路；若想最小化改动可暂缓。

## 关键文件

- `components/BacktestModal.tsx`（唯一改动文件）

## 验证

1. `npm run dev` 启动，进入股息页 → 打开某股票 MktInfo 弹窗 → 点「回测」。
2. 观察 K 线图出现若干 `B`（绿色、下方）/ `S`（红色、上方）标签。
3. **缩放/平移图表**，标签应始终跟随对应 K 线（原生 marker 自动锚定）。切换「均线 / 布林线」不应丢失标签。
4. 若加入点击订阅：点击某个标签，`selectedTradeId` 更新（表格占位文本变化）即证明点击命中链路通。

## 后续（不在本轮）

- 实现 `runBacktest` 引擎，用真实 `BacktestTrade[]` 替换假数据，`marker.id` 替换为 `trade.id` 实现一一对应。
- 若原生 marker 效果不满足截图样式，再评估「HTML 覆盖层」或「自定义 Primitive」方案。
# 回测图买卖点标签：HTML/SVG 覆盖层重绘

## Context

上一轮用 lightweight-charts 原生 `createSeriesMarkers()` 在回测 K 线图上演示了 B/S 标签（绿色 B 下方 / 红色 S 上方），验证了「渲染 + 缩放锚定 + 点击命中」链路可用。但原生 marker **文字与形状同色**，做不出截图那种「蓝底白字小方块 + 连接点」的标准买卖点样式。用户确认原生效果不满足，选择改用 **HTML/SVG 覆盖层**重绘 B/S 标签，以获得最高的样式自由度，并保留点击联动回测交易记录。

本改动只改一个文件：`components/BacktestModal.tsx`。技术底座为 lightweight-charts **v5.2.1**（`package.json`），回测弹窗已用 `CandlestickSeries`。

## 方案：覆盖层绘制 B/S 标签

在 `BacktestModal` 的图表容器（`relative flex-1 min-h-[150px]`，[L488](file:///Users/chengxiaohou/Documents/GitHub/Gold-Trade/components/BacktestModal.tsx)）内，叠加一个与 chartRef 同层、`absolute inset-0 pointer-events-none` 的 SVG 层，用来绘制标签。**移除原生的 `createSeriesMarkers`**，数据源仍用假数据 `demoMarkers`（保留，继续做演示）。

### 坐标换算核心（已确认 API）
- 横向 x：`chartInstance.current.timeScale().timeToCoordinate(time)` → `Coordinate | null`，为 CSS 像素，相对图表绘图区左上角。
- 纵向 y：`seriesRef.current.priceToCoordinate(price)` → `Coordinate | null`。
- 任一返回 `null`（K 线不在可视区）→ 隐藏该标签。
- 覆盖层挂在 chartRef 的外层 `relative` 容器，坐标 `(x, y)` 与 SVG 的 viewBox 原点(0,0)=容器左上角对齐。因 chartRef 是 `absolute inset-0`，其绘图区左上角即容器左上角。

### 状态与逻辑
新增 state：`overlayTicks: Array<{ id, x, y, action, time }>`（由坐标计算得出，驱动 SVG 渲染）。

新增一个统一的「重算坐标」函数 `computeTickPositions()`：遍历 `demoMarkers`，取每根的 `time`（已反查对应 K 线 close 作为锚定价），调用 `timeToCoordinate` / `priceToCoordinate`，过滤掉 null，得到可见标签坐标 → `setOverlayTicks`。用 `useCallback` + 读取最新 ref，避免闭包陈旧。

**关键难点—缩放/平移/尺寸变化时实时跟随**（这些交互的多处代码已接管手势）：
1. **尺寸变化**：现有 `ResizeObserver`（L245 附近，`chart.resize(w,h)` 处）回调里追加调用 `computeTickPositions()`。
2. **缩放/平移**：轻量的自定义缩放走 `setVisibleLogicalRange`（L365）；同时图表仍可能有其它 scroll/pan。稳妥做法：通过 `chartInstance.current.timeScale().subscribeVisibleLogicalRangeChange(computeTickPositions)` 订阅可视范围变化（缩放/平移都会触发该回调），并在清理时 `unsubscribeVisibleLogicalRangeChange`。这也覆盖了自定义缩放。
3. **数据到达**：klines effect（`[klines, demoMarkers]`）末尾，在 rAF 设完可视范围后调用一次 `computeTickPositions()`（因刚 setData，需等布局稳定）。

> 注意：`logicalRange` 回调在 setVisibleLogicalRange 的同步调用中可能拿不到最新，配合 rAF 加一轮兜底重算。可接受微小延迟，标签随图表主绘制帧跟随。

### SVG 渲染（截图样式）
- 每个标签一个 `<g>`，`transform: translate(x, y)`，`pointer-events: auto`。
- 样式：圆角方块（`<rect>` 蓝底 #2b5cff、圆角、内置白色字母 B/S）+ 从标签下缘伸出一根短线 + 末端小圆点到 K 线锚点（连线）。
- 位置约定沿用上轮「买下卖上」：buy 标签在 K 线上方（`y - 偏移`，S 相似）、sell 在 K 线上方偏高；实际用锚定 close 价坐标做基准，在 `priceToCoordinate` 基础上偏移像素实现上下错位，并做顶部/底部边界翻转（超出可视区顶部则翻到 K 线下方），参考项目既有「边界翻转」经验。
- 文字通过 `<text>` 白色居中；尺寸来自当前 barSpacing（可固定，或用 `chart.timeScale().options().barSpacing/3` 控制方块宽）。

### 点击联动
- 覆盖层 `<g>` 的 `onClick`（React 事件）→ 用标签 `id` 调 `setSelectedTradeId(id)`，与回测交易记录联动。
- **移除**上轮 `chart.subscribeClick` 的原生 marker 点击分支（不再用原生 marker）。可保留 subscribeClick 但改为「未命中 marker 时清空选中」？本轮先简单：点击标签选中，SVG onClick 是最直接命中来源。

### 原生 marker 清理
- 移除 `createSeriesMarkers` 引入、`markersRef`、效果里 `setMarkers(demoMarkers)`，以及 subscribeClick 里的 marker 分支。因 `createSeriesMarkers` 不挂 primitive 时只是空壳，删除即可全面退出原生路径（无需 detachPrimitive）。

## 关键文件

- `components/BacktestModal.tsx`（唯一改动文件）

## 复用的既有实现
- `demoMarkers`（L289-308，假数据，作为覆盖层的标签数据源，保留）。
- 现有 `ResizeObserver` 重绘回调（L245 附近 `chart.resize` 之后）。
- 现有图表容器 `relative flex-1 min-h-[150px]`（L488）作覆盖层挂载点。
- 项目边界翻转/浮窗定位经验（StockDividendPage.tsx）。

## 验证

1. `npm run dev`，进入回测弹窗，K 线加载后应看到**蓝底白字**+连接点样式的 B/S 标签（而非纯色字母），且买卖点上下错位、不重叠 K 线。
2. **缩放 / 平移 / 拖拽**图表，标签实时跟随对应 K 线，滚出可视区的标签隐藏。
3. **改变窗口尺寸**，标签仍锚定正确。
4. **点击**标签，表格占位文本显示 `已选中标记 <id>`，证明点击联动生效。
5. `npx tsc --noEmit` 通过。
6. 确认原生全色 marker 已消失（不再有纯色字母 B/S）。

## 后续（不在本轮）
- 实现 `runBacktest` 引擎，用真实 `BacktestTrade[]` 替换 `demoMarkers`，标签 id = trade.id 实现真正一一对应。
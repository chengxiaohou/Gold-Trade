<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/2d6dd92d-382f-4ff0-930f-5f6ba70e40f4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

---

## 银行流水对账（人工辅助）

用于把银行流水和 `gold-trades-*.json`（App 导出的交易记录）逐笔核对，并生成修正后的 JSON。

### 核心口径

- 银行流水里黄金相关记录的特征：交易摘要为 **“黄金账户份额购买”/“黄金账户份额卖出”**，对手方为 **MX零售活期账户金成本**，金额带正负号（买入为负、卖出为正）。
- 手动记录里每笔金额 = `每克价格 × 克重`，两边按 **金额 + 买卖方向** 逐笔顺序匹配（时间对不上没关系，以银行流水顺序为准）。
- 流水 PDF **不含克重**，克重只能从 JSON 里对应金额的记录取；流水缺失的记录需人工确认价格/克重（脚本会按附近记录的价格做推测）。
- 招商银行流水一般只到**申请日期的前一天**，申请日当天的交易不在流水里，需要单独补录。
- 历史教训：早期那份手工整理的 Excel 表格不可靠（方向标反、金额抄错、多抄重复记录），**一律以银行原始 PDF 流水为准**。

### 脚本用法

`scripts/reconcile_bank.py`（需要 pdfplumber，Codex 运行时自带；也可 `pip install pdfplumber`）：

```bash
python3 scripts/reconcile_bank.py <银行流水.pdf> [交易JSON] [--out 输出路径] [--no-write]
```

- 交易 JSON 缺省时自动找当前目录最新的 `gold-trades-*.json`；
- 输出一份 `gold-trades-reconciled-*.json`（格式与 App 导出一致），用户拿到后自行用 App 的“导入”功能决定是否替换；
- 脚本会报告：完全匹配笔数、流水有但 JSON 缺失（自动补录并给出推测价格/克重）、流水没有但 JSON 存在（保留，通常是流水截止日之后的交易）、方向相反记录、顺序调整，以及对账前后的持仓/均价/回本价。

### 下次对账步骤（给 Codex 的提示）

1. 确认拿到的是**招商银行原始流水 PDF**，而不是手工整理的 Excel。
2. 用脚本（或直接按上述口径）提取黄金记录，数量应等于当前有效交易数减去申请日当天的交易数。
3. 逐笔核对金额+方向；发现差异时：
   - 流水有、JSON 缺 → 补录，克重需与用户确认或按持仓反推；
   - 金额同但方向反 → 流水和 JSON 必有一方标错，先查流水余额列，再与用户确认；
   - 顺序颠倒 → 按流水顺序调整。
4. 生成修正后 JSON 前，先确认“持仓克数”与用户口述一致（例如当前持仓 105 克）。

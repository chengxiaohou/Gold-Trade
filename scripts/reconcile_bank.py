#!/usr/bin/env python3
"""
银行流水对账脚本（本地运行）

用法：
  python3 scripts/reconcile_bank.py <银行流水.pdf> [交易JSON] [--out 输出路径] [--no-write]

依赖：pdfplumber（pip install pdfplumber）
说明：
  - 交易JSON 缺省时自动读取当前目录下最新的 gold-trades-*.json；
  - 从招行流水 PDF 提取“黄金账户份额购买/卖出”记录；
  - 与交易 JSON 按“金额（每克价格×克重）+ 买卖方向”逐笔顺序比对；
  - 输出一份可直接用 App“导入”功能使用的修正后 JSON（不改动原文件）。
"""

import argparse
import glob
import json
import os
import re
import statistics
import sys
from datetime import datetime

try:
    import pdfplumber
except ImportError:
    sys.exit("缺少 pdfplumber，请先安装：pip install pdfplumber")


def round2(n):
    return round(n + 1e-9, 2)


def extract_gold_records(pdf_path):
    """从招行流水 PDF 中提取黄金账户份额购买/卖出记录"""
    gold = []
    pat = re.compile(
        r"^(\d{4}-\d{2}-\d{2})\s+CNY\s+(-?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+"
        r"(黄金账户份额购买|黄金账户份额卖出)\s+(.*)$"
    )
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                m = pat.match(line.strip())
                if not m:
                    continue
                gold.append(
                    {
                        "date": m.group(1),
                        "amount": abs(float(m.group(2).replace(",", ""))),
                        "balance": float(m.group(3).replace(",", "")),
                        "type": "BUY" if m.group(4) == "黄金账户份额购买" else "SELL",
                    }
                )
    return gold


def load_trades(trades_path):
    with open(trades_path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, list):
        return raw, {}
    if isinstance(raw, dict) and isinstance(raw.get("trades"), list):
        return raw["trades"], raw.get("settings", {})
    raise ValueError(f"无法识别的交易 JSON 格式：{trades_path}")


def find_trades_file():
    files = sorted(glob.glob(os.path.join(os.getcwd(), "gold-trades-*.json")))
    if not files:
        raise SystemExit("当前目录没有 gold-trades-*.json，请把交易 JSON 作为第二个参数传入。")
    return files[-1]


def calc_position(trades):
    """持仓/均价/回本价（与 App 算法一致：卖出按当前均价结转成本）"""
    grams = 0.0
    total_cost = 0.0
    realized_pnl = 0.0
    for t in trades:
        if t.get("isDisabled") or t.get("isPlan"):
            continue
        if t["type"] == "DIVIDEND":
            realized_pnl += t.get("dividendAmount") or 0
            continue
        if t["type"] == "BUY":
            grams += t["grams"]
            total_cost += t["grams"] * t["price"]
        elif t["type"] == "SELL":
            avg = total_cost / grams if grams > 0 else 0
            cost_basis = t["grams"] * avg
            grams = max(0, grams - t["grams"])
            total_cost -= cost_basis
            realized_pnl += t["grams"] * t["price"] - cost_basis
    if grams < 0.0001:
        grams = 0.0
        total_cost = 0.0
    avg_cost = total_cost / grams if grams > 0 else 0
    break_even = max(0, (total_cost - realized_pnl) / grams) if grams > 0 else 0
    return {"grams": grams, "avgCost": avg_cost, "totalCost": total_cost, "realizedPnL": realized_pnl, "breakEven": break_even}


def reconcile(gold_records, trades, settings):
    """LCS 对齐 + 缺失/多余/方向/顺序 处理，返回修正后的交易列表和明细"""
    active = [t for t in trades if not t.get("isDisabled") and not t.get("isPlan")]
    J = [
        {"_j": i, "id": t["id"], "type": t["type"], "amount": round2(t["price"] * t["grams"])}
        for i, t in enumerate(active)
    ]
    B = [dict(g, _b=i) for i, g in enumerate(gold_records)]

    n, m = len(B), len(J)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if B[i - 1]["amount"] == J[j - 1]["amount"] and B[i - 1]["type"] == J[j - 1]["type"]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    pairs = []
    i, j = n, m
    while i > 0 and j > 0:
        if (
            B[i - 1]["amount"] == J[j - 1]["amount"]
            and B[i - 1]["type"] == J[j - 1]["type"]
            and dp[i][j] == dp[i - 1][j - 1] + 1
        ):
            pairs.append({"b": B[i - 1], "j": J[j - 1]})
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    pairs.reverse()

    used_b = {p["b"]["_b"] for p in pairs}
    used_j = {p["j"]["_j"] for p in pairs}

    # 金额相同但方向相反 → 单独列出，不改动
    dir_diff = []
    b_left = [b for b in B if b["_b"] not in used_b]
    j_left = [t for t in J if t["_j"] not in used_j]
    for b in b_left:
        k = next((k for k, t in enumerate(j_left) if t["amount"] == b["amount"] and t["type"] != b["type"]), None)
        if k is not None:
            dir_diff.append({"b": b, "t": j_left[k]})
            used_b.add(b["_b"])
            used_j.add(j_left[k]["_j"])
            del j_left[k]

    missing = [b for b in B if b["_b"] not in used_b]
    extra = [t for t in J if t["_j"] not in used_j]

    # 为缺失记录推测价格/克重：取附近已匹配记录的中位价格，找最接近的组合
    def suggest_split(b):
        near = [
            p["b"]["amount"] / p["j"]["grams"]
            for p in pairs
            if abs(p["b"]["_b"] - b["_b"]) <= 3
        ]
        med = statistics.median(near) if near else None
        best = None
        for g in [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100]:
            price = b["amount"] / g
            if price <= 0:
                continue
            price_int = round(price, 2)
            if abs(price_int - price) > 1e-6:
                continue
            score = abs(price_int - med) if med is not None else 0
            score += 0.001 if not float(g).is_integer() else 0
            if best is None or (score, g) < (best[0], best[1]):
                best = (score, g, price_int)
        return {"price": best[2], "grams": best[1]} if best else {"price": b["amount"], "grams": 1}

    missing_with_split = [dict(b, split=suggest_split(b)) for b in missing]

    # 顺序调整：已匹配记录按流水顺序重排（仅交换相邻颠倒的记录）
    corrected = [dict(t) for t in trades]
    pos_of = {t["id"]: idx for idx, t in enumerate(corrected)}
    order_fixes = []
    swapped = True
    while swapped:
        swapped = False
        for k in range(1, len(pairs)):
            prev, cur = pairs[k - 1]["j"], pairs[k]["j"]
            p_idx, c_idx = pos_of.get(prev["id"]), pos_of.get(cur["id"])
            if p_idx is not None and c_idx is not None and c_idx < p_idx:
                corrected[p_idx], corrected[c_idx] = corrected[c_idx], corrected[p_idx]
                pos_of[prev["id"]], pos_of[cur["id"]] = c_idx, p_idx
                order_fixes.append(
                    {
                        "json_was": f"{cur['type']} {cur['amount']} → {prev['type']} {prev['amount']}",
                        "pdf_order": f"{prev['type']} {prev['amount']} → {cur['type']} {cur['amount']}",
                    }
                )
                swapped = True

    # 插入缺失记录（按流水顺序，插在上一笔已匹配记录之后）
    cursor = -1
    added = 0
    for b in B:
        if b["_b"] in used_b:
            t = next(p["j"] for p in pairs if p["b"]["_b"] == b["_b"])
            cursor = pos_of[t["id"]]
        else:
            ms = next(x for x in missing_with_split if x["_b"] == b["_b"])
            ts = int(datetime.now().timestamp() * 1000) + added
            added += 1
            rec = {
                "id": str(ts),
                "type": b["type"],
                "price": ms["split"]["price"],
                "grams": ms["split"]["grams"],
                "timestamp": ts,
                "isDisabled": False,
            }
            corrected.insert(cursor + 1, rec)
            cursor += 1
            pos_of[rec["id"]] = cursor

    return {
        "pairs": pairs,
        "dir_diff": dir_diff,
        "missing": missing_with_split,
        "extra": extra,
        "order_fixes": order_fixes,
        "corrected": corrected,
    }


def main():
    parser = argparse.ArgumentParser(description="银行流水对账")
    parser.add_argument("pdf", help="招行银行流水 PDF 路径")
    parser.add_argument("trades", nargs="?", default=None, help="交易 JSON 路径（缺省自动找 gold-trades-*.json）")
    parser.add_argument("--out", default=None, help="修正后 JSON 输出路径")
    parser.add_argument("--no-write", action="store_true", help="只输出报告，不写文件")
    args = parser.parse_args()

    if not os.path.exists(args.pdf):
        raise SystemExit(f"找不到 PDF 文件：{args.pdf}")
    trades_path = args.trades or find_trades_file()
    if not os.path.exists(trades_path):
        raise SystemExit(f"找不到交易 JSON：{trades_path}")

    print(f"PDF：{args.pdf}")
    print(f"JSON：{trades_path}")

    gold_records = extract_gold_records(args.pdf)
    trades, settings = load_trades(trades_path)
    before = calc_position(trades)
    r = reconcile(gold_records, trades, settings)
    after = calc_position(r["corrected"])

    print("\n===== 对账结果 =====")
    print(f"流水黄金记录：{len(gold_records)} 笔（{gold_records[0]['date']} ~ {gold_records[-1]['date']}）")
    print(f"JSON 有效交易：{sum(1 for t in trades if not t.get('isDisabled') and not t.get('isPlan'))} 笔")
    print(f"完全匹配：{len(r['pairs'])} 笔")

    if r["missing"]:
        print("\n⚠️ 流水有、JSON 缺失（已自动补录，价格/克重为推测值，请核对）：")
        for b in r["missing"]:
            cn = "买入" if b["type"] == "BUY" else "卖出"
            print(f"  {b['date']} {cn} {b['amount']:.2f} 元 → 补录 {b['split']['price']} 元/克 × {b['split']['grams']} 克")
    if r["extra"]:
        print("\nℹ️ 流水没有、JSON 存在（保留，通常是流水截止日之后的交易）：")
        for t in r["extra"]:
            cn = "买入" if t["type"] == "BUY" else "卖出"
            print(f"  {cn} {t['amount']:.2f} 元")
    if r["dir_diff"]:
        print("\nℹ️ 金额相同但买卖方向与流水相反（未改动，请人工确认）：")
        for d in r["dir_diff"]:
            print(f"  {d['b']['date']} 流水={d['b']['type']} {d['b']['amount']:.2f} / JSON={d['t']['type']} {d['t']['amount']:.2f}")
    if r["order_fixes"]:
        print(f"\nℹ️ 已按流水顺序调整 {len(r['order_fixes'])} 处记录顺序：")
        for f in r["order_fixes"]:
            print(f"  JSON 原为 {f['json_was']}，已调整为 {f['pdf_order']}")

    print("\n===== 持仓对比（不含手续费） =====")
    print(f"  对账前：持仓 {before['grams']:.2f} 克 | 均价 {before['avgCost']:.2f} | 回本价 {before['breakEven']:.2f}")
    print(f"  对账后：持仓 {after['grams']:.2f} 克 | 均价 {after['avgCost']:.2f} | 回本价 {after['breakEven']:.2f}")

    if args.no_write:
        print("\n（--no-write，未输出文件）")
        return

    out_path = args.out or os.path.join(
        os.path.dirname(os.path.abspath(trades_path)),
        "gold-trades-reconciled-" + datetime.now().strftime("%Y%m%d_%H%M") + ".json",
    )
    export_data = {
        "version": 1,
        "timestamp": int(datetime.now().timestamp() * 1000),
        "trades": r["corrected"],
        "settings": settings,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n✅ 已生成修正后 JSON：{out_path}")
    print(f"   共 {len(r['corrected'])} 笔。拿到后可在 App 中用“导入”功能自行选择是否替换。")


if __name__ == "__main__":
    main()

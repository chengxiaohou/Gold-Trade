import { GoogleGenAI } from "@google/genai";
import { HoldingState, OrderState, SimulationResult } from "../types";

export const analyzeTrade = async (
  current: HoldingState,
  order: OrderState,
  isBuy: boolean,
  simulation: SimulationResult
): Promise<string> => {
  // Always obtain the API key exclusively from process.env.API_KEY and use it directly
  if (!process.env.API_KEY) {
    return "请配置 API Key 以使用 AI 分析功能。";
  }

  // Create a new GoogleGenAI instance right before the API call
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = `
    我正在进行人民币(RMB)黄金交易。请根据以下持仓和拟交易数据，分析这笔交易的合理性。
    
    【当前持仓】
    - 持仓量: ${current.grams.toFixed(2)} 克
    - 平均成本: ${current.avgCost.toFixed(2)} 元/克
    - 已实现盈亏: ${current.realizedPnL.toFixed(2)} 元
    
    【拟执行交易】
    - 方向: ${isBuy ? '买入' : '卖出'}
    - 价格: ${order.price.toFixed(2)} 元/克
    - 数量: ${order.grams} 克
    
    【交易后预估】
    - 新的持仓量: ${simulation.newTotalGrams.toFixed(2)} 克
    - 新的平均成本: ${simulation.newAvgCost.toFixed(2)} 元/克
    ${!isBuy ? `- 本次预计实现盈亏: ${simulation.projectedPnL?.toFixed(2)} 元` : ''}
    
    请简短、专业地给出以下建议 (150字以内)：
    1. ${isBuy ? '分析这笔买入对成本摊薄的效果。' : '分析这笔卖出的获利/止损情况。'}
    2. 结合当前数据给出简要的操作风险提示。
    3. 给出 1-10 分的操作评分。
    
    语气像一位专业的资深交易员，不要使用过于复杂的金融术语。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        // Thinking budget set to 0 to minimize latency for basic text tasks
        thinkingConfig: { thinkingBudget: 0 } 
      }
    });

    // Access .text property directly as per the latest SDK guidelines
    return response.text || "无法生成分析结果。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "AI 分析服务暂时不可用，请稍后再试。";
  }
};
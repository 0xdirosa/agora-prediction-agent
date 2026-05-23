import OpenAI from "openai";
import { PolymarketMarket } from "../markets/polymarket.js";
import { BetOpportunity, evaluateOpportunity } from "../analysis/ev-calculator.js";
import { publicClient } from "../arc/constants.js";
import { formatUnits } from "viem";

export interface AgentConfig {
  name: string;
  maxBetSizeUsdc: number;
  minConfidenceThreshold: number;
  kellyFraction: number;
  pollIntervalMs: number;
}

export interface AnalysisInput {
  markets: PolymarketMarket[];
  bankrollUsdc: number;
}

export interface AnalysisResult {
  timestamp: string;
  bankrollUsdc: number;
  opportunities: BetOpportunity[];
  executedBets: BetOpportunity[];
  errors: string[];
}

export function createDefaultConfig(): AgentConfig {
  return {
    name: process.env.AGENT_NAME || "AgoraPredictor-v1",
    maxBetSizeUsdc: parseFloat(process.env.MAX_BET_SIZE_USDC || "10"),
    minConfidenceThreshold: parseFloat(process.env.MIN_CONFIDENCE_THRESHOLD || "0.65"),
    kellyFraction: parseFloat(process.env.KELLY_FRACTION || "0.25"),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "60000", 10),
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

export async function calculateProbabilities(
  market: PolymarketMarket,
): Promise<number[]> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openaiApiKey) {
    return openaiProbability(market, openaiApiKey);
  }

  return fallbackProbability(market);
}

async function openaiProbability(market: PolymarketMarket, apiKey: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey });

  const outcomesText = market.outcomes
    .map((o, i) => `${i}: ${o} (current price: ${market.outcomePrices[i] ?? "?"})`)
    .join("\n");

  const prompt = [
    `You are an expert prediction market analyst. Analyze this market and estimate the REAL probability of each outcome.`,
    ``,
    `Market: ${market.title}`,
    `Description: ${truncate(market.description, 500)}`,
    `End date: ${market.endDate}`,
    `Current volume: $${market.volume.toLocaleString()}`,
    ``,
    `Outcomes:`,
    outcomesText,
    ``,
    `Return ONLY a JSON array of probabilities (0 to 1) that sum to 1.0.`,
    `Example: [0.65, 0.35]`,
  ].join("\n");

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const text = resp.choices[0]?.message?.content?.trim() ?? "[]";
    const parsed = JSON.parse(text.replace(/```json?/gi, "").replace(/```/g, ""));
    if (Array.isArray(parsed) && parsed.length === market.outcomes.length) {
      return parsed.map(Number);
    }
    return fallbackProbability(market);
  } catch {
    return fallbackProbability(market);
  }
}

function fallbackProbability(market: PolymarketMarket): number[] {
  const prices = market.outcomePrices.map((p) => {
    const n = parseFloat(p);
    return isNaN(n) ? 0.5 : n;
  });

  const total = prices.reduce((s, p) => s + p, 0);
  if (total === 0) return prices.map(() => 1 / prices.length);

  const adjusted = prices.map(
    (p) => p + (1 - total) * (1 / prices.length),
  );

  return adjusted;
}

export async function analyzeMarkets(
  input: AnalysisInput,
  config: AgentConfig,
): Promise<AnalysisResult> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];
  const allOpportunities: BetOpportunity[] = [];

  for (const market of input.markets) {
    try {
      const predictedProbs = await calculateProbabilities(market);
      const opportunities = evaluateOpportunity({
        conditionId: market.conditionId,
        slug: market.slug,
        title: market.title,
        outcomes: market.outcomes,
        outcomePrices: market.outcomePrices,
        predictedProbabilities: predictedProbs,
        bankrollUsdc: input.bankrollUsdc,
        kellyFraction: config.kellyFraction,
        confidenceThreshold: config.minConfidenceThreshold,
        maxBetSizeUsdc: config.maxBetSizeUsdc,
      });

      for (const opp of opportunities) {
        const direction = opp.predictedProbability > opp.marketPrice ? "HIGHER" : "LOWER";
        opp.reason = `Model predicts ${opp.outcomeName} with ${(opp.predictedProbability * 100).toFixed(1)}% probability vs market ${(opp.marketPrice * 100).toFixed(1)}%. Direction: ${direction}. EV: ${(opp.expectedValue * 100).toFixed(1)}%.`;
      }

      allOpportunities.push(...opportunities);
    } catch (err) {
      errors.push(`Error analyzing ${market.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const opportunities = allOpportunities.sort((a, b) => b.expectedValue - a.expectedValue);
  const topOpps = opportunities.slice(0, 5);

  return {
    timestamp,
    bankrollUsdc: input.bankrollUsdc,
    opportunities: topOpps,
    executedBets: [],
    errors,
  };
}

export interface BetOpportunity {
  conditionId: string;
  slug: string;
  title: string;
  predictedProbability: number;
  marketPrice: number;
  expectedValue: number;
  kellyFraction: number;
  optimalBetSizeUsdc: number;
  confidence: number;
  reason: string;
  outcomeIndex: number;
  outcomeName: string;
}

export function calculateEV(
  predictedProbability: number,
  marketPrice: number,
): number {
  const impliedProb = marketPrice;
  return (predictedProbability - impliedProb) / impliedProb;
}

export function calculateKelly(
  predictedProbability: number,
  marketPrice: number,
): number {
  const b = (1 - marketPrice) / marketPrice;
  const p = predictedProbability;
  const q = 1 - p;
  if (b <= 0) return 0;
  const f = (p * b - q) / b;
  return Math.max(0, f);
}

export function calculateOptimalBet(
  predictedProbability: number,
  marketPrice: number,
  bankrollUsdc: number,
  kellyFraction: number,
): number {
  const fullKelly = calculateKelly(predictedProbability, marketPrice);
  const fractionalK = fullKelly * kellyFraction;
  return fractionalK * bankrollUsdc;
}

export function evaluateOpportunity(params: {
  conditionId: string;
  slug: string;
  title: string;
  outcomes: string[];
  outcomePrices: string[];
  predictedProbabilities: number[];
  bankrollUsdc: number;
  kellyFraction: number;
  confidenceThreshold: number;
  maxBetSizeUsdc: number;
}): BetOpportunity[] {
  const opportunities: BetOpportunity[] = [];

  for (let i = 0; i < params.outcomes.length; i++) {
    const predictedProb = params.predictedProbabilities[i];
    const marketPrice = parseFloat(params.outcomePrices[i] ?? "0.5");

    if (isNaN(marketPrice) || marketPrice <= 0 || marketPrice >= 1) continue;
    if (predictedProb <= 0 || predictedProb >= 1) continue;

    const ev = calculateEV(predictedProb, marketPrice);
    const confidenceGap = predictedProb - marketPrice;
    const confidence = Math.min(1, Math.abs(confidenceGap) * 3);

    if (confidence < params.confidenceThreshold) continue;
    if (ev <= 0) continue;

    const optimalBet = calculateOptimalBet(
      predictedProb,
      marketPrice,
      params.bankrollUsdc,
      params.kellyFraction,
    );

    const clampedBet = Math.min(optimalBet, params.maxBetSizeUsdc);

    if (clampedBet > 0.01) {
      opportunities.push({
        conditionId: params.conditionId,
        slug: params.slug,
        title: params.title,
        predictedProbability: predictedProb,
        marketPrice,
        expectedValue: ev,
        kellyFraction: calculateKelly(predictedProb, marketPrice),
        optimalBetSizeUsdc: Math.round(clampedBet * 100) / 100,
        confidence,
        reason: "",
        outcomeIndex: i,
        outcomeName: params.outcomes[i] ?? `Outcome ${i}`,
      });
    }
  }

  return opportunities.sort((a, b) => b.expectedValue - a.expectedValue);
}

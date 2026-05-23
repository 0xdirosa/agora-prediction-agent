export interface BetRecord {
  timestamp: string;
  marketQuestion: string;
  conditionId: string;
  direction: "YES" | "NO";
  outcomeIndex: number;
  size: number;
  confidence: number;
  ev: number;
  marketPrice: number;
  predictedProbability: number;
  kellyFraction: number;
  reasoning: string;
  executed: boolean;
  txHash?: string;
  error?: string;
  jobId?: string;
  jobCreateTx?: string;
  jobFundTx?: string;
  jobSubmitTx?: string;
  jobCompleteTx?: string;
}

export interface MarketOpportunity {
  conditionId: string;
  slug: string;
  title: string;
  description: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: number;
  liquidity: number;
  endDate: string;
  probability: number;
  reasoning: string;
  marketPrice: number;
  ev: number;
  isValueBet: boolean;
}

export interface BetDecision {
  shouldBet: boolean;
  direction: "YES" | "NO";
  outcomeIndex: number;
  outcomeName: string;
  size: number;
  confidence: number;
  ev: number;
  marketPrice: number;
  predictedProbability: number;
  kellyFraction: number;
  reasoning: string;
  marketQuestion: string;
  conditionId: string;
}

export interface BetResult {
  success: boolean;
  transactionId?: string;
  txHash?: string;
  size: number;
  direction: string;
  error?: string;
}

export interface CycleSummary {
  timestamp: string;
  marketsScanned: number;
  opportunitiesFound: number;
  opportunitiesWithEV: number;
  betsEvaluated: number;
  betsExecuted: number;
  totalBetVolume: number;
  reasoning: string[];
  errors: string[];
}

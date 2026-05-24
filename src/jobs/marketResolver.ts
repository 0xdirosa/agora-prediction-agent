import { fetchMarketById } from "../markets/polymarketClient.js";
import { giveFeedback } from "./reputationClient.js";
import { requestValidation, respondToValidation } from "./validationClient.js";
import type { BetRecord } from "../agent/types.js";

export interface ResolutionResult {
  conditionId: string;
  marketQuestion: string;
  direction: string;
  correct: boolean;
  score: number;
  feedbackTx?: string;
  validationTx?: string;
  resolvedAt: string;
}

export async function resolveMarket(
  bet: BetRecord,
  agentId: string,
  validatorAddress: string,
  ownerAddress: string,
): Promise<ResolutionResult | null> {
  const market = await fetchMarketById(bet.conditionId);
  if (!market) {
    return null;
  }

  const prices = market.outcomePrices.map(p => parseFloat(p));
  if (prices.length < 2) {
    return null;
  }

  const yesPrice = prices[0];
  const noPrice = prices[1];

  const isResolved = (yesPrice === 0 || yesPrice === 1) && (noPrice === 0 || noPrice === 1);
  if (!isResolved) {
    return null;
  }

  const winnerWon = yesPrice === 1 ? "YES" : "NO";

  const correct = bet.direction === winnerWon;
  const score = correct ? 100 : 0;

  const tag = correct
    ? `prediction_correct|${bet.conditionId.substring(0, 10)}`
    : `prediction_wrong|${bet.conditionId.substring(0, 10)}`;

  console.log(`\n  ── Market Resolution ──`);
  console.log(`  Market: ${bet.marketQuestion.substring(0, 60)}`);
  console.log(`  Predicted: ${bet.direction} (${(bet.predictedProbability * 100).toFixed(1)}%)`);
  console.log(`  Actual winner: ${winnerWon}`);
  console.log(`  ${correct ? "✓ CORRECT" : "✗ WRONG"} — score: ${score}`);

  let feedbackTx: string | undefined;
  let validationTx: string | undefined;

  try {
    const feedback = await giveFeedback(
      validatorAddress,
      agentId,
      score,
      tag,
      {
        metadataURI: `polymarket://${bet.conditionId}`,
        evidenceURI: `onchain://resolution/${bet.conditionId}`,
        comment: `Prediction ${correct ? "correct" : "wrong"}: ${bet.direction} at ${(bet.predictedProbability * 100).toFixed(1)}%, actual winner ${winnerWon}`,
      },
    );
    feedbackTx = feedback.txHash;
  } catch (err) {
    console.log(`  ⚠️  Reputation update skipped: ${err instanceof Error ? err.message : "error"}`);
  }

  try {
    const requestURI = `resolution|${bet.conditionId}|${winnerWon}|${correct ? "correct" : "wrong"}`;
    const valReq = await requestValidation(ownerAddress, agentId, validatorAddress, requestURI);
    const valResp = await respondToValidation(
      validatorAddress,
      valReq.requestHash,
      correct,
      { tag: `prediction_resolution_${correct ? "correct" : "wrong"}` },
    );
    validationTx = valResp.txHash;
  } catch (err) {
    console.log(`  ⚠️  Validation update skipped: ${err instanceof Error ? err.message : "error"}`);
  }

  return {
    conditionId: bet.conditionId,
    marketQuestion: bet.marketQuestion,
    direction: bet.direction,
    correct,
    score,
    feedbackTx,
    validationTx,
    resolvedAt: new Date().toISOString(),
  };
}

export async function resolveMarkets(
  bets: BetRecord[],
  agentId: string,
  validatorAddress: string,
  ownerAddress: string,
): Promise<ResolutionResult[]> {
  const unresolved = bets.filter(b => !b.resolved);

  if (unresolved.length === 0) {
    console.log("[Resolver] No unresolved bets to check");
    return [];
  }

  console.log(`\n═══ Checking ${unresolved.length} unresolved markets ═══`);

  const results: ResolutionResult[] = [];
  for (let i = 0; i < unresolved.length; i++) {
    const bet = unresolved[i];
    console.log(`\n[RESOLVE ${i + 1}/${unresolved.length}] "${bet.marketQuestion.substring(0, 60)}..."`);

    try {
      const result = await resolveMarket(bet, agentId, validatorAddress, ownerAddress);
      if (result) {
        results.push(result);
        bet.resolved = true;
        bet.resolvedCorrectly = result.correct;
        bet.resolutionScore = result.score;
        bet.resolutionTxHash = result.feedbackTx;
      } else {
        console.log(`  ⏳ Market not yet resolved — skipping`);
      }
    } catch (err) {
      console.log(`  ⚠️  Resolution check error: ${err instanceof Error ? err.message : "error"}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const correct = results.filter(r => r.correct).length;
  console.log(`\n[RESOLVER] Checked ${results.length} resolved markets: ${correct} correct, ${results.length - correct} wrong`);
  if (results.length > 0) {
    console.log(`[RESOLVER] Accuracy: ${(correct / results.length * 100).toFixed(1)}%`);
  }

  return results;
}

export function getAccuracy(bets: BetRecord[]): { total: number; resolved: number; correct: number; accuracy: number | null } {
  const resolved = bets.filter(b => b.resolved);
  const correct = resolved.filter(b => b.resolvedCorrectly);
  return {
    total: bets.length,
    resolved: resolved.length,
    correct: correct.length,
    accuracy: resolved.length > 0 ? correct.length / resolved.length : null,
  };
}

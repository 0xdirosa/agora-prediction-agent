import { fetchActiveMarkets } from "../markets/polymarketClient.js";
import { calculateEV, kellyBetSize, isValueBet } from "../analysis/evCalculator.js";
import { estimateProbability } from "../analysis/sentimentAnalyzer.js";
import { initWallet, getUSDCBalance, transferAndWait } from "../wallet/circleWallet.js";
import type {
  MarketOpportunity,
  BetDecision,
  BetRecord,
  BetResult,
  CycleSummary,
} from "./types.js";

const MAX_BETS_PER_CATEGORY = 2;
const MIN_MARKET_PRICE = 0.08;
const MAX_MARKET_PRICE = 0.92;
const MIN_VOLUME = 1000;

function getCategory(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("world cup") || q.includes("fifa")) return "sports-worldcup";
  if (q.includes("nba") || q.includes("nfl") || q.includes("nhl") || q.includes("mlb") || q.includes("ncaa")) return "sports-other";
  if (q.includes("trump") || q.includes("biden") || q.includes("elon") || q.includes("musk")) return "politics";
  if (q.includes("fed") || q.includes("rate") || q.includes("inflation") || q.includes("cpi") || q.includes("gdp")) return "macro";
  if (q.includes("election") || q.includes("president") || q.includes("senate") || q.includes("congress")) return "politics";
  if (q.includes("bitcoin") || q.includes("crypto") || q.includes("eth") || q.includes("solana")) return "crypto";
  return "other";
}

export class PredictionAgent {
  private walletId: string;
  private walletAddress: string;
  private bankroll: number;
  private maxBetPercent: number;
  private minEV: number;
  private betsPlaced: BetRecord[];
  private initialized: boolean;
  private _running: boolean = false;
  private dryRun: boolean = true;

  constructor() {
    this.walletId = process.env.CIRCLE_WALLET_ID ?? process.env.AGENT_WALLET_ID ?? "";
    this.walletAddress = process.env.CIRCLE_WALLET_ADDRESS ?? process.env.AGENT_WALLET_ADDRESS ?? "";
    this.bankroll = 0;
    this.maxBetPercent = parseFloat(process.env.AGENT_MAX_BET_PERCENT ?? "0.1");
    this.minEV = parseFloat(process.env.AGENT_MIN_EV ?? "0.1");
    this.betsPlaced = [];
    this.initialized = false;
  }

  async initialize(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  PredictionAgent Initialization                  ║");
    console.log("╚══════════════════════════════════════════════════╝");

    if (!this.walletId || !this.walletAddress) {
      console.log("[WARN] CIRCLE_WALLET_ID / CIRCLE_WALLET_ADDRESS not set — using simulated bankroll");
      this.bankroll = parseFloat(process.env.SIMULATED_BANKROLL ?? "1000");
      this.dryRun = true;
      console.log(`[INFO] Simulated bankroll: $${this.bankroll.toFixed(2)} USDC`);
    } else {
      try {
        initWallet();
        const balance = await getUSDCBalance(this.walletId);
        this.bankroll = balance;
        this.walletAddress = process.env.CIRCLE_WALLET_ADDRESS!;
        console.log(`[WALLET] ID: ${this.walletId}`);
        console.log(`[WALLET] Address: ${this.walletAddress}`);
        console.log(`[BALANCE] Real USDC balance: $${this.bankroll.toFixed(2)}`);
        if (this.bankroll <= 0) {
          console.log("[WARN] Balance is 0 — agent will dry-run without real execution");
          console.log("[HINT] Fund wallet at https://faucet.circle.com");
          this.dryRun = true;
        } else {
          this.dryRun = false;
        }
      } catch (err) {
        console.log(`[WARN] Circle wallet fetch failed: ${err instanceof Error ? err.message : "error"}`);
        console.log("[INFO] Falling back to simulated bankroll");
        this.bankroll = parseFloat(process.env.SIMULATED_BANKROLL ?? "1000");
        this.dryRun = true;
        console.log(`[INFO] Simulated bankroll: $${this.bankroll.toFixed(2)} USDC`);
      }
    }

    console.log(`[CONFIG] Max bet per market: ${(this.maxBetPercent * 100).toFixed(1)}% of bankroll`);
    console.log(`[CONFIG] Min EV threshold: ${(this.minEV * 100).toFixed(1)}%`);
    console.log(`[CONFIG] Kelly fraction: 0.5 (half-Kelly for safety)`);
    console.log(`[CONFIG] LLM: Groq llama-3.1-8b-instant`);
    console.log(`[CONFIG] Mode: ${this.dryRun ? "DRY RUN (no real transfers)" : "LIVE (real transfers enabled)"}`);
    console.log(`[NETWORK] Chain: Arc Testnet (5042002)`);
    console.log(`[NETWORK] RPC: https://rpc.testnet.arc.network`);

    this.initialized = true;
    console.log("[STATUS] PredictionAgent ready\n");
  }

  async scanMarkets(): Promise<MarketOpportunity[]> {
    this.requireInit();

    console.log("═══ Scanning Markets ═══");
    const timestamp = new Date().toISOString();
    console.log(`[SCAN] ${timestamp}`);

    const markets = await fetchActiveMarkets(undefined, 50);
    console.log(`[SCAN] Raw markets from Gamma API: ${markets.length}`);

    const filtered = markets.filter((m) => {
      const vol = parseFloat(m.volume);
      const liq = parseFloat(m.liquidity);
      return vol > 1000 && liq > 500 && m.active && !m.closed;
    });
    console.log(`[SCAN] After filter (vol>1000, liq>500, active): ${filtered.length}`);

    const eligibleMarkets = filtered.filter((m) => {
      const price = parseFloat(m.outcomePrices[0] ?? "0.5");
      if (price < MIN_MARKET_PRICE) {
        console.log(`  ⏭️  SKIP ${m.title.substring(0, 50)} — price ${(price * 100).toFixed(1)}% < ${(MIN_MARKET_PRICE * 100).toFixed(0)}%`);
        return false;
      }
      if (price > MAX_MARKET_PRICE) {
        console.log(`  ⏭️  SKIP ${m.title.substring(0, 50)} — price ${(price * 100).toFixed(1)}% > ${(MAX_MARKET_PRICE * 100).toFixed(0)}%`);
        return false;
      }
      const vol = parseFloat(m.volume);
      if (vol < MIN_VOLUME) {
        console.log(`  ⏭️  SKIP ${m.title.substring(0, 50)} — volume $${vol.toFixed(0)} < $${MIN_VOLUME}`);
        return false;
      }
      return true;
    });

    console.log(`[SCAN] Eligible markets (price ${(MIN_MARKET_PRICE * 100).toFixed(0)}-${(MAX_MARKET_PRICE * 100).toFixed(0)}%, vol>$${MIN_VOLUME}): ${eligibleMarkets.length}/${filtered.length}`);

    if (eligibleMarkets.length === 0) {
      console.log("[SCAN] No eligible markets — returning empty");
      return [];
    }

    const opportunities: MarketOpportunity[] = [];

    for (let i = 0; i < eligibleMarkets.length; i++) {
      const m = eligibleMarkets[i];
      const marketPrice = parseFloat(m.outcomePrices[0] ?? "0.5");

      console.log(`\n[ANALYZE ${i + 1}/${filtered.length}] "${m.title.substring(0, 60)}..."`);
      console.log(`  Condition ID: ${m.conditionId}`);
      console.log(`  Volume: $${parseFloat(m.volume).toLocaleString()} | Liquidity: $${parseFloat(m.liquidity).toLocaleString()}`);
      console.log(`  Market price (YES): ${(marketPrice * 100).toFixed(1)}%`);

      let probability = marketPrice;
      let reasoning = "";
      try {
        await new Promise(r => setTimeout(r, 500));
        const result = await estimateProbability(m.title, marketPrice);
        probability = result.probability;
        reasoning = result.reasoning;
      } catch (err) {
        console.log(`  [Groq] analysis error: ${err instanceof Error ? err.message : "error"}`);
        probability = marketPrice;
      }

      const yesPrice = marketPrice;
      const noPrice = 1 - yesPrice;
      const noProb = 1 - probability;
      const yesEv = calculateEV(probability, yesPrice);
      const noEv = calculateEV(noProb, noPrice);
      const ev = Math.max(yesEv, noEv);
      const bestDir = yesEv >= noEv ? "YES" : "NO";
      const bestEdge = yesEv >= noEv ? probability - yesPrice : noProb - noPrice;
      const valueBet = isValueBet(ev, this.minEV);

      console.log(`  Groq estimate: ${(probability * 100).toFixed(1)}% | YES_ev: ${(yesEv * 100).toFixed(2)}% | NO_ev: ${(noEv * 100).toFixed(2)}% | Best: ${bestDir} (${(ev * 100).toFixed(2)}%) | Value bet: ${valueBet}`);

      opportunities.push({
        conditionId: m.conditionId,
        slug: m.slug,
        title: m.title,
        description: m.description,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        volume: parseFloat(m.volume),
        liquidity: parseFloat(m.liquidity),
        endDate: m.endDate,
        probability,
        reasoning,
        marketPrice,
        ev,
        isValueBet: valueBet,
      });
    }

    const withEV = opportunities.filter((o) => o.isValueBet);
    console.log(`\n[SCAN] Total scanned: ${opportunities.length} | +EV opportunities: ${withEV.length}`);
    return opportunities;
  }

  async evaluateOpportunity(opportunity: MarketOpportunity): Promise<BetDecision> {
    this.requireInit();

    const edgeVal = opportunity.probability - opportunity.marketPrice;
    console.log(`\n═══ Evaluating Opportunity ═══`);
    console.log(`[MARKET] ${opportunity.title}`);
    console.log(`[CONDITION] ${opportunity.conditionId}`);
    console.log(`[PRICE] ${(opportunity.marketPrice * 100).toFixed(1)}% | Groq: ${(opportunity.probability * 100).toFixed(1)}% | Edge: ${edgeVal > 0 ? '+' : ''}${(edgeVal * 100).toFixed(2)}pp`);

    // Build reasoning chain
    const reasoningChain: string[] = [];
    reasoningChain.push(`--- AI DECISION CHAIN ---`);
    reasoningChain.push(`Market: "${opportunity.title}"`);
    reasoningChain.push(`Description: ${opportunity.description.substring(0, 200)}`);
    reasoningChain.push(`Outcomes: ${opportunity.outcomes.join(" | ")}`);
    reasoningChain.push(`Current prices: ${opportunity.outcomePrices.join(", ")}`);

    // Step 1: Determine which outcome has edge
    let yesPrice = opportunity.marketPrice;
    let noPrice = 1 - yesPrice;
    reasoningChain.push(`\nStep 1 — Market Price Analysis:`);
    reasoningChain.push(`  YES token price: ${(yesPrice * 100).toFixed(1)}% (implied probability)`);
    reasoningChain.push(`  NO token price: ${(noPrice * 100).toFixed(1)}%`);

    // Step 2: Groq analysis
    const direction: "YES" | "NO" = opportunity.probability > yesPrice ? "YES" : "NO";
    const outcomeIndex = direction === "YES" ? 0 : 1;
    const outcomeName = opportunity.outcomes[outcomeIndex] ?? direction;

    reasoningChain.push(`\nStep 2 — Groq LLM Analysis:`);
    reasoningChain.push(`  Groq estimated probability: ${(opportunity.probability * 100).toFixed(1)}%`);
    reasoningChain.push(`  Groq reasoning: ${opportunity.reasoning}`);

    // Step 3: Final probability (convert to direction-specific probability)
    const finalProbability = opportunity.probability;
    const mktPrice = direction === "YES" ? yesPrice : noPrice;
    const betProb = direction === "YES" ? finalProbability : 1 - finalProbability;
    const edgePp = betProb - mktPrice;
    reasoningChain.push(`\nStep 3 — Final Probability Estimate:`);
    reasoningChain.push(`  Groq YES estimate: ${(finalProbability * 100).toFixed(1)}%`);
    reasoningChain.push(`  ${direction} probability: ${(betProb * 100).toFixed(1)}%`);
    reasoningChain.push(`  Market price (${direction}): ${(mktPrice * 100).toFixed(1)}%`);
    reasoningChain.push(`  Edge: ${edgePp > 0 ? '+' : ''}${(edgePp * 100).toFixed(2)}pp`);

    const finalEV = calculateEV(betProb, mktPrice);
    const oddsIfWin = (1 / mktPrice) - 1;
    reasoningChain.push(`\nStep 4 — EV Calculation:`);
    reasoningChain.push(`  Direction: ${direction} (market price ${(mktPrice * 100).toFixed(1)}%)`);
    reasoningChain.push(`  Odds: ${oddsIfWin.toFixed(2)}:1`);
    reasoningChain.push(`  EV per $1 bet: ${finalEV > 0 ? '+' : ''}${(finalEV * 100).toFixed(2)}%`);
    reasoningChain.push(`  EV threshold: ${(this.minEV * 100).toFixed(1)}%`);
    reasoningChain.push(`  ${finalEV > this.minEV ? "✓ POSITIVE EV — value bet" : "✗ NOT profitable — skip"}`);

    // Step 5: Bet sizing
    let shouldBet = finalEV > this.minEV && opportunity.isValueBet;
    let betSize = 0;

    if (shouldBet) {
      reasoningChain.push(`\nStep 6 — Kelly Bet Sizing:`);
      const kellyPrice = mktPrice;
      const rawKellySize = kellyBetSize(this.bankroll, betProb, kellyPrice);
      reasoningChain.push(`  Half-Kelly bet: f* = ${((rawKellySize / this.bankroll) * 100).toFixed(2)}% of bankroll`);
      reasoningChain.push(`  Raw Kelly amount: $${rawKellySize.toFixed(2)}`);

      const maxBet = this.bankroll * this.maxBetPercent;
      betSize = Math.min(rawKellySize, maxBet);
      reasoningChain.push(`  Max bet per market (${(this.maxBetPercent * 100).toFixed(1)}% of $${this.bankroll.toFixed(2)}): $${maxBet.toFixed(2)}`);
      reasoningChain.push(`  Final bet size: $${betSize.toFixed(2)} (capped at max)`);

      if (betSize < 0.01) {
        shouldBet = false;
        reasoningChain.push(`  Bet size < $0.01 — too small to execute`);
      } else {
        reasoningChain.push(`  ✓ Bet size executable`);
      }
    }

    reasoningChain.push(`\nStep 6 — Decision:`);
    reasoningChain.push(`  ${shouldBet ? "✓ PLACE BET" : "✗ NO BET"}`);
    if (shouldBet) {
      reasoningChain.push(`  Direction: ${direction}`);
      reasoningChain.push(`  Amount: $${betSize.toFixed(2)} USDC`);
    }

    const fullReasoning = reasoningChain.join("\n");
    console.log(fullReasoning);

    return {
      shouldBet,
      direction,
      outcomeIndex,
      outcomeName,
      size: betSize,
      confidence: opportunity.isValueBet ? Math.min(1, (finalEV / this.minEV) * 0.5 + 0.5) : 0,
      ev: finalEV,
      marketPrice: direction === "YES" ? yesPrice : noPrice,
      predictedProbability: finalProbability,
      kellyFraction: betSize > 0 ? betSize / this.bankroll : 0,
      reasoning: fullReasoning,
      marketQuestion: opportunity.title,
      conditionId: opportunity.conditionId,
    };
  }

  async executeBet(decision: BetDecision): Promise<BetResult> {
    this.requireInit();

    console.log(`\n═══ Executing Bet ═══`);
    console.log(`[DECISION] ${decision.shouldBet ? "APPROVED" : "REJECTED"}`);

    if (!decision.shouldBet) {
      console.log("[EXECUTE] Skipping — decision rejected this opportunity");
      return { success: false, size: 0, direction: decision.direction, error: "Decision rejected" };
    }

    // Check bankroll
    if (decision.size > this.bankroll) {
      console.log(`[EXECUTE] INSUFFICIENT FUNDS: bet $${decision.size.toFixed(2)} > bankroll $${this.bankroll.toFixed(2)}`);
      return { success: false, size: decision.size, direction: decision.direction, error: "Insufficient funds" };
    }

    console.log(`[EXECUTE] Market: "${decision.marketQuestion.substring(0, 60)}..."`);
    console.log(`[EXECUTE] Direction: ${decision.direction}`);
    console.log(`[EXECUTE] Outcome: ${decision.outcomeName}`);
    console.log(`[EXECUTE] Size: $${decision.size.toFixed(2)} USDC`);
    console.log(`[EXECUTE] Expected Value: ${(decision.ev * 100).toFixed(2)}%`);
    console.log(`[EXECUTE] Kelly Fraction: ${(decision.kellyFraction * 100).toFixed(2)}%`);
    console.log(`[EXECUTE] Confidence: ${(decision.confidence * 100).toFixed(1)}%`);

    // Record bet (bankroll deducted after successful execution)
    const record: BetRecord = {
      timestamp: new Date().toISOString(),
      marketQuestion: decision.marketQuestion,
      conditionId: decision.conditionId,
      direction: decision.direction,
      outcomeIndex: decision.outcomeIndex,
      size: decision.size,
      confidence: decision.confidence,
      ev: decision.ev,
      marketPrice: decision.marketPrice,
      predictedProbability: decision.predictedProbability,
      kellyFraction: decision.kellyFraction,
      reasoning: decision.reasoning,
      executed: true,
    };

    let txSucceeded = false;
    if (this.dryRun) {
      console.log(`[EXECUTE] [DRY RUN] Would transfer $${decision.size.toFixed(2)} USDC from ${this.walletAddress}`);
      console.log(`[EXECUTE] [DRY RUN] Skipping real transfer — dry run mode`);
      record.txHash = "dry_run";
      txSucceeded = true;
    } else {
      const destAddr = process.env.AGENT_TRANSFER_ADDRESS ?? this.walletAddress;
      console.log(`[EXECUTE] [LIVE] Sending $${decision.size.toFixed(2)} USDC to ${destAddr}...`);
      try {
        const result = await transferAndWait(this.walletId, destAddr, decision.size);
        record.txHash = result.txHash ?? "live_tx_sent";
        console.log(`[EXECUTE] ✓ Transaction complete: ${result.txHash}`);
        console.log(`[EXECUTE] ✓ Explorer: https://testnet.arcscan.app/tx/${result.txHash}`);
        txSucceeded = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[EXECUTE] ✗ Transfer failed: ${msg}`);
        record.error = msg;
      }
    }

    if (txSucceeded) {
      this.bankroll -= decision.size;
      this.betsPlaced.push(record);
      console.log(`[EXECUTE] ✓ Bet recorded. Total bets placed: ${this.betsPlaced.length}`);
      console.log(`[EXECUTE] Remaining bankroll: $${this.bankroll.toFixed(2)} USDC`);
    } else {
      console.log(`[EXECUTE] ✗ Bet skipped — transfer did not complete`);
    }

    return {
      success: true,
      size: decision.size,
      direction: decision.direction,
      txHash: record.txHash,
    };
  }

  async runCycle(): Promise<CycleSummary> {
    this.requireInit();

    const timestamp = new Date().toISOString();
    const reasoning: string[] = [];
    const errors: string[] = [];

    console.log("\n" + "=".repeat(60));
    console.log(`CYCLE START: ${timestamp}`);
    console.log("=".repeat(60));
    console.log(`Bankroll: $${this.bankroll.toFixed(2)} USDC | Bets placed so far: ${this.betsPlaced.length}`);

    reasoning.push(`[CYCLE] Starting analysis cycle at ${timestamp}`);
    reasoning.push(`[CYCLE] Bankroll: $${this.bankroll.toFixed(2)}`);

    // Step 1: Scan markets
    let opportunities: MarketOpportunity[];
    try {
      opportunities = await this.scanMarkets();
      reasoning.push(`[SCAN] Scanned ${opportunities.length} markets`);
    } catch (err) {
      const msg = `Scan failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[ERROR] ${msg}`);
      errors.push(msg);
      return this.emptySummary(timestamp, reasoning, errors);
    }

    const withEV = opportunities.filter((o) => o.isValueBet);
    reasoning.push(`[FILTER] ${withEV.length} markets with EV > ${(this.minEV * 100).toFixed(1)}%`);

    // Step 2: Sort by EV descending, take top 3
    const sorted = [...withEV].sort((a, b) => b.ev - a.ev);
    const topMarkets = sorted.slice(0, 3);

    console.log(`\nTop ${topMarkets.length} opportunities by EV:`);
    for (let i = 0; i < topMarkets.length; i++) {
      const m = topMarkets[i];
      const edge = m.probability - m.marketPrice;
      console.log(`  ${i + 1}. [Edge: ${edge > 0 ? '+' : ''}${(edge * 100).toFixed(2)}pp | EV: ${(m.ev * 100).toFixed(2)}%] ${m.title.substring(0, 60)}`);
    }

    reasoning.push(`[RANK] Top ${topMarkets.length} opportunities selected by EV`);

    // Step 3: Apply category diversification
    const categoryCount: Record<string, number> = {};
    const filteredTop: typeof topMarkets = [];

    for (const m of topMarkets) {
      const category = getCategory(m.title);

      // Category cap
      if ((categoryCount[category] ?? 0) >= MAX_BETS_PER_CATEGORY) {
        console.log(`  ⏭️  SKIP (category ${category} already ${MAX_BETS_PER_CATEGORY} bets) — ${m.title.substring(0, 60)}`);
        continue;
      }

      categoryCount[category] = (categoryCount[category] ?? 0) + 1;
      filteredTop.push(m);
    }

    reasoning.push(`[FILTER] After category diversification: ${filteredTop.length} markets remain`);

    // Step 4: Evaluate each
    let betsExecuted = 0;
    let totalBetVolume = 0;

    for (let i = 0; i < filteredTop.length; i++) {
      console.log(`\n--- Evaluating opportunity ${i + 1}/${filteredTop.length} ---`);
      let decision: BetDecision;
      try {
        decision = await this.evaluateOpportunity(filteredTop[i]);
      } catch (err) {
        const msg = `Evaluation failed for ${filteredTop[i].slug}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[ERROR] ${msg}`);
        errors.push(msg);
        continue;
      }

      reasoning.push(`[EVAL ${i + 1}] ${filteredTop[i].title}`);
      reasoning.push(`[EVAL ${i + 1}] Decision: ${decision.shouldBet ? "BET" : "PASS"} | Direction: ${decision.direction} | Size: $${decision.size.toFixed(2)}`);
      reasoning.push(`[EVAL ${i + 1}] EV: ${(decision.ev * 100).toFixed(2)}% | Kelly: ${(decision.kellyFraction * 100).toFixed(2)}%`);

      // Step 5: Execute
      if (decision.shouldBet) {
        try {
          const result = await this.executeBet(decision);
          if (result.success) {
            betsExecuted++;
            totalBetVolume += result.size;
            reasoning.push(`[EXECUTE ${i + 1}] ✓ Bet executed: $${result.size.toFixed(2)} on ${decision.direction}`);
          } else {
            reasoning.push(`[EXECUTE ${i + 1}] ✗ Bet failed: ${result.error}`);
          }
        } catch (err) {
          const msg = `Execution failed: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[ERROR] ${msg}`);
          errors.push(msg);
        }
      } else {
        reasoning.push(`[EXECUTE ${i + 1}] Skipped — insufficient EV or risk`);
      }
    }

    const summary: CycleSummary = {
      timestamp,
      marketsScanned: opportunities.length,
      opportunitiesFound: opportunities.filter((o) => o.isValueBet).length,
      opportunitiesWithEV: withEV.length,
      betsEvaluated: filteredTop.length,
      betsExecuted,
      totalBetVolume,
      reasoning,
      errors,
    };

    console.log("\n" + "-".repeat(50));
    console.log(`CYCLE SUMMARY:`);
    console.log(`  Markets scanned:     ${summary.marketsScanned}`);
    console.log(`  +EV opportunities:   ${summary.opportunitiesWithEV}`);
    console.log(`  Bets evaluated:      ${summary.betsEvaluated}`);
    console.log(`  Bets executed:       ${summary.betsExecuted}`);
    console.log(`  Total bet volume:    $${summary.totalBetVolume.toFixed(2)} USDC`);
    console.log(`  Errors:              ${summary.errors.length}`);
    console.log(`  Remaining bankroll:  $${this.bankroll.toFixed(2)} USDC`);
    console.log("-".repeat(50) + "\n");

    return summary;
  }

  async startAutonomousLoop(intervalMinutes = 60): Promise<void> {
    this.requireInit();

    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  Starting Autonomous Trading Loop               ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log(`Interval: ${intervalMinutes} minute(s)`);
    console.log(`Bankroll: $${this.bankroll.toFixed(2)} USDC`);
    console.log(`Press Ctrl+C to stop\n`);

    let cycleCount = 0;
    this._running = true;

    while (this._running) {
      cycleCount++;
      console.log(`\n${"#".repeat(60)}`);
      console.log(`# CYCLE ${cycleCount}`);
      console.log(`${"#".repeat(60)}`);

      try {
        await this.runCycle();
      } catch (err) {
        console.error(`\n[FATAL] Cycle ${cycleCount} crashed: ${err instanceof Error ? err.message : String(err)}`);
        console.error("[FATAL] Continuing to next cycle...");
      }

      console.log(`\nCycle ${cycleCount} complete.`);
      console.log(`Total bets placed: ${this.betsPlaced.length}`);
      console.log(`Remaining bankroll: $${this.bankroll.toFixed(2)} USDC`);

      if (this.bankroll <= 0) {
        console.log("[WARN] Bankroll depleted! Stopping agent.");
        break;
      }

      if (!this._running) break;
      console.log(`\nSleeping ${intervalMinutes} minute(s) until next cycle...`);
      await new Promise((r) => setTimeout(r, intervalMinutes * 60 * 1000));
    }
    this._running = false;

    console.log("\n" + "=".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total cycles: ${cycleCount}`);
    console.log(`Total bets placed: ${this.betsPlaced.length}`);
    console.log(`Final bankroll: $${this.bankroll.toFixed(2)} USDC`);
    console.log(`Total wagered: $${this.betsPlaced.reduce((s, b) => s + b.size, 0).toFixed(2)} USDC`);
    console.log("=".repeat(60));
  }

  getBetsPlaced(): BetRecord[] {
    return [...this.betsPlaced];
  }

  getBankroll(): number {
    return this.bankroll;
  }

  stop(): void {
    if (!this._running) {
      console.log("[Agent] Not currently running");
      return;
    }
    this._running = false;
    console.log("[Agent] Stop signal sent — waiting for cycle to finish...");
  }

  isRunning(): boolean {
    return this._running;
  }

  private requireInit(): void {
    if (!this.initialized) {
      throw new Error("PredictionAgent not initialized. Call initialize() first.");
    }
  }

  private emptySummary(timestamp: string, reasoning: string[], errors: string[]): CycleSummary {
    return {
      timestamp,
      marketsScanned: 0,
      opportunitiesFound: 0,
      opportunitiesWithEV: 0,
      betsEvaluated: 0,
      betsExecuted: 0,
      totalBetVolume: 0,
      reasoning,
      errors,
    };
  }
}

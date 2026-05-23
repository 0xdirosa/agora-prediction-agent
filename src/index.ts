import "dotenv/config";
import { PredictionAgent } from "./agent/predictionAgent.js";

async function main(): Promise<void> {
  const agent = new PredictionAgent();
  await agent.initialize();

  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    console.log("[MODE] Single analysis cycle (--once flag detected)\n");
    const summary = await agent.runCycle();
    console.log("\nFinal bet records:");
    for (const bet of agent.getBetsPlaced()) {
      console.log(`  [${bet.timestamp}] ${bet.direction} $${bet.size.toFixed(2)} on "${bet.marketQuestion.substring(0, 50)}..."`);
      console.log(`    EV: ${(bet.ev * 100).toFixed(2)}% | Reasoning: ${bet.reasoning.substring(0, 100)}...`);
    }
    console.log(`\nCycle complete. ${summary.betsExecuted} bets placed.`);
  } else {
    const intervalMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES ?? "60", 10);
    console.log(`[MODE] Autonomous loop — polling every ${intervalMinutes} minute(s)\n`);
    await agent.startAutonomousLoop(intervalMinutes);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

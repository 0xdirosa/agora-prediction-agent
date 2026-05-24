import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { PredictionAgent } from "./agent/predictionAgent.js";
import { getArcBalance, getBlockNumber, getStatus } from "./arc/arcClient.js";
import { getAgentScore, getFeedbackCount } from "./jobs/reputationClient.js";
import { getAccuracy } from "./jobs/marketResolver.js";
import { loadBets, loadCycles } from "./jobs/persistence.js";
import { captureConsole, restoreConsole, getLogHistory, onLog } from "./log-stream.js";
import type { BetRecord, CycleSummary } from "./agent/types.js";
import type { LogEntry } from "./log-stream.js";
import type { Request, Response } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.API_PORT ?? "3000", 10);

app.use(express.json());

// Serve dashboard static files
app.use(express.static(path.resolve(__dirname, "../dashboard")));

// ── Agent state ──
let agent: PredictionAgent | null = null;
let decisions: BetRecord[] = loadBets();
let cycles: CycleSummary[] = loadCycles();
let serverStartTime = new Date().toISOString();

console.log(`[Server] Loaded ${decisions.length} bets, ${cycles.length} cycles from disk`);

// ── API Routes ──

// GET /api/status — agent running status + cycle info
app.get("/api/status", (_req, res) => {
  const mode = agent ? (agent.isDryRun() ? "dry_run" : "live") : "stopped";
  res.json({
    status: agent?.isRunning() ? "running" : agent ? "paused" : "stopped",
    mode,
    initialized: agent !== null,
    uptime: serverStartTime,
    cyclesCompleted: cycles.length,
    lastCycle: cycles.length > 0 ? cycles[cycles.length - 1] : null,
  });
});

// GET /api/wallet — wallet balance and Arc network info
app.get("/api/wallet", async (_req, res) => {
  let balance = "N/A";
  let blockNumber = "N/A";
  let arcStatus = getStatus();

  const addr = (process.env.CIRCLE_WALLET_ADDRESS ?? process.env.AGENT_WALLET_ADDRESS) as `0x${string}` | undefined;
  if (addr) {
    try {
      const bal = await getArcBalance(addr);
      balance = bal.formatted;
    } catch { /* read-only */ }
  }

  try {
    const bn = await getBlockNumber();
    blockNumber = bn.toString();
  } catch { /* read-only */ }

  res.json({
    walletAddress: addr ?? "not configured",
    balanceUsdc: balance,
    bankroll: agent?.getBankroll()?.toFixed(2) ?? "0.00",
    arcStatus,
    blockNumber,
    network: "Arc Testnet (5042002)",
    rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
  });
});

// GET /api/decisions — last 20 decisions with full reasoning
app.get("/api/decisions", (_req, res) => {
  const last20 = decisions.slice(-20).reverse();
  res.json({ count: last20.length, decisions: last20 });
});

// GET /api/metrics — performance metrics
app.get("/api/metrics", (_req, res) => {
  const totalBets = decisions.length;
  const totalWagered = decisions.reduce((s, b) => s + b.size, 0);
  const avgEv = totalBets > 0 ? decisions.reduce((s, b) => s + b.ev, 0) / totalBets : 0;
  const totalEvCaptured = decisions.reduce((s, b) => s + b.ev * b.size, 0);
  const opportunitiesScanned = cycles.reduce((s, c) => s + c.marketsScanned, 0);

  const bestEv = totalBets > 0 ? Math.max(...decisions.map(d => d.ev)) : 0;
  const acc = getAccuracy(decisions);
  const accuracyRate = acc.accuracy !== null ? (acc.accuracy * 100).toFixed(1) + "%" : "N/A";

  res.json({
    totalCycles: cycles.length,
    totalBetsPlaced: totalBets,
    totalWageredUsdc: totalWagered.toFixed(2),
    avgEvPercent: (avgEv * 100).toFixed(2),
    bestEvPercent: (bestEv * 100).toFixed(2),
    totalEvCapturedUsdc: totalEvCaptured.toFixed(4),
    opportunitiesScanned,
    betsPerCycle: cycles.length > 0 ? (totalBets / cycles.length).toFixed(1) : "0",
    bankrollRemaining: agent?.getBankroll()?.toFixed(2) ?? "0.00",
    accuracyRate,
    resolved: acc.resolved,
    correct: acc.correct,
  });
});

// GET /api/logs — last 200 log entries
app.get("/api/logs", (_req: Request, res: Response) => {
  const logs = getLogHistory().slice(-200);
  res.json({ count: logs.length, logs });
});

// GET /api/logs/stream — SSE log stream
app.get("/api/logs/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send existing logs
  for (const entry of getLogHistory().slice(-50)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const unsubscribe = onLog((entry: LogEntry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
  });
});

// GET /api/reputation — agent onchain reputation score
app.get("/api/reputation", async (_req, res) => {
  const agentId = process.env.ARC_AGENT_ID ?? null;
  if (!agentId) {
    res.json({ agentId: null, score: null, feedbackCount: null, message: "No agent ID registered" });
    return;
  }
  const [score, feedbackCount] = await Promise.all([
    getAgentScore(agentId),
    getFeedbackCount(agentId),
  ]);
  res.json({
    agentId,
    score,
    feedbackCount,
    validatorAddress: process.env.VALIDATOR_WALLET_ADDRESS ?? null,
  });
});

// GET /api/resolution — accuracy stats
app.get("/api/resolution", (_req, res) => {
  const bets = decisions;
  const acc = getAccuracy(bets);
  res.json(acc);
});

// POST /api/resolve — trigger market resolution check
app.post("/api/resolve", async (_req: Request, res: Response) => {
  if (!agent) {
    res.status(400).json({ error: "Agent not initialized" });
    return;
  }
  try {
    await agent.resolvePastMarkets();
    const acc = getAccuracy(agent.getBetsPlaced());
    res.json({ status: "done", ...acc });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/start — run one analysis cycle
app.post("/api/start", async (_req: Request, res: Response) => {
  if (!agent) {
    agent = new PredictionAgent();
    try {
      await agent.initialize();
    } catch (err) {
      res.status(500).json({ error: `Initialization failed: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
  }

  if (agent.isRunning()) {
    res.json({ status: "already_running", message: "Agent is already running" });
    return;
  }

  // Run one cycle in background with log capture
  runCycle().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Server] Cycle error:", msg);
  });

  res.json({ status: "started", message: "Agent cycle started" });
});

// POST /api/stop — stop the agent loop
app.post("/api/stop", (_req: Request, res: Response) => {
  if (!agent) {
    res.json({ status: "stopped", message: "No agent to stop" });
    return;
  }
  agent.stop();
  res.json({ status: "stopping", message: "Stop signal sent" });
});

async function runCycle(): Promise<void> {
  if (!agent) return;

  captureConsole();

  try {
    const summary = await agent.runCycle();
    cycles.push(summary);

    // Sync decisions from agent
    decisions = agent.getBetsPlaced();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Server] Cycle error:", msg);
  } finally {
    restoreConsole();
  }
}

// No catch-all — static middleware serves index.html at /

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  Prediction Agent Dashboard Server           ║`);
  console.log(`║                                             ║`);
  console.log(`║  API:     http://localhost:${PORT}/api          ║`);
  console.log(`║  Dashboard: http://localhost:${PORT}            ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  // Auto-start autonomous cycle loop
  const intervalMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES ?? "60", 10);
  console.log(`[Server] Auto-starting agent — cycle every ${intervalMinutes} minute(s)...\n`);

  (async function autoLoop() {
    agent = new PredictionAgent();
    try {
      await agent.initialize();
      console.log(`[Server] Agent initialized — mode: ${agent.isDryRun() ? "DRY RUN" : "LIVE"}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Server] Agent init failed: ${msg}`);
      console.error("[Server] Dashboard will still serve — click Cycle to start manually");
      return;
    }

    // Run first cycle immediately
    await runCycle();

    // Then loop on interval
    while (true) {
      console.log(`\n[Server] Sleep ${intervalMinutes} min until next cycle...`);
      await new Promise(r => setTimeout(r, intervalMinutes * 60 * 1000));
      await runCycle();
    }
  })();
});

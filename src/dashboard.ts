import { getArcBalance, getBlockNumber, getGasPrice, getStatus } from "./arc/arcClient.js";
import { checkGatewayBalance } from "./arc/nanopayments.js";
import type { BetRecord } from "./agent/types.js";

export interface DashboardData {
  timestamp: string;
  arcStatus: string;
  blockNumber: string;
  gasPrice: string;
  walletBalance: string;
  gatewayBalance: string;
  bankroll: string;
  betsPlaced: number;
  totalWagered: string;
  avgEV: string;
  totalEVCaptured: string;
  agentRegistered: boolean;
  agentId: string;
}

export async function collectDashboardData(
  betsPlaced: BetRecord[],
  bankroll: number,
  agentId?: string,
): Promise<DashboardData> {
  const timestamp = new Date().toISOString();
  const arcStatus = getStatus();

  let blockNumber = "N/A";
  let gasPrice = "N/A";
  let walletBalance = "N/A";
  let gatewayBalance = "N/A";

  try {
    const bn = await getBlockNumber();
    blockNumber = bn.toString();
  } catch { /* read-only */ }

  try {
    const gp = await getGasPrice();
    gasPrice = `${gp.toString()} Gwei`;
  } catch { /* read-only */ }

  try {
    const addr = (process.env.CIRCLE_WALLET_ADDRESS ?? process.env.AGENT_WALLET_ADDRESS) as `0x${string}` | undefined;
    if (addr) {
      const bal = await getArcBalance(addr);
      walletBalance = `${bal.formatted} USDC`;
    }
  } catch { /* read-only */ }

  try {
    const gw = await checkGatewayBalance();
    gatewayBalance = `${gw.gateway} USDC`;
  } catch { /* read-only */ }

  const totalWagered = betsPlaced.reduce((s, b) => s + b.size, 0);
  const avgEV = betsPlaced.length > 0
    ? betsPlaced.reduce((s, b) => s + b.ev, 0) / betsPlaced.length
    : 0;
  const totalEVCaptured = betsPlaced.reduce((s, b) => s + b.ev * b.size, 0);

  return {
    timestamp,
    arcStatus,
    blockNumber,
    gasPrice,
    walletBalance,
    gatewayBalance,
    bankroll: bankroll.toFixed(2),
    betsPlaced: betsPlaced.length,
    totalWagered: totalWagered.toFixed(2),
    avgEV: (avgEV * 100).toFixed(2),
    totalEVCaptured: totalEVCaptured.toFixed(4),
    agentRegistered: !!agentId,
    agentId: agentId ?? "—",
  };
}

export function renderDashboard(data: DashboardData): void {
  const separator = "─".repeat(56);

  console.clear();
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║     🤖 Prediction Agent — Terminal Dashboard     ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log(separator);

  // Network section
  console.log("  🌐 Arc Network");
  console.log(`     Status:        ${data.arcStatus === "connected" ? "✅ Connected" : data.arcStatus === "read-only" ? "👁 Read-only" : "❌ Disconnected"}`);
  console.log(`     Block:         #${data.blockNumber}`);
  console.log(`     Gas price:     ${data.gasPrice}`);
  console.log(separator);

  // Balance section
  console.log("  💰 Balances");
  console.log(`     Wallet:        ${data.walletBalance}`);
  console.log(`     Gateway:       ${data.gatewayBalance}`);
  console.log(`     Bankroll:      $${data.bankroll} USDC`);
  console.log(separator);

  // Agent section
  console.log("  🤖 Agent Identity");
  console.log(`     Registered:    ${data.agentRegistered ? "✅ Yes" : "❌ No"}`);
  console.log(`     Agent ID:      ${data.agentId}`);
  console.log(separator);

  // Performance section
  console.log("  📊 Performance");
  console.log(`     Bets placed:   ${data.betsPlaced}`);
  console.log(`     Total wagered: $${data.totalWagered} USDC`);
  console.log(`     Avg EV/bet:    ${data.avgEV}%`);
  console.log(`     Total EV:      ${data.totalEVCaptured} USDC`);
  console.log(separator);

  // Arbitrum/EIP section — show timestamp
  console.log(`  🕐 Last updated: ${data.timestamp}`);
  console.log(separator);
  console.log("  Press Ctrl+C to exit\n");
}

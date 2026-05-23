import "dotenv/config";
import { initWallet, getBalance, getWalletAddress } from "./circleWallet.js";

async function main() {
  const walletId = process.env.CIRCLE_WALLET_ID ?? process.env.AGENT_WALLET_ID;
  if (!walletId) {
    console.error("CIRCLE_WALLET_ID not set. Run node scripts/setup-wallet.mjs first.");
    process.exit(1);
  }

  initWallet();

  const address = await getWalletAddress(walletId);
  console.log(`\nWallet: ${address} (${walletId})\n`);

  const balances = await getBalance(walletId);

  if (balances.length === 0) {
    console.log("No token balances found.");
    console.log("Fund wallet from https://faucet.circle.com");
    process.exit(0);
  }

  const usdc = balances.find((b) => b.symbol === "USDC");
  if (usdc) {
    console.log(`\nUSDC Balance: ${parseFloat(usdc.amount).toFixed(2)} USDC`);
  }
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

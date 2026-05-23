import "dotenv/config";
import { initWallet, createWalletSet, createWallet } from "./circleWallet.js";

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Circle Wallet Setup — Agora Prediction     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  initWallet();

  const walletSet = await createWalletSet("Agora Prediction Agent");

  console.log(`\n── Creating wallets (SCA, ARC-TESTNET) ──`);
  const wallets = await createWallet(walletSet.id, {
    count: 2,
    accountType: "SCA",
    blockchain: "ARC-TESTNET",
  });

  const trading = wallets[0];
  const reserve = wallets[1];

  console.log(`\n── WALLET SUMMARY ──`);
  console.log(`\nWallet Set:`);
  console.log(`  ID:   ${walletSet.id}`);

  console.log(`\nTrading Wallet:`);
  console.log(`  ID:      ${trading.id}`);
  console.log(`  Address: ${trading.address}`);
  console.log(`  Type:    ${trading.accountType}`);

  console.log(`\nReserve Wallet:`);
  console.log(`  ID:      ${reserve.id}`);
  console.log(`  Address: ${reserve.address}`);
  console.log(`  Type:    ${reserve.accountType}`);

  console.log(`\n── NEXT STEPS ──`);
  console.log(`1. Add these to your .env file:`);
  console.log(`   CIRCLE_WALLET_SET_ID=${walletSet.id}`);
  console.log(`   CIRCLE_WALLET_ID=${trading.id}`);
  console.log(`   CIRCLE_WALLET_ADDRESS=${trading.address}`);
  console.log(`   CIRCLE_RESERVE_WALLET_ID=${reserve.id}`);
  console.log(`   CIRCLE_RESERVE_WALLET_ADDRESS=${reserve.address}`);
  console.log(`\n2. Fund the trading wallet:`);
  console.log(`   https://faucet.circle.com`);
  console.log(`\n3. Check balance:`);
  console.log(`   npm run check-balance`);
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

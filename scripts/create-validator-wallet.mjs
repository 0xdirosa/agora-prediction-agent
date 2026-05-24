#!/usr/bin/env node

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ENV_WALLET_PATH = resolve(PROJECT_ROOT, ".env.wallet");

function loadDotEnvWallet() {
  if (!existsSync(ENV_WALLET_PATH)) return;
  const content = readFileSync(ENV_WALLET_PATH, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function saveToEnvWallet(entries) {
  let content = "";
  if (existsSync(ENV_WALLET_PATH)) {
    content = readFileSync(ENV_WALLET_PATH, "utf-8");
  }

  const lines = content.split("\n");
  const updatedLines = [...lines];

  for (const [key, value] of Object.entries(entries)) {
    const existingIdx = updatedLines.findIndex((l) =>
      l.trim().startsWith(`${key}=`),
    );
    const newLine = `${key}=${value}`;
    if (existingIdx >= 0) {
      updatedLines[existingIdx] = newLine;
    } else {
      updatedLines.push(newLine);
    }
  }

  const cleaned = updatedLines.join("\n").trimEnd() + "\n";
  writeFileSync(ENV_WALLET_PATH, cleaned, "utf-8");
  console.log(`  ✓ Saved to ${ENV_WALLET_PATH}`);
}

function saveToEnv(entries) {
  const envPath = resolve(PROJECT_ROOT, ".env");
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  const lines = content.split("\n");
  const updatedLines = [...lines];

  for (const [key, value] of Object.entries(entries)) {
    const existingIdx = updatedLines.findIndex((l) =>
      l.trim().startsWith(`${key}=`),
    );
    const newLine = `${key}=${value}`;
    if (existingIdx >= 0) {
      updatedLines[existingIdx] = newLine;
    } else {
      updatedLines.push(newLine);
    }
  }

  const cleaned = updatedLines.join("\n").trimEnd() + "\n";
  writeFileSync(envPath, cleaned, "utf-8");
  console.log(`  ✓ Saved to .env`);
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Create Validator Wallet for ERC-8004 Reputation    ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  loadDotEnvWallet();

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;

  const missing = [];
  if (!apiKey) missing.push("CIRCLE_API_KEY");
  if (!entitySecret) missing.push("CIRCLE_ENTITY_SECRET");
  if (!walletSetId) missing.push("CIRCLE_WALLET_SET_ID");

  if (missing.length > 0) {
    console.error("\n  ❌ Missing required credentials:");
    for (const m of missing) console.error(`     - ${m}`);
    console.error("\n  Run scripts/setup-wallet.mjs first.\n");
    process.exit(1);
  }

  console.log(`\n  Wallet Set ID: ${walletSetId}`);
  console.log(`  API Key:       ${apiKey.slice(0, 20)}...`);

  console.log("\n  ◆ Initializing Circle SDK...");
  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
  console.log("  ✓ Circle SDK ready");

  console.log("\n  ◆ Creating validator wallet on ARC-TESTNET (SCA)...");
  const response = await circleClient.createWallets({
    walletSetId,
    blockchains: ["ARC-TESTNET"],
    count: 1,
    accountType: "SCA",
  });

  const wallet = response.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    console.error("\n  ❌ Wallet creation failed: no wallet returned");
    console.error(`  Response: ${JSON.stringify(response.data)}`);
    process.exit(1);
  }

  console.log(`  ✓ Wallet ID:      ${wallet.id}`);
  console.log(`  ✓ Wallet Address: ${wallet.address}`);
  console.log(`  ✓ Blockchain:     ${wallet.blockchain}`);
  console.log(`  ✓ Account Type:   ${wallet.accountType}`);

  console.log("\n  ◆ Saving credentials...");
  saveToEnvWallet({
    VALIDATOR_WALLET_ID: wallet.id,
    VALIDATOR_WALLET_ADDRESS: wallet.address,
  });
  saveToEnv({
    VALIDATOR_WALLET_ID: wallet.id,
    VALIDATOR_WALLET_ADDRESS: wallet.address,
  });

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   ✅ Validator Wallet Created                      ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Validator ID:      ${wallet.id}`);
  console.log(`  Validator Address: ${wallet.address}`);
  console.log(`  Wallet Set:        ${walletSetId}`);
  console.log("");
  console.log("  This wallet will be used to:");
  console.log("  - Call giveFeedback() on ReputationRegistry");
  console.log("  - Respond to validationRequest() on ValidationRegistry");
  console.log("  - Record onchain reputation for the agent");
  console.log("");
  console.log("  Next: restart the agent to use the validator wallet");
  console.log("");
}

main().catch((err) => {
  console.error(`\n  ❌ Error: ${err.message}`);
  if (err.stack) console.error(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}`);
  process.exit(1);
});

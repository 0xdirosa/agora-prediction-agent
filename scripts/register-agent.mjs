#!/usr/bin/env node

/**
 * Register AI agent on Arc Testnet using ERC-8004 standard.
 *
 * Reads credentials from .env and .env.wallet, calls register() on the
 * IdentityRegistry contract via Circle Developer-Controlled Wallets SDK,
 * retrieves the minted agent ID from Transfer events, and saves results.
 *
 * Reference: docs.arc.network/arc/tutorials/register-your-first-ai-agent.md
 * ERC-8004:  https://eips.ethereum.org/EIPS/eip-8004
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, parseAbiItem, getContract } from "viem";
import { arcTestnet } from "viem/chains";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// ── Constants from docs ──
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const METADATA_URI =
  process.env.AGENT_METADATA_URI ??
  "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei";
const RPC_URL =
  process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
const EXPLORER = "https://testnet.arcscan.app";
const FAUCET = "https://faucet.circle.com";

// ── Paths ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_WALLET_PATH = resolve(__dirname, "../.env.wallet");

// ── Utility ──
function title(text) {
  const len = text.length + 4;
  console.log(`\n${"─".repeat(len)}`);
  console.log(`  ${text}`);
  console.log(`${"─".repeat(len)}`);
}

function step(text) {
  console.log(`\n  ◆ ${text}`);
}

function info(label, value) {
  console.log(`    ${label}: ${value}`);
}

function ok(text) {
  console.log(`    ✓ ${text}`);
}

function warn(text) {
  console.log(`    ⚠️  ${text}`);
}

// ── Load .env.wallet into process.env (supplement dotenv) ──
function loadDotEnvWallet() {
  if (!existsSync(ENV_WALLET_PATH)) {
    console.warn("  ⚠️  .env.wallet not found — some variables may be missing");
    return;
  }
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

// ── Save to .env.wallet (append or update) ──
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
      // Append before last line or at end
      updatedLines.push(newLine);
    }
  }

  // Clean up trailing blank lines, add one at end
  const cleaned = updatedLines.join("\n").trimEnd() + "\n";
  writeFileSync(ENV_WALLET_PATH, cleaned, "utf-8");
  ok(`Saved to ${ENV_WALLET_PATH}`);
}

// ── Wait for Circle tx confirmation ──
async function waitForTransaction(circleClient, txId, label) {
  process.stdout.write(`    Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      const txHash = data.transaction.txHash;
      console.log(` ✓`);
      info("Tx hash", txHash);
      info("Explorer", `${EXPLORER}/tx/${txHash}`);
      return txHash;
    }
    if (data?.transaction?.state === "FAILED") {
      const reason = data.transaction.errorReason ?? "unknown";
      throw new Error(`${label} failed onchain: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`${label} timed out after 120s`);
}

// ── Main ──
async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║    ERC-8004 AI Agent Registration on Arc Testnet   ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  // ── Step 1: Load credentials ──
  title("Step 1: Load credentials");
  loadDotEnvWallet();

  const ownerAddress = process.env.CIRCLE_WALLET_ADDRESS;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  const missing = [];
  if (!ownerAddress) missing.push("CIRCLE_WALLET_ADDRESS (.env.wallet)");
  if (!apiKey) missing.push("CIRCLE_API_KEY (.env)");
  if (!entitySecret) missing.push("CIRCLE_ENTITY_SECRET (.env)");

  if (missing.length > 0) {
    console.error("\n  ❌ Missing required credentials:");
    for (const m of missing) console.error(`     - ${m}`);
    console.error("\n  Run scripts/setup-wallet.mjs first to create a wallet.\n");
    process.exit(1);
  }

  info("Owner address", ownerAddress);
  info("API key", apiKey.slice(0, 20) + "...");
  info("RPC URL", RPC_URL);
  info("Metadata URI", METADATA_URI);

  // ── Step 2: Initialize clients ──
  title("Step 2: Initialize SDK clients");

  step("Initializing Circle Developer-Controlled Wallets SDK...");
  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
  ok("Circle SDK ready");

  step("Connecting to Arc Testnet via viem...");
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(RPC_URL),
  });

  // Verify connection
  const chainId = await publicClient.getChainId();
  info("Chain ID", `${chainId} (0x${chainId.toString(16).toUpperCase()})`);
  ok("Viem client connected");

  // ── Step 3: Check wallet balance ──
  title("Step 3: Check wallet balance");

  step("Checking native USDC balance...");
  let balance;
  try {
    balance = await publicClient.getBalance({
      address: ownerAddress,
    });
    const balanceFormatted = (Number(balance) / 1e18).toFixed(4);
    info("Balance", `${balanceFormatted} USDC (native)`);

    if (balance === 0n) {
      warn("No native USDC found — wallet may not be funded.");
      warn(`Fund at ${FAUCET}`);
      warn("Continuing (Circle Gas Station should cover transaction fees)...");
    } else {
      ok("Wallet has funds for gas");
    }
  } catch (err) {
    warn(`Could not check balance: ${err.message}`);
    warn("Continuing anyway (Circle Gas Station covers fees)...");
  }

  // ── Step 4: Display plan ──
  title("Step 4: Execution plan");

  console.log("  The following actions will be performed:");
  console.log("");
  console.log("    1. Call register(metadataURI) on IdentityRegistry");
  console.log(`       Contract: ${IDENTITY_REGISTRY}`);
  console.log(`       Metadata: ${METADATA_URI}`);
  console.log("    2. Wait for Circle transaction to confirm (COMPLETE)");
  console.log("    3. Query Transfer event to retrieve Agent ID (tokenId)");
  console.log("    4. Verify onchain: ownerOf + tokenURI");
  console.log("    5. Save ARC_AGENT_ID and ARC_AGENT_TX to .env.wallet");
  console.log("");

  // ── Step 5: Register agent identity ──
  title("Step 5: Register agent identity");

  step("Submitting register() transaction via Circle SDK...");
  console.log(`    Contract function: register(string)`);
  console.log(`    Parameters: ["${METADATA_URI}"]`);

  let registerTx;
  try {
    registerTx = await circleClient.createContractExecutionTransaction({
      walletAddress: ownerAddress,
      blockchain: "ARC-TESTNET",
      contractAddress: IDENTITY_REGISTRY,
      abiFunctionSignature: "register(string)",
      abiParameters: [METADATA_URI],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    ok("Transaction submitted");
  } catch (err) {
    console.error(`\n  ❌ Registration submission failed: ${err.message}`);
    if (err.message?.includes("insufficient") || err.message?.includes("gas")) {
      warn("This may be a gas/funding issue.");
      warn(`Fund wallet at ${FAUCET} and try again.`);
    }
    process.exit(1);
  }

  const txId = registerTx.data?.id;
  if (!txId) {
    console.error("\n  ❌ No transaction ID in response");
    process.exit(1);
  }
  info("Transaction ID", txId);

  const txHash = await waitForTransaction(circleClient, txId, "registration");

  // ── Step 6: Retrieve agent ID from Transfer event ──
  title("Step 6: Retrieve agent ID");

  step("Querying Transfer events from IdentityRegistry...");
  const latestBlock = await publicClient.getBlockNumber();
  const blockRange = 10000n;
  const fromBlock =
    latestBlock > blockRange ? latestBlock - blockRange : 0n;
  info("Search range", `#${fromBlock} → #${latestBlock}`);

  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ),
    args: {
      to: ownerAddress,
    },
    fromBlock,
    toBlock: latestBlock,
  });

  if (transferLogs.length === 0) {
    console.error(
      "\n  ❌ No Transfer events found — registration may have failed or block range is too narrow",
    );
    console.error("  Try expanding fromBlock or check tx on explorer:");
    console.error(`  ${EXPLORER}/tx/${txHash}`);
    process.exit(1);
  }

  const lastTransfer = transferLogs[transferLogs.length - 1];
  const agentId = lastTransfer.args.tokenId.toString();
  info("Found Transfer events", `${transferLogs.length}`);
  info("Agent ID (tokenId)", agentId);
  ok("Agent ID retrieved");

  // ── Step 7: Verify onchain ──
  title("Step 7: Verify onchain");

  step("Verifying ownerOf and tokenURI...");
  const identityContract = getContract({
    address: IDENTITY_REGISTRY,
    abi: [
      {
        name: "ownerOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
      },
      {
        name: "tokenURI",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "string" }],
      },
    ],
    client: publicClient,
  });

  const onchainOwner = await identityContract.read.ownerOf([BigInt(agentId)]);
  const tokenURI = await identityContract.read.tokenURI([BigInt(agentId)]);

  info("Onchain owner", onchainOwner);
  info("Token URI", tokenURI);

  if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    warn("Owner mismatch! The Transfer event's 'to' may not be the current owner.");
  } else {
    ok("Owner verified — onchain owner matches wallet address");
  }

  if (tokenURI !== METADATA_URI) {
    warn("Metadata URI differs from input — check registration params");
  } else {
    ok("Metadata URI verified");
  }

  // ── Step 8: Save to .env.wallet ──
  title("Step 8: Save to .env.wallet");

  saveToEnvWallet({
    ARC_AGENT_ID: agentId,
    ARC_AGENT_TX: txHash,
  });

  // ── Summary ──
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         ✅ Agent Registered on Arc Testnet         ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  info("Agent ID", agentId);
  info("TX Hash", txHash);
  info("Owner", ownerAddress);
  info("Metadata", METADATA_URI);
  info("Explorer", `${EXPLORER}/tx/${txHash}`);
  info("Identity Registry", `${EXPLORER}/address/${IDENTITY_REGISTRY}`);
  console.log("");

  ok("Your AI agent now has a unique onchain identity via ERC-8004");
  info("Next steps", "Run the agent dashboard: npm run server");
  console.log("");
}

main().catch((err) => {
  console.error(`\n  ❌ Error: ${err.message}`);
  if (err.stack) console.error(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}`);
  process.exit(1);
});

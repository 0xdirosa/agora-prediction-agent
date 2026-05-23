import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
  type PublicClient,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "./constants.js";

export interface ArcConnection {
  chain: typeof arcTestnet;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  address?: Address;
}

export type ArcStatus = "connected" | "read-only" | "disconnected";

let _connection: ArcConnection | null = null;
let _status: ArcStatus = "disconnected";

export function connectToArcTestnet(privateKey?: Hex): ArcConnection {
  if (_connection) return _connection;

  const chain = arcTestnet;
  const publicClient = createPublicClient({
    chain,
    transport: http(ARC_TESTNET.rpcUrl),
  });

  let walletClient: WalletClient | undefined;
  let address: Address | undefined;

  if (privateKey) {
    const account = privateKeyToAccount(privateKey);
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(ARC_TESTNET.rpcUrl),
    });
    address = account.address;
    _status = "connected";
    console.log(`[ArcClient] Connected as ${address}`);
  } else {
    _status = "read-only";
    console.log("[ArcClient] Read-only mode (no private key)");
  }

  console.log(`[ArcClient] Chain: ${chain.name} (${ARC_TESTNET.chainId})`);
  console.log(`[ArcClient] RPC: ${ARC_TESTNET.rpcUrl}`);

  _connection = { chain, publicClient, walletClient, address };
  return _connection;
}

export function getStatus(): ArcStatus {
  return _status;
}

export async function getArcBalance(address: Address): Promise<{ raw: bigint; formatted: string }> {
  const conn = connectToArcTestnet();
  const raw = await conn.publicClient.getBalance({ address });
  const formatted = formatEther(raw);
  console.log(`[ArcClient] Balance of ${address}: ${formatted} USDC`);
  return { raw, formatted };
}

export async function sendTransaction(
  to: Address,
  value: bigint,
  data?: Hex,
): Promise<Hex> {
  const conn = connectToArcTestnet();
  if (!conn.walletClient || !conn.address) {
    throw new Error("[ArcClient] Cannot send tx: wallet not initialized (no private key)");
  }

  console.log(`[ArcClient] Sending tx:`);
  console.log(`  From: ${conn.address}`);
  console.log(`  To:   ${to}`);
  console.log(`  Value: ${formatEther(value)} USDC`);

  const hash = await conn.walletClient.sendTransaction({
    account: conn.address,
    to,
    value,
    data: data ?? "0x",
    chain: conn.chain,
  });

  console.log(`[ArcClient] Tx sent: ${hash}`);
  return hash;
}

export async function waitForFinality(txHash: Hex): Promise<{
  receipt: TransactionReceipt;
  elapsedMs: number;
}> {
  const conn = connectToArcTestnet();
  const start = Date.now();

  console.log(`[ArcClient] Waiting for finality: ${txHash}`);

  const receipt = await conn.publicClient.waitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 250,
  });

  const elapsedMs = Date.now() - start;

  console.log(`[ArcClient] Transaction confirmed in block ${receipt.blockNumber}`);
  console.log(`[ArcClient] Finality time: ${elapsedMs}ms (Arc sub-second ✅)`);

  return { receipt, elapsedMs };
}

export async function getBlockNumber(): Promise<bigint> {
  const conn = connectToArcTestnet();
  const blockNumber = await conn.publicClient.getBlockNumber();
  return blockNumber;
}

export async function getGasPrice(): Promise<bigint> {
  const conn = connectToArcTestnet();
  const gasPrice = await conn.publicClient.getGasPrice();
  const gasPriceGwei = Number(gasPrice) / 1e9;
  console.log(`[ArcClient] Current gas price: ${gasPriceGwei.toFixed(2)} Gwei (${formatEther(gasPrice)} USDC)`);
  return gasPrice;
}

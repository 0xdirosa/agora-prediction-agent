import {
  initiateDeveloperControlledWalletsClient,
  Blockchain,
  type WalletsDataWalletsInner,
  type Balance,
} from "@circle-fin/developer-controlled-wallets";
import { USDC_ADDRESS, USDC_DECIMALS, ARC_TESTNET } from "../arc/constants.js";

export interface WalletConfig {
  apiKey: string;
  entitySecret: string;
}

export interface WalletInfo {
  id: string;
  address: string;
  blockchain: string;
  accountType: string;
  walletSetId: string;
}

export interface TransferResult {
  id: string;
  state: "INITIATED" | "COMPLETE" | "FAILED" | "DENIED" | "CANCELLED";
  txHash?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  amount?: string;
}

export interface BalanceInfo {
  token: string;
  symbol: string;
  amount: string;
  decimals: number;
  blockchain: string;
  tokenAddress: string;
}

export class CircleWalletError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CircleWalletError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CircleWalletError(
      `Missing environment variable: ${name}. Check .env file`,
      "env",
    );
  }
  return value;
}

type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let _client: CircleClient | null = null;

export function initWallet(config?: WalletConfig): CircleClient {
  if (_client) return _client;

  const apiKey = config?.apiKey ?? requireEnv("CIRCLE_API_KEY");
  const entitySecret = config?.entitySecret ?? requireEnv("CIRCLE_ENTITY_SECRET");

  _client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  console.log(`[CircleWallet] SDK initialized for Arc Testnet (chainId: ${ARC_TESTNET.chainId})`);
  return _client;
}

export function getClient(): CircleClient {
  if (!_client) {
    throw new CircleWalletError(
      "Wallet not initialized. Call initWallet() first.",
      "init",
    );
  }
  return _client;
}

export async function createWalletSet(name: string): Promise<{ id: string; name: string }> {
  const client = getClient();

  console.log(`[CircleWallet] Creating wallet set: "${name}"`);
  const response = await client.createWalletSet({ name });

  const walletSet = response.data?.walletSet;
  if (!walletSet?.id) {
    throw new CircleWalletError(
      "Wallet set creation failed: no ID returned from API",
      "createWalletSet",
      response,
    );
  }

  console.log(`[CircleWallet] Wallet set created: ${walletSet.id}`);
  return { id: walletSet.id, name: (walletSet as { name?: string }).name ?? name };
}

export async function createWallet(
  walletSetId: string,
  options?: {
    count?: number;
    accountType?: "EOA" | "SCA";
    blockchain?: Blockchain;
  },
): Promise<WalletInfo[]> {
  const client = getClient();

  const count = options?.count ?? 1;
  const accountType = options?.accountType ?? "SCA";
  const blockchain = options?.blockchain ?? "ARC-TESTNET";

  console.log(`[CircleWallet] Creating ${count} wallet(s) on ${blockchain} (${accountType})`);
  const response = await client.createWallets({
    walletSetId,
    blockchains: [blockchain],
    count,
    accountType,
  });

  const wallets = response.data?.wallets;
  if (!wallets || wallets.length === 0) {
    throw new CircleWalletError(
      "Wallet creation failed: no wallets returned from API",
      "createWallet",
      response,
    );
  }

  const result: WalletInfo[] = wallets.map((w: WalletsDataWalletsInner) => ({
    id: w.id ?? "",
    address: w.address ?? "",
    blockchain: w.blockchain ?? "",
    accountType: (w as { accountType?: string }).accountType ?? accountType,
    walletSetId,
  }));

  for (const w of result) {
    console.log(`[CircleWallet] Wallet created: ${w.address} (id: ${w.id})`);
  }

  return result;
}

export async function getBalance(walletId: string): Promise<BalanceInfo[]> {
  const client = getClient();

  console.log(`[CircleWallet] Fetching balance for wallet ${walletId}...`);
  const response = await client.getWalletTokenBalance({ id: walletId });

  const tokenBalances = response.data?.tokenBalances ?? [];

  if (tokenBalances.length === 0) {
    console.log(`[CircleWallet] No token balances found for wallet ${walletId}`);
    return [];
  }

  const balances: BalanceInfo[] = tokenBalances.map((tb: Balance) => ({
    token: tb.token?.name ?? "Unknown",
    symbol: tb.token?.symbol ?? "???",
    amount: tb.amount ?? "0",
    decimals: tb.token?.decimals ?? 6,
    blockchain: tb.token?.blockchain ?? "unknown",
    tokenAddress: tb.token?.tokenAddress ?? "",
  }));

  for (const b of balances) {
    const usdcAmount = parseFloat(b.amount).toFixed(b.decimals === 18 ? 4 : 2);
    console.log(`[CircleWallet]   ${b.symbol}: ${usdcAmount} (${b.blockchain})`);
  }

  return balances;
}

export async function getUSDCBalance(walletId: string): Promise<number> {
  const balances = await getBalance(walletId);
  for (const b of balances) {
    if (b.symbol === "USDC") {
      return parseFloat(b.amount);
    }
  }
  return 0;
}

export async function transferUSDC(
  walletId: string,
  toAddress: string,
  amountUsdc: number,
): Promise<TransferResult> {
  const client = getClient();
  const amountAtomic = BigInt(Math.floor(amountUsdc * 1_000_000)).toString();

  console.log(`[CircleWallet] Transfer ${amountUsdc} USDC (${amountAtomic} at. units) → ${toAddress}`);

  const response = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [toAddress, amountAtomic],
    fee: { type: "level", config: { feeLevel: "HIGH" } },
  });

  const data = response.data;
  if (!data?.id) {
    throw new CircleWalletError(
      "Transfer initiation failed: no transaction ID returned",
      "transferUSDC",
      response,
    );
  }

  console.log(`[CircleWallet] Transfer initiated: ${data.id} (state: ${data.state})`);
  return {
    id: data.id,
    state: (data.state ?? "INITIATED") as TransferResult["state"],
    sourceAddress: undefined,
    destinationAddress: toAddress,
    amount: amountUsdc.toString(),
  };
}



export async function waitForCompletion(
  transactionId: string,
  options?: { maxPolls?: number; intervalMs?: number },
): Promise<TransferResult> {
  const client = getClient();
  const maxPolls = options?.maxPolls ?? 60;
  const intervalMs = options?.intervalMs ?? 2000;

  console.log(`[CircleWallet] Waiting for transaction ${transactionId}...`);

  for (let i = 0; i < maxPolls; i++) {
    const response = await client.getTransaction({ id: transactionId });
    const tx = response.data?.transaction;

    if (!tx) {
      throw new CircleWalletError(
        `Transaction ${transactionId} not found`,
        "waitForCompletion",
      );
    }

    const state = tx.state ?? "UNKNOWN";

    if (state === "COMPLETE") {
      console.log(`[CircleWallet] Transaction COMPLETE: ${tx.txHash}`);
      return {
        id: transactionId,
        state: "COMPLETE",
        txHash: tx.txHash,
        sourceAddress: tx.sourceAddress ?? undefined,
        destinationAddress: tx.destinationAddress ?? undefined,
        amount: tx.amounts?.[0] ?? undefined,
      };
    }

    if (state === "FAILED") {
      const reason = tx.errorReason ?? "unknown error";
      throw new CircleWalletError(
        `Transaction failed: ${reason}`,
        "waitForCompletion",
      );
    }

    if (state === "DENIED") {
      throw new CircleWalletError(
        "Transaction denied by risk screening",
        "waitForCompletion",
      );
    }

    if (state === "CANCELLED") {
      throw new CircleWalletError(
        "Transaction was cancelled",
        "waitForCompletion",
      );
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new CircleWalletError(
    `Transaction ${transactionId} timed out after ${maxPolls * intervalMs}ms`,
    "waitForCompletion",
  );
}

export async function getWalletAddress(walletId: string): Promise<string> {
  const client = getClient();

  console.log(`[CircleWallet] Fetching wallet details for ${walletId}...`);
  const response = await client.getWallet({ id: walletId });

  const wallet = response.data?.wallet;
  if (!wallet?.address) {
    throw new CircleWalletError(
      `Wallet ${walletId} not found or has no address`,
      "getWalletAddress",
      response,
    );
  }

  console.log(`[CircleWallet] Wallet address: ${wallet.address}`);
  return wallet.address;
}

export async function getWalletInfo(walletId: string): Promise<WalletInfo> {
  const client = getClient();

  const response = await client.getWallet({ id: walletId });
  const w = response.data?.wallet;

  if (!w) {
    throw new CircleWalletError(
      `Wallet ${walletId} not found`,
      "getWalletInfo",
    );
  }

  return {
    id: w.id ?? walletId,
    address: w.address ?? "",
    blockchain: w.blockchain ?? "",
    accountType: (w as { accountType?: string }).accountType ?? "",
    walletSetId: w.walletSetId ?? "",
  };
}

export async function transferAndWait(
  walletId: string,
  toAddress: string,
  amountUsdc: number,
): Promise<TransferResult> {
  const initiated = await transferUSDC(walletId, toAddress, amountUsdc);
  const completed = await waitForCompletion(initiated.id);
  return completed;
}

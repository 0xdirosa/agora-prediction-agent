import { getClient, waitForCompletion } from "../wallet/circleWallet.js";
import { IDENTITY_REGISTRY, publicClient } from "../arc/constants.js";

const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface AgentIdentity {
  agentId: bigint;
  owner: string;
  metadataURI: string;
}

export async function hasIdentity(walletAddress: string): Promise<bigint | null> {
  try {
    const balance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "balanceOf",
      args: [walletAddress as `0x${string}`],
    });
    if (balance === 0n) return null;
    return balance;
  } catch {
    return null;
  }
}

export async function registerIdentity(
  walletId: string,
  walletAddress: string,
  metadataURI: string,
): Promise<{ agentId: bigint; txHash: string }> {
  const client = getClient();
  console.log(`[ERC-8004] Registering agent identity: ${metadataURI.substring(0, 80)}`);

  const response = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: "register(string)",
    abiParameters: [metadataURI],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const data = response.data;
  if (!data?.id) throw new Error("No transaction ID from identity registration");

  console.log(`[ERC-8004] Registration tx: ${data.id}`);
  const completed = await waitForCompletion(data.id);
  console.log(`[ERC-8004] Identity tx done: ${completed.txHash}`);
  return { agentId: 0n, txHash: completed.txHash ?? "" };
}

export async function getAgentIdentity(agentId: bigint): Promise<AgentIdentity | null> {
  try {
    const owner = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    });
    const metadataURI = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    });
    return { agentId, owner, metadataURI };
  } catch {
    return null;
  }
}

export function buildAgentMetadata(
  name: string,
  description: string,
): string {
  return JSON.stringify({
    name,
    description,
    protocol: "agora-prediction-agent",
    version: "1.0.0",
    capabilities: ["polymarket-analysis", "groq-probability-estimation"],
    network: "arc-testnet",
  });
}

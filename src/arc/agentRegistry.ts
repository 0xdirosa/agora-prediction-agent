import {
  initiateDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import {
  createPublicClient,
  http,
  parseAbiItem,
  getContract,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET } from "./constants.js";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const METADATA_URI = "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei";

export interface AgentRegistration {
  agentId: string;
  ownerAddress: string;
  validatorAddress: string;
  metadataURI: string;
  identityTxHash?: string;
  reputationTxHash?: string;
  timestamp: string;
}

export interface AgentInfo {
  agentId: string;
  owner: Address;
  metadataURI: string;
  reputationScore?: number;
  validationStatus?: boolean;
}

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpcUrl),
});

function getCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("[AgentRegistry] CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

async function waitForTx(txId: string, label: string): Promise<string | undefined> {
  const client = getCircleClient();
  process.stdout.write(`  [AgentRegistry] Waiting for ${label}`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await client.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      const hash = data.transaction.txHash;
      console.log(` ✅`);
      console.log(`  Tx: ${ARC_TESTNET.explorerUrl}/tx/${hash}`);
      return hash;
    }
    if (data?.transaction?.state === "FAILED") {
      throw new Error(`[AgentRegistry] ${label} failed onchain`);
    }
    process.stdout.write(".");
  }
  throw new Error(`[AgentRegistry] ${label} timed out`);
}

export async function registerAgent(
  ownerAddress: string,
  validatorAddress: string,
): Promise<AgentRegistration> {
  const timestamp = new Date().toISOString();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  ERC-8004 Agent Registration                     ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`[REG] Timestamp: ${timestamp}`);
  console.log(`[REG] Owner:     ${ownerAddress}`);
  console.log(`[REG] Validator: ${validatorAddress}`);
  console.log(`[REG] Network:   Arc Testnet (${ARC_TESTNET.chainId})`);

  const client = getCircleClient();

  // Step 1: Register identity
  console.log(`\n[REG] Step 1 — Registering agent identity...`);
  console.log(`[REG] Contract: IdentityRegistry (${IDENTITY_REGISTRY})`);
  console.log(`[REG] Metadata: ${METADATA_URI}`);

  const registerTx = await client.createContractExecutionTransaction({
    walletAddress: ownerAddress,
    blockchain: "ARC-TESTNET",
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: "register(string)",
    abiParameters: [METADATA_URI],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const identityTxHash = await waitForTx(registerTx.data?.id!, "identity registration");

  // Step 2: Retrieve agent ID from Transfer event
  console.log(`\n[REG] Step 2 — Retrieving agent ID...`);
  const latestBlock = await publicClient.getBlockNumber();
  const blockRange = 10000n;
  const fromBlock = latestBlock > blockRange ? latestBlock - blockRange : 0n;

  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ),
    args: { to: ownerAddress as Address },
    fromBlock,
    toBlock: latestBlock,
  });

  if (transferLogs.length === 0) {
    throw new Error("[AgentRegistry] No Transfer events found — registration may have failed");
  }

  const agentId = transferLogs[transferLogs.length - 1].args.tokenId!.toString();
  console.log(`[REG] Agent ID: ${agentId}`);

  // Step 3: Record reputation
  console.log(`\n[REG] Step 3 — Recording reputation via validator...`);
  const tag = "prediction_agent_initialized";
  const feedbackHash = keccak256(toHex(tag));

  const reputationTx = await client.createContractExecutionTransaction({
    walletAddress: validatorAddress,
    blockchain: "ARC-TESTNET",
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature:
      "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    abiParameters: [agentId, "100", "0", tag, "", "", "", feedbackHash],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const reputationTxHash = await waitForTx(reputationTx.data?.id!, "reputation record");
  console.log(`[REG] Agent registered successfully ✅`);
  console.log(`[REG] Explorer: ${ARC_TESTNET.explorerUrl}/address/${ownerAddress}`);

  return {
    agentId,
    ownerAddress,
    validatorAddress,
    metadataURI: METADATA_URI,
    identityTxHash,
    reputationTxHash,
    timestamp,
  };
}

export async function getAgentInfo(agentId: string): Promise<AgentInfo> {
  console.log(`[AgentRegistry] Fetching info for agent ${agentId}...`);

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

  const owner = await identityContract.read.ownerOf([BigInt(agentId)]);
  const metadataURI = await identityContract.read.tokenURI([BigInt(agentId)]);

  console.log(`[AgentRegistry] Agent ${agentId}:`);
  console.log(`  Owner:       ${owner}`);
  console.log(`  Metadata:    ${metadataURI}`);

  return {
    agentId,
    owner: owner as Address,
    metadataURI,
  };
}

export async function getLatestBlock(): Promise<bigint> {
  return publicClient.getBlockNumber();
}

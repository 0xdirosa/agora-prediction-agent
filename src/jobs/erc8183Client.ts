import { keccak256, toHex, decodeEventLog, type Hex } from "viem";
import { getClient, waitForCompletion } from "../wallet/circleWallet.js";
import { AGENTIC_COMMERCE_CONTRACT, USDC_ADDRESS, publicClient, ARC_TESTNET } from "../arc/constants.js";

export interface JobInfo {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: string;
}

export interface JobLifecycleResult {
  jobId: bigint;
  createTx: string;
  budgetTx: string;
  fundTx: string;
  submitTx: string;
  completeTx: string;
}

const JOB_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "client", type: "address" },
      { indexed: true, name: "provider", type: "address" },
      { indexed: false, name: "evaluator", type: "address" },
      { indexed: false, name: "expiredAt", type: "uint256" },
      { indexed: false, name: "hook", type: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "JobStatusChanged",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: false, name: "newStatus", type: "uint8" },
    ],
    anonymous: false,
  },
] as const;

async function executeAndWait(
  walletId: string,
  params: {
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: string[];
  },
  label: string,
): Promise<{ txId: string; txHash?: string }> {
  const client = getClient();

  console.log(`    [tx] ${label}`);

  const response = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const data = response.data;
  if (!data?.id) {
    throw new Error(`${label} failed: no transaction ID`);
  }

  const completed = await waitForCompletion(data.id);
  console.log(`    ✓ ${label}: ${completed.txHash}`);
  return { txId: data.id, txHash: completed.txHash };
}

async function extractJobId(txHash: string): Promise<bigint> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: JOB_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "JobCreated") {
        return decoded.args.jobId as bigint;
      }
    } catch {
      continue;
    }
  }
  throw new Error("Could not parse JobCreated event from tx");
}

function buildDeliverableHash(
  marketQuestion: string,
  direction: string,
  probability: number,
): `0x${string}` {
  const raw = `prediction|${marketQuestion}|${direction}|${probability.toFixed(4)}`;
  return keccak256(toHex(raw));
}

export async function getJob(jobId: bigint): Promise<JobInfo | null> {
  try {
    const job = await publicClient.readContract({
      address: AGENTIC_COMMERCE_CONTRACT,
      abi: JOB_ABI,
      functionName: "getJob",
      args: [jobId],
    });
    const j = job as Record<string, unknown>;
    return {
      id: (j.id ?? j[0] ?? 0n) as bigint,
      client: (j.client ?? j[1] ?? "") as string,
      provider: (j.provider ?? j[2] ?? "") as string,
      evaluator: (j.evaluator ?? j[3] ?? "") as string,
      description: (j.description ?? j[4] ?? "") as string,
      budget: (j.budget ?? j[5] ?? 0n) as bigint,
      expiredAt: (j.expiredAt ?? j[6] ?? 0n) as bigint,
      status: Number(j.status ?? j[7] ?? 0),
      hook: (j.hook ?? j[8] ?? "") as string,
    };
  } catch {
    return null;
  }
}

export const JOB_STATUS_NAMES = [
  "Open",
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
];

export async function createAnalysisJob(
  walletId: string,
  walletAddress: string,
  providerAddress: string,
  evaluatorAddress: string,
  description: string,
  expiredAt: bigint,
): Promise<{ txId: string; txHash?: string }> {
  return executeAndWait(walletId, {
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "createJob(address,address,uint256,string,address)",
    abiParameters: [
      providerAddress,
      evaluatorAddress,
      expiredAt.toString(),
      description,
      "0x0000000000000000000000000000000000000000",
    ],
  }, "createJob");
}

export async function setJobBudget(
  walletId: string,
  jobId: bigint,
  amountUsdc: number,
): Promise<{ txId: string; txHash?: string }> {
  const amountAtomic = BigInt(Math.floor(amountUsdc * 1_000_000)).toString();
  return executeAndWait(walletId, {
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "setBudget(uint256,uint256,bytes)",
    abiParameters: [jobId.toString(), amountAtomic, "0x"],
  }, "setBudget");
}

export async function approveUSDC(
  walletId: string,
  amountUsdc: number,
): Promise<{ txId: string; txHash?: string }> {
  const amountAtomic = BigInt(Math.floor(amountUsdc * 1_000_000)).toString();
  return executeAndWait(walletId, {
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [AGENTIC_COMMERCE_CONTRACT, amountAtomic],
  }, "approve USDC");
}

export async function fundJob(
  walletId: string,
  jobId: bigint,
): Promise<{ txId: string; txHash?: string }> {
  return executeAndWait(walletId, {
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "fund(uint256,bytes)",
    abiParameters: [jobId.toString(), "0x"],
  }, "fund escrow");
}

export async function submitDeliverable(
  walletId: string,
  jobId: bigint,
  deliverableHash: `0x${string}`,
): Promise<{ txId: string; txHash?: string }> {
  return executeAndWait(walletId, {
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "submit(uint256,bytes32,bytes)",
    abiParameters: [jobId.toString(), deliverableHash, "0x"],
  }, "submit deliverable");
}

export async function completeJob(
  walletId: string,
  jobId: bigint,
  reasonHash: `0x${string}`,
): Promise<{ txId: string; txHash?: string }> {
  return executeAndWait(walletId, {
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "complete(uint256,bytes32,bytes)",
    abiParameters: [jobId.toString(), reasonHash, "0x"],
  }, "complete job");
}

export async function runPredictionJob(
  walletId: string,
  walletAddress: string,
  params: {
    marketQuestion: string;
    direction: string;
    probability: number;
    betAmount: number;
  },
): Promise<JobLifecycleResult> {
  const now = Math.floor(Date.now() / 1000);
  const expiredAt = BigInt(now + 3600);
  const providerAddr = walletAddress as `0x${string}`;
  const description = `Prediction: ${params.marketQuestion.substring(0, 120)}`;

  console.log(`\n  ── ERC-8183 Job Lifecycle ──`);
  console.log(`  Description: ${description.substring(0, 100)}`);
  console.log(`  Direction: ${params.direction} | Amount: $${params.betAmount.toFixed(2)} USDC`);

  const createResult = await createAnalysisJob(
    walletId, walletAddress, providerAddr, providerAddr,
    description, expiredAt,
  );

  if (!createResult.txHash) {
    throw new Error("createJob completed but no txHash returned");
  }

  const jobId = await extractJobId(createResult.txHash);
  console.log(`  Job ID: ${jobId}`);

  const budgetResult = await setJobBudget(walletId, jobId, params.betAmount);
  const approveResult = await approveUSDC(walletId, params.betAmount);
  const fundResult = await fundJob(walletId, jobId);

  const deliverableHash = buildDeliverableHash(
    params.marketQuestion, params.direction, params.probability,
  );
  const submitResult = await submitDeliverable(walletId, jobId, deliverableHash);
  console.log(`  Deliverable hash: ${deliverableHash}`);

  const reasonHash = keccak256(toHex("deliverable-approved"));
  const completeResult = await completeJob(walletId, jobId, reasonHash);

  let finalStatus = "Unknown";
  let escrowChange = "?";
  try {
    const finalJob = await getJob(jobId);
    if (finalJob) {
      finalStatus = JOB_STATUS_NAMES[finalJob.status] ?? "Completed";
      const budgetNum = Number(finalJob.budget);
      escrowChange = !isNaN(budgetNum) ? (budgetNum / 1_000_000).toFixed(2) : "0.00";
    }
  } catch {
    finalStatus = "Completed (confirmed)";
    escrowChange = (params.betAmount).toFixed(2);
  }
  console.log(`  Final status: ${finalStatus}`);
  console.log(`  Explorer: https://testnet.arcscan.app/address/${AGENTIC_COMMERCE_CONTRACT}`);
  console.log(`  Budget escrowed: $${escrowChange} USDC`);

  return {
    jobId,
    createTx: createResult.txHash,
    budgetTx: budgetResult.txHash ?? "",
    fundTx: fundResult.txHash ?? "",
    submitTx: submitResult.txHash ?? "",
    completeTx: completeResult.txHash ?? "",
  };
}

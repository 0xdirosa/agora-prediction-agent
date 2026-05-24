import { keccak256, toHex, createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { getClient, waitForCompletion } from "../wallet/circleWallet.js";
import { VALIDATION_REGISTRY, ARC_TESTNET } from "../arc/constants.js";

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpcUrl),
});

const VALIDATION_ABI = [
  {
    type: "function",
    name: "validationRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validator", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestURI", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "validationResponse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseURI", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getValidationStatus",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
] as const;

export interface ValidationRequestResult {
  requestHash: `0x${string}`;
  txId: string;
  txHash?: string;
}

export interface ValidationResponseResult {
  txId: string;
  txHash?: string;
}

export interface ValidationStatus {
  validatorAddress: string;
  agentId: string;
  response: number;
  responseHash: string;
  tag: string;
  lastUpdate: string;
}

async function executeAndWait(
  walletIdOrAddress: string,
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
    walletAddress: walletIdOrAddress,
    blockchain: "ARC-TESTNET",
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

export async function requestValidation(
  ownerAddress: string,
  agentId: string,
  validatorAddress: string,
  requestURI: string,
): Promise<ValidationRequestResult> {
  const requestHash = keccak256(toHex(requestURI));

  console.log(`\n  ── ValidationRegistry: requestValidation ──`);
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Validator: ${validatorAddress}`);
  console.log(`  Request URI: ${requestURI}`);
  console.log(`  Request hash: ${requestHash}`);

  const result = await executeAndWait(ownerAddress, {
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: "validationRequest(address,uint256,string,bytes32)",
    abiParameters: [validatorAddress, agentId, requestURI, requestHash],
  }, "validationRequest");

  return { requestHash, ...result };
}

export async function respondToValidation(
  validatorAddress: string,
  requestHash: `0x${string}`,
  approved: boolean,
  options?: {
    responseURI?: string;
    tag?: string;
  },
): Promise<ValidationResponseResult> {
  const responseValue = approved ? 100 : 0;
  const content = approved ? "deliverable_approved" : "deliverable_rejected";
  const responseHash = keccak256(toHex(content));

  console.log(`\n  ── ValidationRegistry: validationResponse ──`);
  console.log(`  Request hash: ${requestHash}`);
  console.log(`  Response: ${content} (${responseValue})`);

  const result = await executeAndWait(validatorAddress, {
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: "validationResponse(bytes32,uint8,string,bytes32,string)",
    abiParameters: [
      requestHash,
      responseValue.toString(),
      options?.responseURI ?? "",
      responseHash,
      options?.tag ?? "prediction_deliverable",
    ],
  }, "validationResponse");

  return result;
}

export async function getValidationStatus(
  requestHash: `0x${string}`,
): Promise<ValidationStatus | null> {
  try {
    const status = await publicClient.readContract({
      address: VALIDATION_REGISTRY,
      abi: VALIDATION_ABI,
      functionName: "getValidationStatus",
      args: [requestHash],
    });
    const arr = status as unknown as unknown[];
    return {
      validatorAddress: (arr[0] ?? "") as string,
      agentId: ((arr[1] ?? 0n) as bigint).toString(),
      response: Number(arr[2] ?? 0),
      responseHash: (arr[3] ?? "") as string,
      tag: (arr[4] ?? "") as string,
      lastUpdate: ((arr[5] ?? 0n) as bigint).toString(),
    };
  } catch {
    return null;
  }
}

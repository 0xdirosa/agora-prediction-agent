import { keccak256, toHex } from "viem";
import { getClient, waitForCompletion } from "../wallet/circleWallet.js";
import { REPUTATION_REGISTRY } from "../arc/constants.js";

export interface ReputationFeedback {
  agentId: string;
  score: number;
  feedbackType: number;
  tag: string;
  txHash?: string;
}

const GIVE_FEEDBACK_SIG = "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)";

export async function giveFeedback(
  validatorAddress: string,
  agentId: string,
  score: number,
  tag: string,
  options?: {
    feedbackType?: number;
    metadataURI?: string;
    evidenceURI?: string;
    comment?: string;
  },
): Promise<{ txId: string; txHash?: string }> {
  const client = getClient();
  const feedbackHash = keccak256(toHex(tag));

  console.log(`\n  ── ReputationRegistry: giveFeedback ──`);
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Score: ${score} | Tag: ${tag}`);
  console.log(`  Validator: ${validatorAddress}`);

  const response = await client.createContractExecutionTransaction({
    walletAddress: validatorAddress,
    blockchain: "ARC-TESTNET",
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature: GIVE_FEEDBACK_SIG,
    abiParameters: [
      agentId,
      score.toString(),
      (options?.feedbackType ?? 0).toString(),
      tag,
      options?.metadataURI ?? "",
      options?.evidenceURI ?? "",
      options?.comment ?? "",
      feedbackHash,
    ],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const data = response.data;
  if (!data?.id) {
    throw new Error("giveFeedback failed: no transaction ID");
  }

  const completed = await waitForCompletion(data.id);
  console.log(`  ✓ Feedback recorded: ${completed.txHash}`);
  return { txId: data.id, txHash: completed.txHash };
}

export async function getAgentScore(_agentId: string): Promise<number | null> {
  return null;
}

export async function getFeedbackCount(_agentId: string): Promise<number | null> {
  return null;
}

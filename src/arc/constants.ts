import { http, createPublicClient } from "viem";
import { arcTestnet } from "viem/chains";

export const ARC_TESTNET = {
  chainId: 5042002,
  chainIdHex: "0x4CEF52",
  rpcUrl: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
};

export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;

// ERC-8004 — Agent Identity
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
export const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";

// ERC-8183 — Job Contracts
export const AGENTIC_COMMERCE_CONTRACT = "0x0747EEf0706327138c69792bF28Cd525089e4583";


export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpcUrl),
});

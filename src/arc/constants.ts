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

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET.rpcUrl),
});

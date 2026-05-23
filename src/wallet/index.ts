export {
  initWallet,
  getClient,
  createWalletSet,
  createWallet,
  getBalance,
  getUSDCBalance,
  transferUSDC,
  waitForCompletion,
  getWalletAddress,
  getWalletInfo,
  transferAndWait,
  CircleWalletError,
} from "./circleWallet.js";

export type {
  WalletConfig,
  WalletInfo,
  TransferResult,
  BalanceInfo,
} from "./circleWallet.js";

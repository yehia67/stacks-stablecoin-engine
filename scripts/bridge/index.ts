/**
 * SSE Bridge SDK
 * 
 * Utilities for cross-chain stablecoin bridging between Stacks and EVM chains.
 */

// Address encoding utilities
export { 
  encodeStacksAddressToBytes32, 
  decodeBytes32ToStacksAddress 
} from './encodeStacksAddress';

export { 
  encodeEvmAddressToBytes32, 
  decodeBytes32ToEvmAddress,
  hexToClarityBuffer,
  isValidEvmAddress,
} from './encodeEvmAddress';

// Bridge operations
export { depositToStacks } from './depositToStacks';
export { withdrawToEvm, getWithdrawalStatus } from './withdrawToEvm';

// Constants
export const CHAIN_IDS = {
  ETHEREUM_MAINNET: 1,
  ETHEREUM_SEPOLIA: 11155111,
  STACKS_DOMAIN_ID: 10003,
} as const;

// Types
export interface BridgeConfig {
  network: 'mainnet' | 'testnet';
  evmRpcUrl: string;
  stacksNetwork: 'mainnet' | 'testnet';
}

export interface DepositResult {
  approvalTx: string | null;
  depositTx: string;
  blockNumber: bigint;
}

export interface WithdrawResult {
  txId: string;
  explorerUrl: string;
  evmRecipient: string;
  amount: number;
  targetChainId: number;
}

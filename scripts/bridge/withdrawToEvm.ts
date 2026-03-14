/**
 * Withdraw stablecoins from Stacks to Ethereum via burn-to-remote.
 * 
 * This script:
 * 1. Calls burn-to-remote on the stablecoin token contract
 * 2. The attestation service picks up the burn event
 * 3. xReserve releases the equivalent USDC on Ethereum
 */

import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  bufferCV,
  uintCV,
} from '@stacks/transactions';
import { STACKS_TESTNET, STACKS_MAINNET } from '@stacks/network';
import { encodeEvmAddressToBytes32 } from './encodeEvmAddress';

// Configuration
const config = {
  // Network: 'testnet' or 'mainnet'
  network: process.env.STACKS_NETWORK || 'testnet',
  
  // Contract addresses
  contracts: {
    testnet: {
      xreserveAdapter: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.xreserve-adapter',
      stablecoinToken: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.stablecoin-token',
    },
    mainnet: {
      xreserveAdapter: 'SP...', // TODO: Add mainnet addresses
      stablecoinToken: 'SP...',
    },
  },
  
  // Chain IDs
  chainIds: {
    ethereumMainnet: 1,
    ethereumSepolia: 11155111,
  },
};

interface WithdrawParams {
  senderKey: string;
  evmRecipient: string;
  amount: number; // Amount in token's smallest unit
  targetChainId?: number; // Default: Ethereum Sepolia
}

export async function withdrawToEvm(params: WithdrawParams) {
  const { senderKey, evmRecipient, amount, targetChainId = config.chainIds.ethereumSepolia } = params;
  
  // Setup network
  const network = config.network === 'mainnet' 
    ? STACKS_MAINNET 
    : STACKS_TESTNET;
  
  const contracts = config.network === 'mainnet' 
    ? config.contracts.mainnet 
    : config.contracts.testnet;
  
  console.log('=== Withdraw to EVM via xReserve Adapter ===');
  console.log('Network:', config.network);
  console.log('EVM Recipient:', evmRecipient);
  console.log('Amount:', amount);
  console.log('Target Chain ID:', targetChainId);
  
  // Encode EVM recipient to bytes32
  const recipientBytes32 = encodeEvmAddressToBytes32(evmRecipient);
  console.log('Encoded Recipient:', recipientBytes32);
  
  // Convert hex string to buffer for Clarity
  const recipientBuffer = Buffer.from(recipientBytes32.slice(2), 'hex');
  
  // Parse contract address
  const [contractAddress, contractName] = contracts.xreserveAdapter.split('.');
  
  // Build the transaction
  const txOptions = {
    contractAddress,
    contractName,
    functionName: 'burn-to-remote',
    functionArgs: [
      uintCV(amount),
      bufferCV(recipientBuffer),
      uintCV(targetChainId),
    ],
    senderKey,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Deny,
    postConditions: [
      // Add post-condition to ensure tokens are burned
      // This protects the user from unexpected behavior
    ],
  };
  
  console.log('\n--- Building Transaction ---');
  
  const transaction = await makeContractCall(txOptions);
  
  console.log('Transaction built successfully');
  console.log('Fee:', transaction.auth.spendingCondition.fee.toString(), 'microSTX');
  
  // Broadcast the transaction
  console.log('\n--- Broadcasting Transaction ---');
  
  const broadcastResponse = await broadcastTransaction({ transaction, network });
  
  if ('error' in broadcastResponse) {
    throw new Error(`Broadcast failed: ${broadcastResponse.error} - ${broadcastResponse.reason}`);
  }
  
  const txId = broadcastResponse.txid;
  console.log('Transaction ID:', txId);
  
  const explorerUrl = config.network === 'mainnet'
    ? `https://explorer.hiro.so/txid/${txId}?chain=mainnet`
    : `https://explorer.hiro.so/txid/${txId}?chain=testnet`;
  
  console.log('Explorer:', explorerUrl);
  
  console.log('\n=== Withdrawal Initiated ===');
  console.log('The attestation service will process this burn and release funds on Ethereum.');
  console.log('This typically takes ~25-60 minutes depending on network.');
  
  return {
    txId,
    explorerUrl,
    evmRecipient,
    amount,
    targetChainId,
  };
}

/**
 * Helper to get withdrawal status from the USDCx API.
 */
export async function getWithdrawalStatus(txId: string): Promise<any> {
  const apiUrl = config.network === 'mainnet'
    ? 'https://api.stacks.co/usdcx/v1'
    : 'https://api.testnet.stacks.co/usdcx/v1';
  
  const response = await fetch(`${apiUrl}/withdrawals/${txId}`);
  
  if (!response.ok) {
    throw new Error(`Failed to get withdrawal status: ${response.statusText}`);
  }
  
  return response.json();
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: STACKS_PRIVATE_KEY=... npx ts-node withdrawToEvm.ts <evm-address> <amount>');
    console.log('Example: STACKS_PRIVATE_KEY=... npx ts-node withdrawToEvm.ts 0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21 1000000');
    console.log('\nOptional: Set STACKS_NETWORK=mainnet for mainnet');
    process.exit(1);
  }
  
  const senderKey = process.env.STACKS_PRIVATE_KEY;
  if (!senderKey) {
    console.error('Error: STACKS_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }
  
  const evmRecipient = args[0];
  const amount = parseInt(args[1], 10);
  
  if (isNaN(amount) || amount <= 0) {
    console.error('Error: Amount must be a positive integer');
    process.exit(1);
  }
  
  withdrawToEvm({ senderKey, evmRecipient, amount })
    .then((result) => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

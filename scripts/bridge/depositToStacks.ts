/**
 * Deposit USDC from Ethereum to Stacks via xReserve.
 * 
 * This script:
 * 1. Approves xReserve to spend USDC
 * 2. Calls depositToRemote to initiate the cross-chain transfer
 * 
 * The Stacks attestation service will receive this event and mint
 * the equivalent amount to the specified Stacks address.
 */

import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, mainnet } from 'viem/chains';
import { encodeStacksAddressToBytes32 } from './encodeStacksAddress';

// Configuration
const config = {
  // Network: 'sepolia' for testnet, 'mainnet' for production
  network: process.env.NETWORK || 'sepolia',
  
  // RPC endpoints
  rpcUrl: process.env.RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  
  // Contract addresses (Sepolia testnet)
  contracts: {
    sepolia: {
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`,
      xReserve: '0x...' as `0x${string}`, // TODO: Add actual xReserve address
    },
    mainnet: {
      usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
      xReserve: '0x...' as `0x${string}`, // TODO: Add actual xReserve address
    },
  },
  
  // Stacks domain ID for xReserve protocol
  stacksDomainId: 10003n,
};

// ABIs
const erc20Abi = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const xReserveAbi = [
  {
    name: 'depositToRemote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'remoteDomain', type: 'uint32' },
      { name: 'recipient', type: 'bytes32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

interface DepositParams {
  privateKey: `0x${string}`;
  stacksRecipient: string;
  amount: string; // Amount in USDC (e.g., "10.5")
}

export async function depositToStacks(params: DepositParams) {
  const { privateKey, stacksRecipient, amount } = params;
  
  // Setup
  const chain = config.network === 'mainnet' ? mainnet : sepolia;
  const contracts = config.network === 'mainnet' ? config.contracts.mainnet : config.contracts.sepolia;
  
  const account = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
  
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
  
  console.log('=== Deposit to Stacks via xReserve ===');
  console.log('Network:', config.network);
  console.log('Sender:', account.address);
  console.log('Stacks Recipient:', stacksRecipient);
  console.log('Amount:', amount, 'USDC');
  
  // Convert amount to USDC units (6 decimals)
  const amountInUnits = parseUnits(amount, 6);
  
  // Check USDC balance
  const balance = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  
  console.log('USDC Balance:', formatUnits(balance, 6), 'USDC');
  
  if (balance < amountInUnits) {
    throw new Error(`Insufficient USDC balance. Have: ${formatUnits(balance, 6)}, Need: ${amount}`);
  }
  
  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: contracts.usdc,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, contracts.xReserve],
  });
  
  console.log('Current Allowance:', formatUnits(currentAllowance, 6), 'USDC');
  
  // Approve xReserve if needed
  if (currentAllowance < amountInUnits) {
    console.log('\n--- Approving xReserve to spend USDC ---');
    
    const approveHash = await walletClient.writeContract({
      address: contracts.usdc,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contracts.xReserve, amountInUnits],
    });
    
    console.log('Approval TX:', approveHash);
    
    // Wait for confirmation
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approval confirmed in block:', approveReceipt.blockNumber);
  }
  
  // Encode Stacks recipient to bytes32
  const recipientBytes32 = encodeStacksAddressToBytes32(stacksRecipient);
  console.log('Encoded Recipient:', recipientBytes32);
  
  // Execute deposit
  console.log('\n--- Executing Deposit ---');
  
  const depositHash = await walletClient.writeContract({
    address: contracts.xReserve,
    abi: xReserveAbi,
    functionName: 'depositToRemote',
    args: [
      amountInUnits,
      Number(config.stacksDomainId),
      recipientBytes32,
      '0x', // Empty hook data
    ],
  });
  
  console.log('Deposit TX:', depositHash);
  
  // Wait for confirmation
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log('Deposit confirmed in block:', depositReceipt.blockNumber);
  
  console.log('\n=== Deposit Complete ===');
  console.log('The Stacks attestation service will mint tokens to:', stacksRecipient);
  console.log('This typically takes ~15 minutes on testnet.');
  
  return {
    approvalTx: null, // Set if approval was needed
    depositTx: depositHash,
    blockNumber: depositReceipt.blockNumber,
  };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: PRIVATE_KEY=0x... npx ts-node depositToStacks.ts <stacks-address> <amount>');
    console.log('Example: PRIVATE_KEY=0x... npx ts-node depositToStacks.ts ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM 10');
    process.exit(1);
  }
  
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required');
    process.exit(1);
  }
  
  const stacksRecipient = args[0];
  const amount = args[1];
  
  depositToStacks({ privateKey, stacksRecipient, amount })
    .then((result) => {
      console.log('\nResult:', JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

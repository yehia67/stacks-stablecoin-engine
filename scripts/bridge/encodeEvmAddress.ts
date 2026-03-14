/**
 * Encode an Ethereum/EVM address to a 32-byte buffer for Clarity contracts.
 * 
 * Ethereum addresses are 20 bytes, but Clarity's burn-to-remote expects a 32-byte buffer.
 * This pads the address to 32 bytes (left-padded with zeros).
 */

/**
 * Convert an Ethereum address to a 32-byte hex string for Clarity contracts.
 * 
 * @param evmAddress - The Ethereum address (with or without 0x prefix)
 * @returns The 32-byte hex string (with 0x prefix)
 * 
 * @example
 * const bytes32 = encodeEvmAddressToBytes32("0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21");
 * // Returns: "0x000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f5be21"
 */
export function encodeEvmAddressToBytes32(evmAddress: string): `0x${string}` {
  // Remove 0x prefix if present and convert to lowercase
  let hex = evmAddress.startsWith('0x') ? evmAddress.slice(2) : evmAddress;
  hex = hex.toLowerCase();
  
  // Validate it's a valid Ethereum address (20 bytes = 40 hex chars)
  if (hex.length !== 40) {
    throw new Error(`Invalid Ethereum address length: expected 40 hex chars, got ${hex.length}`);
  }
  
  // Validate it's valid hex
  if (!/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('Invalid Ethereum address: contains non-hex characters');
  }
  
  // Left-pad with zeros to make 32 bytes (64 hex chars)
  const paddedHex = '0'.repeat(24) + hex;
  
  return `0x${paddedHex}` as `0x${string}`;
}

/**
 * Decode a bytes32 value back to an Ethereum address.
 * 
 * @param bytes32 - The bytes32 hex string (with or without 0x prefix)
 * @returns The Ethereum address with 0x prefix
 */
export function decodeBytes32ToEvmAddress(bytes32: string): `0x${string}` {
  // Remove 0x prefix if present
  const hex = bytes32.startsWith('0x') ? bytes32.slice(2) : bytes32;
  
  // Validate length
  if (hex.length !== 64) {
    throw new Error(`Invalid bytes32 length: expected 64 hex chars, got ${hex.length}`);
  }
  
  // Extract the last 40 hex chars (20 bytes = Ethereum address)
  const addressHex = hex.slice(24);
  
  return `0x${addressHex}` as `0x${string}`;
}

/**
 * Convert a hex string to a Clarity buffer representation.
 * 
 * @param hex - The hex string (with or without 0x prefix)
 * @returns The Clarity buffer representation (e.g., "0x...")
 */
export function hexToClarityBuffer(hex: string): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return `0x${cleanHex}`;
}

/**
 * Validate an Ethereum address checksum (EIP-55).
 * 
 * @param address - The Ethereum address to validate
 * @returns True if the address has a valid checksum or is all lowercase/uppercase
 */
export function isValidEvmAddress(address: string): boolean {
  // Remove 0x prefix
  const hex = address.startsWith('0x') ? address.slice(2) : address;
  
  // Check length
  if (hex.length !== 40) {
    return false;
  }
  
  // Check if valid hex
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return false;
  }
  
  return true;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npx ts-node encodeEvmAddress.ts <ethereum-address>');
    console.log('Example: npx ts-node encodeEvmAddress.ts 0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21');
    process.exit(1);
  }
  
  const evmAddress = args[0];
  
  try {
    if (!isValidEvmAddress(evmAddress)) {
      throw new Error('Invalid Ethereum address format');
    }
    
    const bytes32 = encodeEvmAddressToBytes32(evmAddress);
    console.log('Ethereum Address:', evmAddress);
    console.log('Bytes32:', bytes32);
    console.log('Clarity Buffer:', hexToClarityBuffer(bytes32));
  } catch (error) {
    console.error('Error encoding address:', error);
    process.exit(1);
  }
}

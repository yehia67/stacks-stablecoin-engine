/**
 * Encode a Stacks address to bytes32 format for Ethereum contracts.
 * 
 * Stacks addresses need to be reformatted and encoded to bytes32 on the Ethereum side.
 * This encodes the address by left-padding 11 zero bytes, then adding the version byte
 * and 20-byte hash160 from the Stacks address, resulting in a bytes32 value.
 */

import { c32addressDecode } from 'c32check';

/**
 * Convert a Stacks address to a 32-byte hex string for Ethereum contracts.
 * 
 * @param stacksAddress - The Stacks address to encode (e.g., "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")
 * @returns The bytes32 hex string (with 0x prefix)
 * 
 * @example
 * const bytes32 = encodeStacksAddressToBytes32("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
 * // Returns: "0x000000000000000000000000..." (64 hex chars after 0x)
 */
export function encodeStacksAddressToBytes32(stacksAddress: string): `0x${string}` {
  // Decode the Stacks address to get version byte and hash160
  const [version, hash160Hex] = c32addressDecode(stacksAddress);
  
  // Version byte as hex (1 byte = 2 hex chars)
  const versionHex = version.toString(16).padStart(2, '0');
  
  // Combine: 11 zero bytes (22 hex chars) + version (2 hex chars) + hash160 (40 hex chars) = 64 hex chars
  const paddedHex = '0'.repeat(22) + versionHex + hash160Hex;
  
  return `0x${paddedHex}` as `0x${string}`;
}

/**
 * Decode a bytes32 value back to a Stacks address.
 * 
 * @param bytes32 - The bytes32 hex string (with or without 0x prefix)
 * @returns The decoded Stacks address
 */
export function decodeBytes32ToStacksAddress(bytes32: string): string {
  // Remove 0x prefix if present
  const hex = bytes32.startsWith('0x') ? bytes32.slice(2) : bytes32;
  
  // Validate length
  if (hex.length !== 64) {
    throw new Error(`Invalid bytes32 length: expected 64 hex chars, got ${hex.length}`);
  }
  
  // Extract version byte (at position 22-24, after 11 zero bytes)
  const versionHex = hex.slice(22, 24);
  const version = parseInt(versionHex, 16);
  
  // Extract hash160 (last 40 hex chars)
  const hash160Hex = hex.slice(24);
  
  // Import c32check for encoding
  const { c32address } = require('c32check');
  
  return c32address(version, hash160Hex);
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npx ts-node encodeStacksAddress.ts <stacks-address>');
    console.log('Example: npx ts-node encodeStacksAddress.ts ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
    process.exit(1);
  }
  
  const stacksAddress = args[0];
  
  try {
    const bytes32 = encodeStacksAddressToBytes32(stacksAddress);
    console.log('Stacks Address:', stacksAddress);
    console.log('Bytes32:', bytes32);
  } catch (error) {
    console.error('Error encoding address:', error);
    process.exit(1);
  }
}

const PRIVATE_KEY = "9d9329599d4ad4f2d5e00773ca633c800507062d413f9659744a4ef19d645af801";
const HIRO_API_KEY = "d46bc102da6c18414d22ce1e7a34d454";
const TESTNET_URL = "https://api.testnet.hiro.so";
const DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";

async function setFee() {
  const stx = await import('@stacks/transactions');
  const { makeContractCall, AnchorMode, uintCV, PostConditionMode } = stx;
  
  // Set to 0 for testing (deployer wallet = treasury, can't transfer to self)
  const newFee = 0n;
  
  console.log('Setting registration fee to 0 STX (FREE - for testing with deployer wallet)...');
  
  // Get current nonce
  const nonceResponse = await fetch(`${TESTNET_URL}/extended/v1/address/${DEPLOYER}/nonces`, {
    headers: { 'x-api-key': HIRO_API_KEY }
  });
  const nonceData = await nonceResponse.json();
  const nonce = BigInt(nonceData.possible_next_nonce);
  console.log('Using nonce:', nonce.toString());
  
  // Create contract call transaction
  const transaction = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName: 'stablecoin-factory-v2',
    functionName: 'set-registration-fee',
    functionArgs: [uintCV(newFee)],
    senderKey: PRIVATE_KEY,
    network: 'testnet',
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee: 10000n,
    nonce: nonce,
  });
  
  // Serialize and broadcast
  const serializedTx = transaction.serialize();
  console.log('Broadcasting transaction...');
  
  const response = await fetch(`${TESTNET_URL}/v2/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-api-key': HIRO_API_KEY,
    },
    body: serializedTx,
  });
  
  const responseText = await response.text();
  console.log('Response status:', response.status);
  
  if (response.ok) {
    const txid = responseText.replace(/"/g, '');
    console.log('\n✅ SUCCESS!');
    console.log('Transaction ID:', txid);
    console.log('Explorer: https://explorer.stacks.co/txid/' + txid + '?chain=testnet');
    console.log('\nNew registration fee: 0 STX (FREE)');
  } else {
    console.error('\n❌ FAILED');
    console.error('Error:', responseText);
  }
}

setFee().catch(console.error);

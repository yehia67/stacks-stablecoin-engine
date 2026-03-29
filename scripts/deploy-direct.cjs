const fs = require('fs');

const PRIVATE_KEY = "9d9329599d4ad4f2d5e00773ca633c800507062d413f9659744a4ef19d645af801";
const HIRO_API_KEY = "d46bc102da6c18414d22ce1e7a34d454";
const TESTNET_URL = "https://api.testnet.hiro.so";

async function deployContract() {
  const stx = await import('@stacks/transactions');
  const { makeContractDeploy, AnchorMode } = stx;
  
  // Read contract source
  const contractSource = fs.readFileSync('./contracts/stablecoin-factory.clar', 'utf8');
  
  console.log('Creating transaction for testnet...');
  
  // Get current nonce
  const nonceResponse = await fetch(`https://api.testnet.hiro.so/extended/v1/address/ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF/nonces`, {
    headers: { 'x-api-key': HIRO_API_KEY }
  });
  const nonceData = await nonceResponse.json();
  const nonce = BigInt(nonceData.possible_next_nonce);
  console.log('Using nonce:', nonce.toString());

  // Create deploy transaction
  const transaction = await makeContractDeploy({
    contractName: 'stablecoin-factory-v3',
    codeBody: contractSource,
    senderKey: PRIVATE_KEY,
    network: 'testnet',
    anchorMode: AnchorMode.OnChainOnly,
    fee: 50000n,
    nonce: nonce,
  });
  
  console.log('Transaction created, sender:', transaction.auth.spendingCondition.signer);
  
  // Serialize the transaction
  const serializedTx = transaction.serialize();
  
  console.log('Transaction size:', serializedTx.length, 'bytes');
  console.log('Broadcasting to testnet...');
  
  // Broadcast directly with API key
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
  console.log('Response:', responseText);
  
  if (response.ok) {
    const txid = responseText.replace(/"/g, '');
    console.log('\n✅ SUCCESS!');
    console.log('Transaction ID:', txid);
    console.log('Explorer: https://explorer.stacks.co/txid/' + txid + '?chain=testnet');
  } else {
    console.error('\n❌ FAILED');
    try {
      const errorJson = JSON.parse(responseText);
      console.error('Error:', errorJson.error || errorJson.reason || responseText);
    } catch {
      console.error('Error:', responseText);
    }
  }
}

deployContract().catch(console.error);

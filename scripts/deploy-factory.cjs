const fs = require('fs');

const MNEMONIC = "luxury portion arrest twist satisfy sail benefit extra remove riot fabric build diesel adapt proud horror badge mix spread common egg behind garment popular";
const HIRO_API_KEY = "d46bc102da6c18414d22ce1e7a34d454";
const TESTNET_URL = "https://api.testnet.hiro.so";

async function deployContract() {
  // Dynamic imports for ESM modules
  const { makeContractDeploy, AnchorMode } = await import('@stacks/transactions');
  const { generateWallet, getStxAddress } = await import('@stacks/wallet-sdk');
  
  // Generate wallet from mnemonic
  const wallet = await generateWallet({
    secretKey: MNEMONIC,
    password: '',
  });
  
  const account = wallet.accounts[0];
  
  // Get testnet address - use 0x80 for testnet transaction version
  const address = getStxAddress({ account, transactionVersion: 0x80 });
  
  console.log('Deploying from address:', address);
  console.log('Expected address: ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF');
  
  // Read contract source
  const contractSource = fs.readFileSync('./contracts/stablecoin-factory.clar', 'utf8');
  
  // Get the private key
  const privateKey = account.stxPrivateKey;
  console.log('Private key length:', privateKey.length);
  
  // Create deploy transaction
  const txOptions = {
    contractName: 'stablecoin-factory',
    codeBody: contractSource,
    senderKey: privateKey,
    network: "testnet",
    anchorMode: AnchorMode.OnChainOnly,
    fee: 15000n,
    nonce: 8n,
  };
  
  console.log('Creating transaction...');
  const transaction = await makeContractDeploy(txOptions);
  
  // Serialize the transaction
  const serializedTx = transaction.serialize();
  
  console.log('Broadcasting transaction with API key...');
  console.log('Transaction size:', serializedTx.length, 'bytes');
  
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
  
  if (response.ok) {
    const txid = responseText.replace(/"/g, '');
    console.log('✅ Transaction ID:', txid);
    console.log('View on explorer: https://explorer.stacks.co/txid/' + txid + '?chain=testnet');
  } else {
    console.error('❌ Error:', responseText);
  }
}

deployContract().catch(console.error);

const MNEMONIC = "luxury portion arrest twist satisfy sail benefit extra remove riot fabric build diesel adapt proud horror badge mix spread common egg behind garment popular";

async function getPrivateKey() {
  const { generateWallet, getStxAddress } = await import('@stacks/wallet-sdk');
  
  const wallet = await generateWallet({
    secretKey: MNEMONIC,
    password: '',
  });
  
  const account = wallet.accounts[0];
  console.log('Private key:', account.stxPrivateKey);
  console.log('Address (mainnet):', getStxAddress({ account, transactionVersion: 0x00 }));
  console.log('Address (testnet):', getStxAddress({ account, transactionVersion: 0x80 }));
}

getPrivateKey().catch(console.error);

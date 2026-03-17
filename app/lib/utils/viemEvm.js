// @ts-nocheck
let viemModulesPromise = null;

function mnemonicToSeedBytes(mnemonic) {
  const { mnemonicToSeedSync } = require('@scure/bip39');
  return mnemonicToSeedSync(mnemonic);
}

function normalizePrivateKey(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('invalid_private_key');
  return text.startsWith('0x') ? text : `0x${text}`;
}

function normalizedLogIndex(log) {
  return Number(log?.index ?? log?.logIndex ?? 0);
}

function chainRpcUrls(rpcUrl) {
  const url = String(rpcUrl || '').trim();
  return { default: { http: [url] }, public: { http: [url] } };
}

async function loadViemModules() {
  if (!viemModulesPromise) {
    viemModulesPromise = Promise.all([
      import('viem'),
      import('viem/accounts'),
      import('viem/chains'),
      import('@noble/curves/secp256k1')
    ]).then(([viem, accounts, chains, noble]) => ({
      createPublicClient: viem.createPublicClient,
      createWalletClient: viem.createWalletClient,
      defineChain: viem.defineChain,
      encodeFunctionData: viem.encodeFunctionData,
      erc20Abi: viem.erc20Abi,
      http: viem.http,
      toHex: viem.toHex,
      HDKey: accounts.HDKey,
      privateKeyToAccount: accounts.privateKeyToAccount,
      publicKeyToAddress: accounts.publicKeyToAddress,
      secp256k1: noble.secp256k1,
      chains
    }));
  }
  return viemModulesPromise;
}

async function chainForConfig(chain, chainConfig = {}, rpcUrl = '') {
  const { defineChain, chains } = await loadViemModules();
  const builtins = {
    ethereum: chains.mainnet,
    base: chains.base,
    arbitrum: chains.arbitrum,
    polygon: chains.polygon
  };
  if (builtins[chain]) return builtins[chain];

  const chainId = Number(chainConfig?.chainId || 0);
  if (!chainId) throw new Error(`unsupported viem chain ${chain}`);
  const nativeSymbol = String(chainConfig?.nativeAsset || 'ETH').trim() || 'ETH';
  return defineChain({
    id: chainId,
    name: String(chainConfig?.name || chain),
    nativeCurrency: {
      name: nativeSymbol,
      symbol: nativeSymbol,
      decimals: 18
    },
    rpcUrls: chainRpcUrls(rpcUrl)
  });
}

async function createViemScannerProvider({ chain, chainConfig, rpcUrl, timeoutMs = 5000 }) {
  const { createPublicClient, http, erc20Abi } = await loadViemModules();
  const client = createPublicClient({
    chain: await chainForConfig(chain, chainConfig, rpcUrl),
    transport: http(rpcUrl, { timeout: timeoutMs })
  });

  return {
    client,
    getBlockNumber: async () => Number(await client.getBlockNumber()),
    getBlock: async ({ blockNumber }) => {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      return {
        ...block,
        number: Number(block.number),
        timestamp: Number(block.timestamp)
      };
    },
    getLogs: async ({ address, topics, fromBlock, toBlock }) => {
      const logs = await client.getLogs({
        address,
        topics,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock)
      });
      return logs.map((log) => ({
        ...log,
        blockNumber: Number(log.blockNumber),
        index: normalizedLogIndex(log),
        logIndex: normalizedLogIndex(log)
      }));
    },
    getBalance: async (address) => client.getBalance({ address }),
    estimateGas: async ({ from, to, data }) => client.estimateGas({ account: from, to, data }),
    getFeeData: async () => {
      const fees = await client.estimateFeesPerGas().catch(() => null);
      if (fees?.maxFeePerGas != null || fees?.maxPriorityFeePerGas != null || fees?.gasPrice != null) {
        return fees;
      }
      const gasPrice = await client.getGasPrice().catch(() => null);
      return gasPrice != null ? { gasPrice } : null;
    },
    waitForTransactionReceipt: async ({ hash, confirmations }) => client.waitForTransactionReceipt({ hash, confirmations }),
    readErc20Balance: async ({ tokenAddress, owner }) => client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner]
    }),
    estimateErc20TransferGas: async ({ tokenAddress, account, to, amount }) => client.estimateContractGas({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
      account
    })
  };
}

async function createViemWalletClient({ chain, chainConfig, rpcUrl, privateKey }) {
  const { createWalletClient, http, privateKeyToAccount } = await loadViemModules();
  return createWalletClient({
    account: privateKeyToAccount(normalizePrivateKey(privateKey)),
    chain: await chainForConfig(chain, chainConfig, rpcUrl),
    transport: http(rpcUrl)
  });
}

async function deriveEvmDepositWallet({ xpub = '', mnemonic = '', derivationPath = "m/44'/60'/0'/0", index = 0 }) {
  const numericIndex = Number(index);
  const { HDKey, privateKeyToAccount, publicKeyToAddress, secp256k1, toHex } = await loadViemModules();

  if (xpub) {
    const child = HDKey.fromExtendedKey(String(xpub).trim()).deriveChild(numericIndex);
    if (!child?.publicKey) throw new Error(`failed_to_derive_public_key_${numericIndex}`);
    const compressedPublicKey = typeof child.publicKey === 'string'
      ? child.publicKey
      : toHex(child.publicKey);
    const uncompressedPublicKey = `0x${Buffer.from(
      secp256k1.ProjectivePoint.fromHex(compressedPublicKey.slice(2)).toRawBytes(false)
    ).toString('hex')}`;
    return {
      address: publicKeyToAddress(uncompressedPublicKey),
      privateKey: ''
    };
  }

  const hdKey = HDKey.fromMasterSeed(mnemonicToSeedBytes(String(mnemonic).trim()));
  const child = hdKey.derive(`${derivationPath}/${numericIndex}`);
  if (!child?.privateKey) throw new Error(`failed_to_derive_private_key_${numericIndex}`);
  const privateKey = `0x${Buffer.from(child.privateKey).toString('hex')}`;
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey
  };
}

async function sponsorAddressForPrivateKey(privateKey) {
  const { privateKeyToAccount } = await loadViemModules();
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address;
}

async function encodeErc20TransferData({ to, amount }) {
  const { encodeFunctionData, erc20Abi } = await loadViemModules();
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount]
  });
}

module.exports = {
  createViemScannerProvider,
  createViemWalletClient,
  deriveEvmDepositWallet,
  sponsorAddressForPrivateKey,
  encodeErc20TransferData
};

// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseAbiItem
} from 'viem';
import { privateKeyToAccount, HDKey } from 'viem/accounts';
import { mainnet, base } from 'viem/chains';
import { mnemonicToSeedSync } from '@scure/bip39';

type Args = Record<string, string | boolean>;

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) continue;
    const key = entry.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function usage() {
  console.log(`
Manual ERC-20 sweeper for xpub-based deposit addresses

Required:
  --checkout <id>                Sweep from a stored checkout

Optional:
  --chain <base|ethereum>        Override detected chain
  --token <USDC|USDT>            Override detected token
  --to <address>                 Override treasury destination
  --amount-base-units <amount>   Sweep a partial amount instead of full balance
  --sponsor-private-key <key>    Optional gas sponsor key for auto-funding
  --data-dir <path>              Override data dir (default: ./data)
  --yes                          Skip confirmation prompt
  --dry-run                      Print what would be sent without broadcasting
  --help                         Show this help

Mnemonic:
  The script reads MANUAL_PAY_MNEMONIC or MANUAL_PAYMENT_MNEMONIC from env.
  If neither is set, it prompts for the mnemonic securely.

Sponsor:
  The script reads MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY or --sponsor-private-key.
  If set, it auto-funds the derived deposit address with native gas before sweeping.

Examples:
  npm run manual:sweep -- --checkout checkouts_bd0c2cda777c
  MANUAL_PAY_MNEMONIC="..." npm run manual:sweep -- --checkout checkouts_bd0c2cda777c --yes
`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseChainConfig(chain: string, rpcUrl: string) {
  const builtins: Record<string, any> = {
    ethereum: mainnet,
    base
  };
  if (builtins[chain]) return builtins[chain];
  return {
    id: 0,
    name: chain,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } }
  };
}

function promptSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) fail('Set MANUAL_PAY_MNEMONIC in env when running without a TTY.');
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';

    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(chunk: string) {
      if (chunk === '\u0003') {
        cleanup();
        reject(new Error('aborted'));
        return;
      }
      if (chunk === '\r' || chunk === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value.trim());
        return;
      }
      if (chunk === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += chunk;
    }

    stdout.write(prompt);
    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function readJsonRow(db: Database.Database, table: string, id: string) {
  const row = db.prepare(`select json from ${table} where id = ?`).get(id) as { json?: string } | undefined;
  return row?.json ? JSON.parse(row.json) : null;
}

function resolveCheckoutContext(db: Database.Database, checkoutId: string, overrides: Args) {
  const checkout = readJsonRow(db, 'checkouts', checkoutId);
  if (!checkout) fail(`Checkout not found: ${checkoutId}`);

  const derivationIndex = checkout?.manualPayment?.evm?.derivationIndex ?? checkout?.manualPayment?.derivationIndex;
  if (!Number.isInteger(derivationIndex)) fail(`Checkout ${checkoutId} does not include a manual-payment derivation index.`);

  const chain = String(overrides.chain || checkout?.manualPayment?.detectedChain || checkout?.paidChain || '').trim().toLowerCase();
  if (!chain) fail(`Checkout ${checkoutId} does not have a detected chain yet. Pass --chain base or --chain ethereum.`);

  const token = String(overrides.token || checkout?.manualPayment?.detectedAsset || checkout?.paidAsset || '').trim().toUpperCase();
  if (!token) fail(`Checkout ${checkoutId} does not have a detected token yet. Pass --token USDC or --token USDT.`);

  const toAddress = String(overrides.to || checkout?.recipientByChain?.[chain] || '').trim();
  if (!toAddress) fail(`Checkout ${checkoutId} does not have a treasury address for ${chain}. Pass --to <address>.`);

  const depositAddress = String(checkout?.manualPayment?.address || '').trim();
  if (!depositAddress) fail(`Checkout ${checkoutId} does not include a manual deposit address.`);

  return {
    checkout,
    derivationIndex: Number(derivationIndex),
    chain,
    token,
    toAddress: getAddress(toAddress),
    depositAddress: getAddress(depositAddress)
  };
}

async function deriveChildWallet(mnemonic: string, derivationPath: string, index: number) {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic.trim()));
  const child = root.derive(`${derivationPath}/${index}`);
  if (!child?.privateKey) fail(`Failed to derive private key for index ${index}.`);
  const privateKey = `0x${Buffer.from(child.privateKey).toString('hex')}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return { account, privateKey };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  loadEnv(path.join(projectRoot, '.env'));
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const checkoutId = String(args.checkout || '').trim();
  if (!checkoutId) {
    usage();
    fail('Missing --checkout <id>.');
  }

  const dataDir = path.resolve(projectRoot, String(args['data-dir'] || process.env.DATA_DIR || './data'));
  const dbPath = path.join(dataDir, 'chaincart.sqlite');
  if (!fs.existsSync(dbPath)) fail(`Database not found: ${dbPath}`);

  const chainsConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config', 'chains.json'), 'utf8'));
  const db = new Database(dbPath, { readonly: true });
  const context = resolveCheckoutContext(db, checkoutId, args);

  const tokenConfig = chainsConfig.assets?.[context.token];
  const tokenAddress = tokenConfig?.addresses?.[context.chain];
  if (!tokenAddress) fail(`No token contract configured for ${context.token} on ${context.chain}.`);

  const rpcEnvName = chainsConfig.chains?.[context.chain]?.rpcUrlEnv;
  const rpcUrl = String(process.env[rpcEnvName] || '').trim();
  if (!rpcUrl) fail(`Missing ${rpcEnvName} for chain ${context.chain}.`);

  const mnemonic = String(
    process.env.MANUAL_PAY_MNEMONIC ||
    process.env.MANUAL_PAYMENT_MNEMONIC ||
    await promptSecret('Seed phrase: ')
  ).trim();
  if (!mnemonic) fail('Mnemonic is required.');

  const derivationPath = String(process.env.MANUAL_PAYMENT_DERIVATION_PATH || "m/44'/60'/0'/0").trim();
  const { account } = await deriveChildWallet(mnemonic, derivationPath, context.derivationIndex);
  const derivedAddress = getAddress(account.address);
  if (derivedAddress !== context.depositAddress) {
    fail(`Derived address mismatch.\nExpected: ${context.depositAddress}\nDerived:  ${derivedAddress}`);
  }

  const publicClient = createPublicClient({
    chain: parseChainConfig(context.chain, rpcUrl),
    transport: http(rpcUrl)
  });
  const walletClient = createWalletClient({
    account,
    chain: parseChainConfig(context.chain, rpcUrl),
    transport: http(rpcUrl)
  });

  const decimals = Number(tokenConfig.decimals || 6);
  const tokenBalance = await publicClient.readContract({
    address: getAddress(tokenAddress),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [context.depositAddress]
  });
  if (tokenBalance <= 0n) fail(`No ${context.token} balance found on ${context.depositAddress}.`);

  const amountBaseUnits = args['amount-base-units']
    ? BigInt(String(args['amount-base-units']))
    : BigInt(tokenBalance);
  if (amountBaseUnits <= 0n) fail('Amount must be greater than zero.');
  if (amountBaseUnits > tokenBalance) fail(`Requested amount exceeds balance. Balance is ${tokenBalance.toString()} base units.`);

  const nativeBalance = await publicClient.getBalance({ address: context.depositAddress });
  const txData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [context.toAddress, amountBaseUnits]
  });
  const gasLimit = await publicClient.estimateContractGas({
    address: getAddress(tokenAddress),
    abi: erc20Abi,
    functionName: 'transfer',
    args: [context.toAddress, amountBaseUnits],
    account
  });
  const fees = await publicClient.estimateFeesPerGas().catch(() => null);
  const gasPrice = fees?.maxFeePerGas ?? fees?.gasPrice ?? await publicClient.getGasPrice();
  const gasCost = BigInt(gasLimit) * BigInt(gasPrice);
  const requiredNative = (gasCost * 12n) / 10n;
  const sponsorPrivateKey = String(
    args['sponsor-private-key'] ||
    process.env.MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY ||
    ''
  ).trim();
  const sponsorAccount = sponsorPrivateKey ? privateKeyToAccount(
    sponsorPrivateKey.startsWith('0x') ? sponsorPrivateKey as `0x${string}` : `0x${sponsorPrivateKey}` as `0x${string}`
  ) : null;

  console.log(JSON.stringify({
    checkoutId,
    chain: context.chain,
    token: context.token,
    derivationIndex: context.derivationIndex,
    from: context.depositAddress,
    to: context.toAddress,
    tokenBalanceBaseUnits: tokenBalance.toString(),
    tokenBalanceDisplay: formatUnits(tokenBalance, decimals),
    amountBaseUnits: amountBaseUnits.toString(),
    amountDisplay: formatUnits(amountBaseUnits, decimals),
    nativeBalanceWei: nativeBalance.toString(),
    requiredNativeWei: requiredNative.toString(),
    estimatedGasLimit: gasLimit.toString(),
    estimatedGasCostWei: gasCost.toString(),
    sponsorAddress: sponsorAccount?.address || ''
  }, null, 2));

  let fundingTxHash = '';
  if (nativeBalance < requiredNative) {
    if (!sponsorAccount) {
      fail(`Not enough native gas on ${context.depositAddress}. Fund the derived deposit address first on ${context.chain}, or set MANUAL_PAYMENT_SWEEP_SPONSOR_PRIVATE_KEY.\nRequired (est): ${requiredNative.toString()} wei\nCurrent:        ${nativeBalance.toString()} wei`);
    }
    const sponsorWallet = createWalletClient({
      account: sponsorAccount,
      chain: parseChainConfig(context.chain, rpcUrl),
      transport: http(rpcUrl)
    });
    const topUpAmount = requiredNative - nativeBalance;
    console.log(`Funding deposit address ${context.depositAddress} with ${topUpAmount.toString()} wei from ${sponsorAccount.address}`);
    if (!args['dry-run']) {
      fundingTxHash = await sponsorWallet.sendTransaction({
        to: context.depositAddress,
        value: topUpAmount
      });
      console.log(`Funding tx submitted: ${fundingTxHash}`);
      await publicClient.waitForTransactionReceipt({
        hash: fundingTxHash as `0x${string}`,
        confirmations: 1
      });
    }
  }

  if (args['dry-run']) {
    console.log('Dry run only. No transaction broadcast.');
    return;
  }

  if (!args.yes) {
    const accepted = await confirm('Broadcast sweep transaction? [y/N] ');
    if (!accepted) {
      console.log('Aborted.');
      return;
    }
  }

  const txHash = await walletClient.sendTransaction({
    to: getAddress(tokenAddress),
    data: txData,
    gas: gasLimit
  });
  console.log(`Sweep submitted: ${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1
  });
  console.log(JSON.stringify({
    fundingTxHash,
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    status: receipt.status
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

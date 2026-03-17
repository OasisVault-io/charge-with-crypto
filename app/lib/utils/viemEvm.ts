import { type secp256k1 as Secp256k1 } from '@noble/curves/secp256k1'
import { mnemonicToSeedSync } from '@scure/bip39'
import { type Address, type Chain, type Hex } from 'viem'
import type * as Viem from 'viem'
import type * as ViemAccounts from 'viem/accounts'
import type * as ViemChains from 'viem/chains'
import {
  type AnyRecord,
  type DerivedWalletLike,
  type EvmProviderLike,
  type WalletClientLike,
} from '../services/shared/types'

type ViemModules = {
  createPublicClient: typeof Viem.createPublicClient
  createWalletClient: typeof Viem.createWalletClient
  defineChain: typeof Viem.defineChain
  encodeFunctionData: typeof Viem.encodeFunctionData
  erc20Abi: typeof Viem.erc20Abi
  http: typeof Viem.http
  toHex: typeof Viem.toHex
  HDKey: typeof ViemAccounts.HDKey
  privateKeyToAccount: typeof ViemAccounts.privateKeyToAccount
  publicKeyToAddress: typeof ViemAccounts.publicKeyToAddress
  secp256k1: typeof Secp256k1
  chains: typeof ViemChains
}

type ChainConfigLike = AnyRecord & {
  chainId?: number | string | null
  nativeAsset?: string | null
  name?: string | null
}

type ScannerProviderInput = {
  chain: string
  chainConfig?: ChainConfigLike
  rpcUrl: string
  timeoutMs?: number
}

type WalletClientInput = {
  chain: string
  chainConfig?: ChainConfigLike
  rpcUrl: string
  privateKey: string
}

type DeriveWalletInput = {
  xpub?: string
  mnemonic?: string
  derivationPath?: string
  index?: number
}

type Erc20TransferInput = {
  to: string
  amount: bigint
}

let viemModulesPromise: Promise<ViemModules> | null = null

function mnemonicToSeedBytes(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic)
}

function normalizePrivateKey(value: unknown): Hex {
  const text = String(value || '').trim()
  if (!text) throw new Error('invalid_private_key')
  return (text.startsWith('0x') ? text : `0x${text}`) as Hex
}

function asAddress(value: string): Address {
  return value as Address
}

function asHex(value: string): Hex {
  return value as Hex
}

function normalizedLogIndex(
  log: Record<string, unknown> | null | undefined,
): number {
  return Number(log?.index ?? log?.logIndex ?? 0)
}

function chainRpcUrls(rpcUrl: string) {
  const url = String(rpcUrl || '').trim()
  return { default: { http: [url] }, public: { http: [url] } }
}

async function loadViemModules(): Promise<ViemModules> {
  if (viemModulesPromise === null) {
    viemModulesPromise = Promise.all([
      import('viem'),
      import('viem/accounts'),
      import('viem/chains'),
      import('@noble/curves/secp256k1'),
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
      chains,
    }))
  }
  return viemModulesPromise
}

async function chainForConfig(
  chain: string,
  chainConfig: ChainConfigLike = {},
  rpcUrl = '',
): Promise<Chain> {
  const { defineChain, chains } = await loadViemModules()
  const builtins: Record<string, Chain> = {
    ethereum: chains.mainnet,
    base: chains.base,
    arbitrum: chains.arbitrum,
    polygon: chains.polygon,
  }
  if (builtins[chain]) return builtins[chain]

  const chainId = Number(chainConfig?.chainId || 0)
  if (!chainId) throw new Error(`unsupported viem chain ${chain}`)
  const nativeSymbol = String(chainConfig?.nativeAsset || 'ETH').trim() || 'ETH'
  return defineChain({
    id: chainId,
    name: String(chainConfig?.name || chain),
    nativeCurrency: {
      name: nativeSymbol,
      symbol: nativeSymbol,
      decimals: 18,
    },
    rpcUrls: chainRpcUrls(rpcUrl),
  })
}

async function createViemScannerProvider({
  chain,
  chainConfig,
  rpcUrl,
  timeoutMs = 5000,
}: ScannerProviderInput): Promise<EvmProviderLike> {
  const { createPublicClient, http, erc20Abi } = await loadViemModules()
  const client = createPublicClient({
    chain: await chainForConfig(chain, chainConfig, rpcUrl),
    transport: http(rpcUrl, { timeout: timeoutMs }),
  })
  const rawClient = client as any

  return {
    client,
    getBlockNumber: async () => Number(await rawClient.getBlockNumber()),
    getBlock: async ({ blockNumber }) => {
      const block = await rawClient.getBlock({
        blockNumber: BigInt(blockNumber),
      })
      return {
        ...block,
        number: Number(block.number),
        timestamp: Number(block.timestamp),
      }
    },
    getLogs: async ({ address, topics, fromBlock, toBlock }) => {
      const logs = await rawClient.getLogs({
        address: asAddress(address),
        topics,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      })
      return logs.map((log) => ({
        ...log,
        blockNumber: Number(log.blockNumber),
        index: normalizedLogIndex(log),
        logIndex: normalizedLogIndex(log),
      }))
    },
    getBalance: async (address: string) =>
      rawClient.getBalance({ address: asAddress(address) }),
    estimateGas: async ({ from, to, data }) =>
      rawClient.estimateGas({
        account: asAddress(from),
        to: asAddress(to),
        data: asHex(data),
      }),
    getFeeData: async () => {
      const fees = await rawClient.estimateFeesPerGas().catch(() => null)
      if (
        fees?.maxFeePerGas != null ||
        fees?.maxPriorityFeePerGas != null ||
        fees?.gasPrice != null
      ) {
        return fees
      }
      const gasPrice = await rawClient.getGasPrice().catch(() => null)
      return gasPrice != null ? { gasPrice } : null
    },
    waitForTransactionReceipt: async ({ hash, confirmations }) =>
      rawClient.waitForTransactionReceipt({
        hash: asHex(hash),
        confirmations,
      }),
    readErc20Balance: async ({ tokenAddress, owner }) =>
      rawClient.readContract({
        address: asAddress(tokenAddress),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [asAddress(owner)],
      }),
    estimateErc20TransferGas: async ({ tokenAddress, account, to, amount }) =>
      rawClient.estimateContractGas({
        address: asAddress(tokenAddress),
        abi: erc20Abi,
        functionName: 'transfer',
        args: [asAddress(to), amount],
        account: asAddress(account),
      }),
  } as unknown as EvmProviderLike
}

async function createViemWalletClient({
  chain,
  chainConfig,
  rpcUrl,
  privateKey,
}: WalletClientInput): Promise<WalletClientLike> {
  const { createWalletClient, http, privateKeyToAccount } =
    await loadViemModules()
  return createWalletClient({
    account: privateKeyToAccount(normalizePrivateKey(privateKey)),
    chain: await chainForConfig(chain, chainConfig, rpcUrl),
    transport: http(rpcUrl),
  }) as unknown as WalletClientLike
}

async function deriveEvmDepositWallet({
  xpub = '',
  mnemonic = '',
  derivationPath = "m/44'/60'/0'/0",
  index = 0,
}: DeriveWalletInput = {}): Promise<DerivedWalletLike> {
  const numericIndex = Number(index)
  const { HDKey, privateKeyToAccount, publicKeyToAddress, secp256k1, toHex } =
    await loadViemModules()

  if (xpub) {
    const child = HDKey.fromExtendedKey(String(xpub).trim()).deriveChild(
      numericIndex,
    )
    if (!child?.publicKey)
      throw new Error(`failed_to_derive_public_key_${numericIndex}`)
    const compressedPublicKey =
      typeof child.publicKey === 'string'
        ? child.publicKey
        : toHex(child.publicKey)
    const uncompressedPublicKey = `0x${Buffer.from(
      secp256k1.ProjectivePoint.fromHex(
        compressedPublicKey.slice(2),
      ).toRawBytes(false),
    ).toString('hex')}`
    return {
      address: publicKeyToAddress(asHex(uncompressedPublicKey)),
      privateKey: '',
    }
  }

  const hdKey = HDKey.fromMasterSeed(
    mnemonicToSeedBytes(String(mnemonic).trim()),
  )
  const child = hdKey.derive(`${derivationPath}/${numericIndex}`)
  if (!child?.privateKey)
    throw new Error(`failed_to_derive_private_key_${numericIndex}`)
  const privateKey = asHex(`0x${Buffer.from(child.privateKey).toString('hex')}`)
  const account = privateKeyToAccount(privateKey)
  return {
    address: account.address,
    privateKey,
  }
}

async function sponsorAddressForPrivateKey(
  privateKey: string,
): Promise<string> {
  const { privateKeyToAccount } = await loadViemModules()
  return privateKeyToAccount(normalizePrivateKey(privateKey)).address
}

async function encodeErc20TransferData({
  to,
  amount,
}: Erc20TransferInput): Promise<Hex> {
  const { encodeFunctionData, erc20Abi } = await loadViemModules()
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [asAddress(to), amount],
  })
}

export {
  createViemScannerProvider,
  createViemWalletClient,
  deriveEvmDepositWallet,
  sponsorAddressForPrivateKey,
  encodeErc20TransferData,
}

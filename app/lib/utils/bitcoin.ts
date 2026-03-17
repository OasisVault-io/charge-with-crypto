import { BIP32Factory } from 'bip32'
import { address, networks, payments, type Network } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'

const bip32 = BIP32Factory(ecc)

type BitcoinScriptType = 'p2wpkh' | 'p2sh-p2wpkh'

type BitcoinChainConfig = {
	network?: string | null
}

type Bip32Network = Network & {
	bip32: {
		public: number
		private: number
	}
}

type Bip32Version = {
	public: number
	private: number
	scriptType: BitcoinScriptType
}

const BIP32_PUBLIC_VERSIONS: Record<string, Bip32Version> = {
	xpub: { public: 0x0488b21e, private: 0x0488ade4, scriptType: 'p2wpkh' },
	ypub: { public: 0x049d7cb2, private: 0x049d7878, scriptType: 'p2sh-p2wpkh' },
	zpub: { public: 0x04b24746, private: 0x04b2430c, scriptType: 'p2wpkh' },
	tpub: { public: 0x043587cf, private: 0x04358394, scriptType: 'p2wpkh' },
	upub: { public: 0x044a5262, private: 0x044a4e28, scriptType: 'p2sh-p2wpkh' },
	vpub: { public: 0x045f1cf6, private: 0x045f18bc, scriptType: 'p2wpkh' },
}

function bitcoinNetwork(chainConfig: BitcoinChainConfig = {}): Bip32Network {
	return (
		String(chainConfig.network || 'mainnet').toLowerCase() === 'testnet'
			? networks.testnet
			: networks.bitcoin
	) as Bip32Network
}

function bitcoinScriptTypeForXpub(xpub: string): BitcoinScriptType {
	const prefix = String(xpub || '')
		.slice(0, 4)
		.toLowerCase()
	return BIP32_PUBLIC_VERSIONS[prefix]?.scriptType || 'p2wpkh'
}

function bitcoinBip32NetworkForXpub(
	xpub: string,
	chainConfig: BitcoinChainConfig = {},
): Bip32Network {
	const network = bitcoinNetwork(chainConfig)
	const prefix = String(xpub || '')
		.slice(0, 4)
		.toLowerCase()
	const version = BIP32_PUBLIC_VERSIONS[prefix]
	if (!version) return network
	return {
		...network,
		bip32: { public: version.public, private: version.private },
	}
}

function requireBitcoinXpub(
	value: unknown,
	field = 'bitcoinXpub',
	chainConfig: BitcoinChainConfig = {},
): string {
	const xpub = String(value || '').trim()
	if (!xpub) throw new Error(`invalid ${field}`)
	try {
		bip32.fromBase58(xpub, bitcoinBip32NetworkForXpub(xpub, chainConfig))
		return xpub
	} catch {
		throw new Error(`invalid ${field}`)
	}
}

function requireBitcoinAddress(
	value: unknown,
	field = 'bitcoinAddress',
	chainConfig: BitcoinChainConfig = {},
): string {
	const text = String(value || '').trim()
	if (!text) throw new Error(`invalid ${field}`)
	try {
		address.toOutputScript(text, bitcoinNetwork(chainConfig))
		return text
	} catch {
		throw new Error(`invalid ${field}`)
	}
}

function deriveBitcoinAddress({
	xpub,
	index,
	chainConfig = {},
}: {
	xpub: string
	index: number | string
	chainConfig?: BitcoinChainConfig
}): string {
	const network = bitcoinNetwork(chainConfig)
	const node = bip32.fromBase58(
		requireBitcoinXpub(xpub, 'bitcoinXpub', chainConfig),
		bitcoinBip32NetworkForXpub(xpub, chainConfig),
	)
	const child = node.derive(0).derive(Number(index))
	const pubkey = Buffer.from(child.publicKey)
	const scriptType = bitcoinScriptTypeForXpub(xpub)
	if (scriptType === 'p2sh-p2wpkh') {
		const derivedAddress = payments.p2sh({
			redeem: payments.p2wpkh({ pubkey, network }),
			network,
		}).address
		if (!derivedAddress)
			throw new Error('failed to derive bitcoin settlement address')
		return derivedAddress
	}
	const derivedAddress = payments.p2wpkh({ pubkey, network }).address
	if (!derivedAddress)
		throw new Error('failed to derive bitcoin settlement address')
	return derivedAddress
}

function formatBitcoinUri({
	address: recipientAddress,
	amountBtc,
}: {
	address: string
	amountBtc?: string | number | null
}): string {
	const amount = String(amountBtc || '').trim()
	if (!amount) return `bitcoin:${recipientAddress}`
	return `bitcoin:${recipientAddress}?amount=${amount}`
}

export {
	bitcoinNetwork,
	bitcoinScriptTypeForXpub,
	requireBitcoinAddress,
	requireBitcoinXpub,
	deriveBitcoinAddress,
	formatBitcoinUri,
}

export type { BitcoinChainConfig, BitcoinScriptType }

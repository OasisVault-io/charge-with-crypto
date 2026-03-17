// @ts-nocheck
const { BIP32Factory } = require('bip32')
const { address, networks, payments } = require('bitcoinjs-lib')
const ecc = require('tiny-secp256k1')

const bip32 = BIP32Factory(ecc)

const BIP32_PUBLIC_VERSIONS = {
	xpub: { public: 0x0488b21e, private: 0x0488ade4, scriptType: 'p2wpkh' },
	ypub: { public: 0x049d7cb2, private: 0x049d7878, scriptType: 'p2sh-p2wpkh' },
	zpub: { public: 0x04b24746, private: 0x04b2430c, scriptType: 'p2wpkh' },
	tpub: { public: 0x043587cf, private: 0x04358394, scriptType: 'p2wpkh' },
	upub: { public: 0x044a5262, private: 0x044a4e28, scriptType: 'p2sh-p2wpkh' },
	vpub: { public: 0x045f1cf6, private: 0x045f18bc, scriptType: 'p2wpkh' },
}

function bitcoinNetwork(chainConfig = {}) {
	return String(chainConfig.network || 'mainnet').toLowerCase() === 'testnet'
		? networks.testnet
		: networks.bitcoin
}

function bitcoinScriptTypeForXpub(xpub) {
	const prefix = String(xpub || '')
		.slice(0, 4)
		.toLowerCase()
	return BIP32_PUBLIC_VERSIONS[prefix]?.scriptType || 'p2wpkh'
}

function bitcoinBip32NetworkForXpub(xpub, chainConfig = {}) {
	const network = { ...bitcoinNetwork(chainConfig) }
	const prefix = String(xpub || '')
		.slice(0, 4)
		.toLowerCase()
	const version = BIP32_PUBLIC_VERSIONS[prefix]
	if (version)
		network.bip32 = { public: version.public, private: version.private }
	return network
}

function requireBitcoinXpub(value, field = 'bitcoinXpub', chainConfig = {}) {
	const xpub = String(value || '').trim()
	if (!xpub) throw new Error(`invalid ${field}`)
	try {
		bip32.fromBase58(xpub, bitcoinBip32NetworkForXpub(xpub, chainConfig))
		return xpub
	} catch (_err) {
		throw new Error(`invalid ${field}`)
	}
}

function requireBitcoinAddress(
	value,
	field = 'bitcoinAddress',
	chainConfig = {},
) {
	const text = String(value || '').trim()
	if (!text) throw new Error(`invalid ${field}`)
	try {
		address.toOutputScript(text, bitcoinNetwork(chainConfig))
		return text
	} catch (_err) {
		throw new Error(`invalid ${field}`)
	}
}

function deriveBitcoinAddress({ xpub, index, chainConfig = {} }) {
	const network = bitcoinNetwork(chainConfig)
	const node = bip32.fromBase58(
		requireBitcoinXpub(xpub, 'bitcoinXpub', chainConfig),
		bitcoinBip32NetworkForXpub(xpub, chainConfig),
	)
	const child = node.derive(0).derive(Number(index))
	const pubkey = Buffer.from(child.publicKey)
	const scriptType = bitcoinScriptTypeForXpub(xpub)
	if (scriptType === 'p2sh-p2wpkh') {
		return payments.p2sh({
			redeem: payments.p2wpkh({ pubkey, network }),
			network,
		}).address
	}
	return payments.p2wpkh({ pubkey, network }).address
}

function formatBitcoinUri({ address: recipientAddress, amountBtc }) {
	const amount = String(amountBtc || '').trim()
	if (!amount) return `bitcoin:${recipientAddress}`
	return `bitcoin:${recipientAddress}?amount=${amount}`
}

module.exports = {
	bitcoinNetwork,
	bitcoinScriptTypeForXpub,
	requireBitcoinAddress,
	requireBitcoinXpub,
	deriveBitcoinAddress,
	formatBitcoinUri,
}

export {
	bitcoinNetwork,
	bitcoinScriptTypeForXpub,
	requireBitcoinAddress,
	requireBitcoinXpub,
	deriveBitcoinAddress,
	formatBitcoinUri,
}

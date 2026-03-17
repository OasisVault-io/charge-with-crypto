const FIXED_PEG_ASSETS = new Set(['USDC', 'USDT'])

function isFixedPegAsset(asset: string): boolean {
  return FIXED_PEG_ASSETS.has(asset)
}

export { isFixedPegAsset }

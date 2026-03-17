declare module '@scure/bip39' {
  export function mnemonicToSeedSync(
    mnemonic: string,
    passphrase?: string,
  ): Uint8Array
}

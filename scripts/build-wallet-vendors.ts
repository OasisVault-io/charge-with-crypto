// @ts-nocheck
const { build } = require('esbuild');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const targets = [
  {
    entry: path.join(root, 'scripts', 'browser-vendors', 'xverse-wallet.ts'),
    outfile: path.join(root, 'public', 'vendor', 'xverse-wallet.js')
  }
];

async function main() {
  await Promise.all(targets.map(({ entry, outfile }) => build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    legalComments: 'none'
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

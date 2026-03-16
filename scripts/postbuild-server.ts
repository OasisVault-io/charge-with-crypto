import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const serverRoot = path.join(projectRoot, 'dist', 'server', 'src');

const runtimeEntryFiles = [
  'config',
  'appContext',
  path.join('routes', 'api'),
  path.join('services', 'quoteService'),
  path.join('services', 'paymentService'),
  path.join('utils', 'validation'),
  path.join('utils', 'bitcoin'),
  path.join('services', 'priceService'),
  path.join('services', 'merchantWebhookService'),
  path.join('services', 'productService')
];

for (const entry of runtimeEntryFiles) {
  const sourcePath = path.join(serverRoot, `${entry}.js`);
  const targetPath = path.join(serverRoot, `${entry}.cjs`);
  if (!fs.existsSync(sourcePath)) continue;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

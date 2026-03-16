import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

type ResolveFilename = (
  request: string,
  parent?: NodeJS.Module | null,
  isMain?: boolean,
  options?: unknown
) => string;

const moduleWithResolve = Module as typeof Module & {
  _resolveFilename: ResolveFilename;
};

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'src');
const compiledRoot = path.join(projectRoot, 'dist', 'server', 'src');
const runtimeSource = process.env.CWC_RUNTIME_SOURCE;
const compiledRuntimeExists = fs.existsSync(path.join(compiledRoot, 'config.js'));
// In RR7 dev, load the source modules directly so Vite can evaluate them
// consistently. Prefer the compiled tree only for production or when forced.
const useCompiledRuntime = runtimeSource === 'src'
  ? false
  : runtimeSource === 'dist'
    ? compiledRuntimeExists
    : process.env.NODE_ENV === 'production' && compiledRuntimeExists;
const runtimeRoot = useCompiledRuntime ? compiledRoot : sourceRoot;

if (!useCompiledRuntime && !(globalThis as { __cwcTsResolvePatched?: boolean }).__cwcTsResolvePatched) {
  const originalResolveFilename = moduleWithResolve._resolveFilename;
  moduleWithResolve._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      if (typeof request === 'string' && request.startsWith('.')) {
        for (const extension of ['.ts', '.js']) {
          try {
            return originalResolveFilename.call(this, `${request}${extension}`, parent, isMain, options);
          } catch {
            continue;
          }
        }
      }
      throw error;
    }
  };
  globalThis.__cwcTsResolvePatched = true;
}

function runtimePath(...segments: string[]) {
  return path.join(runtimeRoot, ...segments);
}

async function loadRuntimeModule(sourceFile: string, compiledFile: string) {
  const filePath = runtimePath(useCompiledRuntime ? compiledFile : sourceFile);
  if (useCompiledRuntime) return require(filePath);
  return import(/* @vite-ignore */ pathToFileURL(filePath).href);
}

function unwrapModule<T>(moduleNamespace: Record<string, any>, exportName: string): T {
  return moduleNamespace?.[exportName] ?? moduleNamespace?.default?.[exportName];
}

const configModule = await loadRuntimeModule('config.ts', 'config.cjs');
const appContextModule = await loadRuntimeModule('appContext.ts', 'appContext.cjs');
const legacyApi = await loadRuntimeModule('routes/api.ts', 'routes/api.cjs');
const quoteService = await loadRuntimeModule('services/quoteService.ts', 'services/quoteService.cjs');
const paymentService = await loadRuntimeModule('services/paymentService.ts', 'services/paymentService.cjs');
const validation = await loadRuntimeModule('utils/validation.ts', 'utils/validation.cjs');
const bitcoin = await loadRuntimeModule('utils/bitcoin.ts', 'utils/bitcoin.cjs');
const priceService = await loadRuntimeModule('services/priceService.ts', 'services/priceService.cjs');
const merchantWebhookService = await loadRuntimeModule('services/merchantWebhookService.ts', 'services/merchantWebhookService.cjs');
const productService = await loadRuntimeModule('services/productService.ts', 'services/productService.cjs');

const config = unwrapModule<any>(configModule, 'config');
const createAppContext = unwrapModule<any>(appContextModule, 'createAppContext');
const startAppContext = unwrapModule<any>(appContextModule, 'startAppContext');

let appContext: any = null;

export function getAppContext() {
  if (!appContext) {
    appContext = createAppContext(config);
    startAppContext(appContext);
  }
  return appContext;
}

export function getConfig() {
  return config;
}

export {
  legacyApi,
  quoteService,
  paymentService,
  validation,
  bitcoin,
  priceService,
  merchantWebhookService,
  productService
};

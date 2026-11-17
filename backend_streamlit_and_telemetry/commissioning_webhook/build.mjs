import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const output = new URL('runtime/commissioning_function/index.mjs', root);
await mkdir(new URL('.', output), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('index.mjs', import.meta.url))],
  outfile: fileURLToPath(output), bundle: true, platform: 'node', target: 'node24', format: 'esm',
  external: ['pg-native'],
  banner: { js: "import{createRequire as ___cr}from'node:module';import{fileURLToPath as ___f}from'node:url';import{dirname as ___d}from'node:path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);" },
});
console.log('Built runtime/commissioning_function/index.mjs');

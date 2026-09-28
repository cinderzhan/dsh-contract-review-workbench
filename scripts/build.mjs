import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/client.js'], outfile: 'lib/client.js', bundle: true,
  format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'inline',
  plugins: [{ name: 'inline-pdf-worker', setup(builder) {
    builder.onResolve({ filter: /^pdf-worker-text$/ }, () => ({ path: 'pdf-worker-text', namespace: 'worker' }))
    builder.onLoad({ filter: /.*/, namespace: 'worker' }, async () => ({ contents: await readFile(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8'), loader: 'text' }))
  }}],
})
execFileSync(process.execPath, ['--check', 'lib/client.js'], { stdio: 'inherit' })

// RF-18: garante que o simulador de share (app/dev, src/dev) NÃO entra no bundle de produção.
// Faz `expo export` com APP_VARIANT=production e procura uma frase que só existe na tela do simulador.
// Uso: node scripts/check-prod-bundle.mjs [--platform android|web] [--control]
//   --control também exporta em development e exige que a frase apareça (prova que a checagem funciona).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'emula o share sheet';
const args = process.argv.slice(2);
const platform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : 'android';

if (!readFileSync(join(appDir, 'src', 'dev', 'ShareSimulatorScreen.tsx'), 'utf8').includes(MARKER)) {
  console.error(`marcador "${MARKER}" não está mais na tela do simulador; atualize este script`);
  process.exit(2);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|hbc)$/.test(name)) yield p;
  }
}

function exportContains(variant) {
  const out = mkdtempSync(join(tmpdir(), `fruiqo-${variant}-`));
  try {
    execFileSync('npx', ['expo', 'export', '--platform', platform, '--output-dir', out], {
      cwd: appDir,
      env: { ...process.env, APP_VARIANT: variant, CI: '1' },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    // o Hermes guarda em UTF-16 as strings que têm algum caractere não-ASCII: procura nos dois formatos
    const needles = [Buffer.from(MARKER, 'utf8'), Buffer.from(MARKER, 'utf16le')];
    return [...files(out)].some((f) => {
      const bytes = readFileSync(f);
      return needles.some((n) => bytes.includes(n));
    });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (exportContains('production')) {
  console.error(`FALHA: o simulador de share está no bundle de produção (${platform})`);
  process.exit(1);
}
console.log(`ok: simulador ausente do bundle de produção (${platform})`);

if (args.includes('--control')) {
  if (!exportContains('development')) {
    console.error('FALHA no controle: o marcador não apareceu no bundle de development; a checagem não prova nada');
    process.exit(1);
  }
  console.log('ok: controle — simulador presente no bundle de development');
}

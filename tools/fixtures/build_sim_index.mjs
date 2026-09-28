// Gera o índice de fixtures do simulador de share do app (RF-18): apps/mobile/src/dev/fixtureIndex.generated.ts.
// O app não lê o disco em runtime; este arquivo é versionado e regenerado quando as fixtures mudam.
// Uso: node tools/fixtures/build_sim_index.mjs [--check]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesDir = join(root, 'fixtures');
const outFile = join(root, 'apps', 'mobile', 'src', 'dev', 'fixtureIndex.generated.ts');
// Só o que o share sheet pode entregar; mood-set e sequence são exercitados pelo eval da API.
const KINDS = new Set(['text', 'url', 'screenshot']);

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const entries = [];
for (const id of readdirSync(fixturesDir).sort()) {
  const dir = join(fixturesDir, id);
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(read(metaPath));
  if (!KINDS.has(meta.kind) || meta.synthetic !== true) continue;
  const entry = { id, kind: meta.kind, description: meta.description };
  if (meta.kind === 'text') {
    entry.text = read(join(dir, 'input.txt')).trim();
  } else {
    const input = JSON.parse(read(join(dir, 'input.json')));
    if (meta.kind === 'url') entry.url = input.url ?? input.text;
    else entry.pages = input.pages.map((p) => read(join(dir, `${p}.ocr.txt`)).trim());
  }
  entries.push(entry);
}

const content =
  '// GERADO por tools/fixtures/build_sim_index.mjs — não editar à mão.\n' +
  '// Fixtures sintéticas (fixtures/*, synthetic: true) usadas pelo simulador de share (/dev/share).\n' +
  'export type SimFixture = {\n' +
  "  id: string;\n  kind: 'text' | 'url' | 'screenshot';\n  description: string;\n" +
  '  text?: string;\n  url?: string;\n  /** texto de OCR de cada print, na ordem */\n  pages?: string[];\n};\n\n' +
  `export const SIM_FIXTURES: SimFixture[] = ${JSON.stringify(entries, null, 2)};\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(outFile) ? read(outFile) : '';
  if (current !== content) {
    console.error('fixtureIndex.generated.ts desatualizado: rode node tools/fixtures/build_sim_index.mjs');
    process.exit(1);
  }
  console.log(`índice do simulador ok (${entries.length} fixtures)`);
} else {
  writeFileSync(outFile, content);
  console.log(`gerado ${outFile} (${entries.length} fixtures)`);
}

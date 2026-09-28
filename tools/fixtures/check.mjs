// Checagem de CI das fixtures (RF-21). Falha se:
// - alguma fixture em fixtures/ não tiver meta.json com `synthetic: true`, `origin` e `license`;
// - houver arquivo de tipo inesperado (o repositório é público: nada de print real, PDF, vídeo);
// - um page-N.png não tiver o page-N.ocr.txt correspondente;
// - uma gravação em recordings/ não estiver marcada como sintética;
// - fixtures-private/ não estiver no .gitignore.
// Sem dependências: `node tools/fixtures/check.mjs`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(root, 'fixtures');
const ALLOWED = /\.(json|txt|png|md)$/;
const KINDS = new Set(['screenshot', 'text', 'url', 'sequence', 'mood-set']);
const errors = [];

function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const full = join(d, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const gitignore = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
if (!gitignore.some((l) => l === 'fixtures-private/' || l === 'fixtures-private' || l === '/fixtures-private/')) {
  errors.push('.gitignore não contém fixtures-private/');
}

let count = 0;
for (const name of readdirSync(dir)) {
  const fdir = join(dir, name);
  if (!statSync(fdir).isDirectory()) continue;
  count++;
  const metaPath = join(fdir, 'meta.json');
  if (!existsSync(metaPath)) {
    errors.push(`${name}: sem meta.json`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (meta.synthetic !== true) errors.push(`${name}: meta.synthetic precisa ser true (fixture real vai em fixtures-private/)`);
  if (!meta.origin || !meta.license) errors.push(`${name}: meta.json sem origin/license`);
  if (!KINDS.has(meta.kind)) errors.push(`${name}: kind inválido (${meta.kind})`);
  if (meta.id !== name) errors.push(`${name}: meta.id diferente do nome da pasta`);
  if (!existsSync(join(fdir, 'expected.json'))) errors.push(`${name}: sem expected.json`);

  for (const file of walk(fdir)) {
    const rel = relative(dir, file).replaceAll('\\', '/');
    if (!ALLOWED.test(file)) errors.push(`${rel}: tipo de arquivo não permitido em fixtures/`);
    const png = /page-(\d+)\.png$/.exec(file);
    if (png && !existsSync(file.replace(/\.png$/, '.ocr.txt'))) errors.push(`${rel}: sem o .ocr.txt correspondente`);
    if (/[\\/]recordings[\\/].+\.json$/.test(file)) {
      const rec = JSON.parse(readFileSync(file, 'utf8'));
      if (rec.synthetic !== true) errors.push(`${rel}: gravação não sintética (gravações reais só em fixtures-private/)`);
    }
  }
}

if (count < 12) errors.push(`mínimo de 12 fixtures sintéticas (há ${count})`);

if (errors.length > 0) {
  console.error(`fixtures: ${errors.length} problema(s)\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`fixtures: ${count} fixtures sintéticas ok`);

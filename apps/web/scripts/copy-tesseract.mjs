// Copia o motor do Tesseract.js, o worker e os idiomas (português + inglês) para public/tesseract,
// servidos pelo próprio site: o OCR dos prints roda no navegador, sem CDN nem serviço de terceiro,
// e a imagem nunca sai do computador do usuário (TOS-REQ-21). public/tesseract é gerado (gitignored).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'tesseract');

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

copy(join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js'));

// só as variantes LSTM (OEM.LSTM_ONLY); o navegador baixa uma só, conforme o suporte a SIMD
const core = pkgDir('tesseract.js-core');
for (const f of readdirSync(core)) {
  if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm(\.js)?$/.test(f)) copy(join(core, f), join(out, 'core', f));
}

for (const lang of ['por', 'eng']) {
  const src = join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`idioma ${lang} não encontrado em ${src}`);
  copy(src, join(out, 'lang', `${lang}.traineddata.gz`));
}

console.log(`tesseract copiado para ${out}`);

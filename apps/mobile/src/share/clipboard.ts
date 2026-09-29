// Colar da área de transferência (como o Ctrl+V do web): print copiado vai pelo mesmo OCR no
// aparelho; texto copiado (lista de uma legenda, nota) vira um .txt. Nada vai para a rede aqui.
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';

export type ClipboardContent = { kind: 'image'; uri: string } | { kind: 'text'; text: string } | { kind: 'empty' };

/** Tira o prefixo `data:image/png;base64,` que o expo-clipboard devolve. */
export function stripDataUri(data: string): { base64: string; ext: 'png' | 'jpg' } {
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(data);
  return { base64: m ? data.slice(m[0].length) : data, ext: m && /jpe?g/i.test(m[1]!) ? 'jpg' : 'png' };
}

/** Imagem primeiro (print copiado), depois texto. A imagem vira um arquivo no cache do app. */
export async function readClipboard(now: () => number = Date.now): Promise<ClipboardContent> {
  if (await Clipboard.hasImageAsync()) {
    const img = await Clipboard.getImageAsync({ format: 'png' });
    if (img?.data) {
      const { base64, ext } = stripDataUri(img.data);
      const file = new File(Paths.cache, `print-colado-${now()}.${ext}`);
      file.create({ overwrite: true });
      file.write(base64, { encoding: 'base64' });
      return { kind: 'image', uri: file.uri };
    }
  }
  if (await Clipboard.hasStringAsync()) {
    const text = await Clipboard.getStringAsync();
    if (text.trim()) return { kind: 'text', text };
  }
  return { kind: 'empty' };
}

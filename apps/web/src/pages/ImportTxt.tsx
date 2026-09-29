// RF-47 + prints no web: importar títulos de um arquivo de texto ou de prints (ex.: perfil do
// Instagram). Tudo é lido no navegador: do .txt vai o conteúdo (`textFile`); dos prints, só o texto
// lido pelo OCR local (`pages`), nunca a imagem. A API extrai os títulos e manda tudo para a Revisão.
import { MAX_TEXT_FILE_CHARS, type Share } from '@fruiqo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon } from '../components/ui';
import { isImageFile, MAX_SCREENSHOT_PAGES, type OcrProgress, readScreenshots } from '../ocr/screenshots';

const PREVIEW_LINES = 12;
const POLL_MS = 1000;
const POLL_MAX = 45;

/** UTF-8; se o arquivo não for UTF-8 válido, cai para Windows-1252 (Latin-1 do Bloco de Notas antigo). */
export async function readTextFile(file: Blob): Promise<string> {
  const buf = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await readWithFileReader(file);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function readWithFileReader(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

export function isTextFile(file: File): boolean {
  return file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
}

/** .txt ou print (PNG/JPG/WebP) */
export function isImportFile(file: File): boolean {
  return isTextFile(file) || isImageFile(file);
}

async function waitShare(id: string): Promise<Share> {
  for (let i = 0; i < POLL_MAX; i++) {
    const s = await api.share(id);
    if (s.status === 'done' || s.status === 'failed' || s.status === 'rejected') return s;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return api.share(id);
}

type Loaded = { type: 'txt'; name: string; content: string } | { type: 'prints'; names: string[]; pages: string[] };

export function ImportTxt({ initialFiles, onClose }: { initialFiles?: File[] | null; onClose: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'reading' | 'sending' | 'processing' | null>(null);
  const [ocr, setOcr] = useState<OcrProgress | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  async function load(list: File[] | FileList | undefined | null) {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setError(null);
    const images = files.filter(isImageFile);
    if (images.length > 0) {
      await loadPrints(images);
      return;
    }
    const f = files[0]!;
    if (!isTextFile(f)) {
      setError(new Error('Escolha prints (PNG/JPG) ou um arquivo .txt (um título por linha).'));
      return;
    }
    setBusy('reading');
    try {
      const content = await readTextFile(f);
      if (!content.trim()) throw new Error('O arquivo está vazio.');
      if (content.length > MAX_TEXT_FILE_CHARS) {
        throw new Error(`Arquivo grande demais (${content.length.toLocaleString('pt-BR')} caracteres; máximo ${MAX_TEXT_FILE_CHARS.toLocaleString('pt-BR')}). Divida em partes.`);
      }
      setFile({ type: 'txt', name: f.name, content });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function loadPrints(images: File[]) {
    if (images.length > MAX_SCREENSHOT_PAGES) {
      setError(new Error(`Até ${MAX_SCREENSHOT_PAGES} prints por vez; escolha menos e importe o resto depois.`));
      return;
    }
    setBusy('reading');
    setFile(null);
    try {
      const pages = await readScreenshots(images, setOcr);
      if (pages.every((p) => !p.trim())) {
        throw new Error('Não encontrei texto nesses prints. Tente prints mais nítidos, sem cortar os títulos.');
      }
      setFile({ type: 'prints', names: images.map((i) => i.name), pages });
    } catch (err) {
      const loadFailed = err instanceof Error && /fetch|network|wasm|worker/i.test(err.message);
      setError(loadFailed ? new Error('Não foi possível carregar o leitor de prints. Recarregue a página e tente de novo.') : err);
    } finally {
      setOcr(null);
      setBusy(null);
    }
  }

  // arquivo solto direto no catálogo (arrastar e soltar) já abre carregado
  useEffect(() => {
    if (initialFiles?.length && !started.current) {
      started.current = true;
      void load(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  async function send() {
    if (!file) return;
    setBusy('sending');
    setError(null);
    try {
      const share = await api.createShare(
        file.type === 'txt'
          ? { clientShareId: crypto.randomUUID(), textFile: { name: file.name, content: file.content } }
          : { clientShareId: crypto.randomUUID(), pages: file.pages.filter((p) => p.trim()) },
      );
      setBusy('processing');
      const done = await waitShare(share.id);
      await qc.invalidateQueries();
      if (done.status !== 'done') {
        throw new Error(done.error ?? (file.type === 'txt' ? 'Não foi possível ler o arquivo.' : 'Não foi possível ler os prints.'));
      }
      const n = done.recommendations.length;
      const dup = done.dedup.itemsAlreadyInList;
      toast.show(
        n === 0 && dup === 0
          ? `Nenhum título encontrado ${file.type === 'txt' ? 'no arquivo' : 'nos prints'}.`
          : `${n} título(s) para revisar${dup ? ` · ${dup} já estava(m) na sua lista` : ''}.`,
      );
      onClose();
      if (n > 0) navigate('/revisao');
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const lines = file ? (file.type === 'txt' ? file.content : file.pages.join('\n')).split('\n').filter((l) => l.trim()) : [];

  return (
    <Modal title="Importar prints ou .txt" onClose={onClose}>
      <div className="form">
        <p className="muted small">
          <strong>Prints</strong> (PNG/JPG, até {MAX_SCREENSHOT_PAGES}): por exemplo, de um perfil do Instagram com uma lista de
          filmes. O texto é lido aqui no seu navegador; a imagem não é enviada.
        </p>
        <p className="muted small">
          <strong>.txt</strong>: um título por linha, com ou sem ano (ex.: <code>Maid (2021)</code>). Cabeçalhos como{' '}
          <code>Series:</code>, <code>Filmes:</code>, <code>Livros:</code> ou <code>Músicas:</code> definem o tipo das linhas abaixo.
          Tudo vai para a Revisão antes de entrar na fila.
        </p>
        <div
          className={drag ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void load(e.dataTransfer.files);
          }}
        >
          <Icon name="plus" size={22} />
          <span>Arraste os prints ou o .txt aqui ou</span>
          <button type="button" className="btn" data-autofocus disabled={busy === 'reading'} onClick={() => inputRef.current?.click()}>
            Escolher arquivos
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,text/plain,image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Prints ou arquivo de texto"
            onChange={(e) => {
              void load(e.target.files ? [...e.target.files] : null);
              e.target.value = '';
            }}
          />
        </div>

        {ocr && (
          <p className="muted small" role="status">
            {ocr.stage === 'loading'
              ? `Preparando o leitor de prints (só na primeira vez)… ${Math.round(ocr.progress * 100)}%`
              : `Lendo print ${ocr.index + 1} de ${ocr.total}…`}
          </p>
        )}
        {file && (
          <div className="txt-preview" aria-label={file.type === 'txt' ? 'Prévia do arquivo' : 'Texto lido dos prints'}>
            <strong>{file.type === 'txt' ? file.name : `${file.names.length} print(s)`}</strong>{' '}
            <span className="muted small">
              · {lines.length} linha(s){file.type === 'prints' ? ' lida(s)' : ''}
            </span>
            <ol>
              {lines.slice(0, PREVIEW_LINES).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
            {lines.length > PREVIEW_LINES && <p className="muted small">… e mais {lines.length - PREVIEW_LINES}.</p>}
          </div>
        )}
        <ErrorNote error={error} />
        {busy === 'processing' && (
          <p className="muted small" role="status">
            Lendo os títulos e buscando no catálogo…
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!file || busy !== null} onClick={() => void send()}>
            {busy === 'sending' || busy === 'processing' ? 'Importando…' : 'Importar para a Revisão'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

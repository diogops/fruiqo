// RF-47: importar títulos de um arquivo de texto. O arquivo é lido no navegador; só o conteúdo vai
// para a API (`textFile`), que extrai os títulos e manda tudo para a Revisão (RF-42).
import { MAX_TEXT_FILE_CHARS, type Share } from '@fruiqo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon } from '../components/ui';

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

async function waitShare(id: string): Promise<Share> {
  for (let i = 0; i < POLL_MAX; i++) {
    const s = await api.share(id);
    if (s.status === 'done' || s.status === 'failed' || s.status === 'rejected') return s;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return api.share(id);
}

export function ImportTxt({ initialFile, onClose }: { initialFile?: File | null; onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'reading' | 'sending' | 'processing' | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  async function load(f: File | undefined | null) {
    if (!f) return;
    setError(null);
    if (!isTextFile(f)) {
      setError(new Error('Escolha um arquivo .txt (um título por linha).'));
      return;
    }
    setBusy('reading');
    try {
      const content = await readTextFile(f);
      if (!content.trim()) throw new Error('O arquivo está vazio.');
      if (content.length > MAX_TEXT_FILE_CHARS) {
        throw new Error(`Arquivo grande demais (${content.length.toLocaleString('pt-BR')} caracteres; máximo ${MAX_TEXT_FILE_CHARS.toLocaleString('pt-BR')}). Divida em partes.`);
      }
      setFile({ name: f.name, content });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  // arquivo solto direto no catálogo (arrastar e soltar) já abre carregado
  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void load(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  async function send() {
    if (!file) return;
    setBusy('sending');
    setError(null);
    try {
      const share = await api.createShare({ clientShareId: crypto.randomUUID(), textFile: file });
      setBusy('processing');
      const done = await waitShare(share.id);
      await qc.invalidateQueries();
      if (done.status !== 'done') {
        throw new Error(done.error ?? 'Não foi possível ler o arquivo.');
      }
      const n = done.recommendations.length;
      const dup = done.dedup.itemsAlreadyInList;
      toast.show(
        n === 0 && dup === 0
          ? 'Nenhum título encontrado no arquivo.'
          : `${n} título(s) para revisar${dup ? ` · ${dup} já estava(m) na sua lista` : ''}.`,
      );
      onClose();
      if (n > 0) navigate('/revisao');
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const lines = file ? file.content.split('\n').filter((l) => l.trim()) : [];

  return (
    <Modal title="Importar arquivo (.txt)" onClose={onClose}>
      <div className="form">
        <p className="muted small">
          Um título por linha, com ou sem ano (ex.: <code>Maid (2021)</code>). Cabeçalhos como <code>Series:</code>,{' '}
          <code>Filmes:</code>, <code>Livros:</code> ou <code>Músicas:</code> definem o tipo das linhas abaixo. Tudo vai para a
          Revisão antes de entrar na fila.
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
            void load(e.dataTransfer.files[0]);
          }}
        >
          <Icon name="plus" size={22} />
          <span>Arraste o arquivo aqui ou</span>
          <button type="button" className="btn" data-autofocus onClick={() => inputRef.current?.click()}>
            Escolher arquivo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            aria-label="Arquivo de texto"
            onChange={(e) => void load(e.target.files?.[0])}
          />
        </div>

        {file && (
          <div className="txt-preview" aria-label="Prévia do arquivo">
            <strong>{file.name}</strong> <span className="muted small">· {lines.length} linha(s)</span>
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

// Importar de imagem: print (escolher, arrastar ou Ctrl+V) → recorte → OCR no navegador → candidatos
// editáveis com categoria → cadastro só do que o usuário confirmar. A imagem nunca sai do navegador:
// o que vai para a API é o texto confirmado, pelo fluxo de importação que já existe (RF-47 → Revisão).
import 'react-image-crop/dist/ReactCrop.css';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import ReactCrop, { type Crop, type PixelCrop as ViewCrop } from 'react-image-crop';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon } from '../components/ui';
import { type Candidate, type CandidateKind, extractCandidates, newCandidateId, normalizeSpaces } from '../ocr/candidates';
import { OcrCanceledError, OcrEngine, type OcrProgress } from '../ocr/engine';
import { disposeCanvas, IMAGE_TYPES, isImageFile, loadImage, type LoadedImage, type PixelCrop, releaseImage, renderForOcr } from '../ocr/image';
import { buildImportRequest, type ConfirmedItem, type ItemResult, matchOutcomes } from '../ocr/submit';
import { waitShare } from './ImportTxt';

const KIND_LABEL: Record<CandidateKind, string> = { movie: 'Filme', series: 'Série', book: 'Livro' };
const OUTCOME_LABEL: Record<ItemResult['outcome'], string> = {
  review: 'Na Revisão',
  duplicate: 'Já estava na sua lista',
  failed: 'Não foi cadastrado',
};

type Step = 'pick' | 'crop' | 'ocr' | 'review' | 'done';

/** Primeira imagem de uma lista de arquivos (colar/soltar pode trazer vários). */
export function firstImage(files: Iterable<File> | null | undefined): File | null {
  for (const f of files ?? []) if (isImageFile(f)) return f;
  return null;
}

export function ImportImage({ initialFile, onClose }: { initialFile?: File | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick');
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [fullText, setFullText] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [drag, setDrag] = useState(false);
  const engine = useRef<OcrEngine | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fullTextRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  // mesmo pedido reenviado (clique repetido, falha de rede) reaproveita o clientShareId: idempotente
  const pending = useRef<{ key: string; id: string } | null>(null);
  const started = useRef(false);
  const qc = useQueryClient();
  const toast = useToast();
  const statusId = useId();

  // worker e imagem liberados ao fechar
  useEffect(
    () => () => {
      engine.current?.dispose();
      releaseImage(imageRef.current);
    },
    [],
  );

  const pick = useCallback(async (file: File | null) => {
    if (!file) {
      setError(new Error('Escolha uma imagem PNG, JPG ou WebP.'));
      return;
    }
    setError(null);
    engine.current?.cancel();
    try {
      const loaded = await loadImage(file);
      releaseImage(imageRef.current);
      imageRef.current = loaded;
      setImage(loaded);
      setCrop(undefined);
      setPixelCrop(null);
      setCandidates([]);
      setFullText('');
      setResults(null);
      setStep('crop');
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void pick(initialFile);
    }
  }, [initialFile, pick]);

  // Ctrl+V em qualquer ponto do modal (ou da página, com o modal aberto)
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (step === 'ocr' || sending) return;
      const file = firstImage(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      void pick(file);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pick, sending, step]);

  async function extract() {
    const img = imageRef.current;
    if (!img) return;
    engine.current ??= new OcrEngine();
    setError(null);
    setProgress({ phase: 'loading', progress: 0 });
    setStep('ocr');
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = renderForOcr(img, pixelCrop);
      const result = await engine.current.recognize(canvas, setProgress);
      const found = extractCandidates(result.lines);
      setFullText(result.text.trim());
      setCandidates(found);
      if (found.length === 0) {
        setError(new Error(result.text.trim() ? 'Li o texto, mas nenhuma linha parece um título. Veja o texto completo ou adicione à mão.' : 'Não encontrei texto nessa área. Ajuste o recorte ou use outra imagem.'));
      }
      setStep('review');
    } catch (err) {
      if (err instanceof OcrCanceledError) {
        setStep('crop');
        return;
      }
      setError(err);
      setStep('crop');
    } finally {
      disposeCanvas(canvas);
      setProgress(null);
    }
  }

  function cancelOcr() {
    engine.current?.cancel();
  }

  function update(id: string, patch: Partial<Candidate>) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addManual(text = '') {
    const c: Candidate = { id: newCandidateId(), text: normalizeSpaces(text), selected: true, visible: true, kind: null, uncertain: false, source: 'manual' };
    setCandidates((cs) => [...cs, c]);
    // foca o campo novo
    requestAnimationFrame(() => document.getElementById(`cand-${c.id}`)?.focus());
  }

  function addSelection() {
    const el = fullTextRef.current;
    const text = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
    const lines = text.split('\n').map(normalizeSpaces).filter(Boolean);
    if (lines.length === 0) {
      toast.show('Selecione um trecho do texto para adicionar.', { tone: 'error' });
      return;
    }
    for (const l of lines) addManual(l);
  }

  const chosen = candidates.filter((c) => c.selected);
  const invalid = chosen.filter((c) => !normalizeSpaces(c.text) || !c.kind);
  // lista principal: o que veio marcado e o que o usuário trouxe; o resto fica recolhido
  const shown = candidates.filter((c) => c.visible);
  const others = candidates.filter((c) => !c.visible);

  /** Mesma categoria para todos os marcados (o comum num post: tudo filme ou tudo série). */
  function setKindForAll(kind: CandidateKind | null) {
    if (!kind) return;
    setCandidates((cs) => cs.map((c) => (c.selected ? { ...c, kind } : c)));
  }

  async function submit(items: ConfirmedItem[]) {
    if (sending || items.length === 0) return;
    setSending(true);
    setError(null);
    const key = JSON.stringify(items.map((i) => [i.kind, normalizeSpaces(i.text)]));
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      const created = await api.createShare(buildImportRequest(items, pending.current.id));
      const done = await waitShare(created.id);
      if (done.status !== 'done') throw new Error(done.error ?? 'Não foi possível cadastrar agora. Tente de novo.');
      const steps = await api.shareSteps(done.id);
      const outcome = matchOutcomes(items, steps.decisions);
      pending.current = null;
      setResults(outcome);
      setStep('done');
      await qc.invalidateQueries();
    } catch (err) {
      // nada foi confirmado: os itens continuam na tela e o mesmo envio pode ser repetido
      setError(err);
    } finally {
      setSending(false);
    }
  }

  function confirm() {
    if (invalid.length > 0) {
      setShowErrors(true);
      document.getElementById(`cand-${invalid[0]!.id}`)?.focus();
      return;
    }
    void submit(chosen.map((c) => ({ id: c.id, text: normalizeSpaces(c.text), kind: c.kind! })));
  }

  function retryFailed() {
    const failed = (results ?? []).filter((r) => r.outcome === 'failed').map((r) => r.item);
    setCandidates(failed.map((i) => ({ id: newCandidateId(), text: i.text, kind: i.kind, selected: true, visible: true, uncertain: false, source: 'manual' })));
    setResults(null);
    setShowErrors(false);
    setStep('review');
  }

  function onCropComplete(c: ViewCrop) {
    const el = imgRef.current;
    if (!el || !c.width || !c.height) {
      setPixelCrop(null);
      return;
    }
    // recorte da tela → pixels da imagem original
    const sx = el.naturalWidth / el.width;
    const sy = el.naturalHeight / el.height;
    setPixelCrop({ x: c.x * sx, y: c.y * sy, width: c.width * sx, height: c.height * sy });
  }

  const pickZone = (
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
        void pick(firstImage(e.dataTransfer.files));
      }}
      onPaste={(e: ReactClipboardEvent) => {
        const f = firstImage(e.clipboardData.files);
        if (f) {
          e.preventDefault();
          e.stopPropagation();
          void pick(f);
        }
      }}
    >
      <Icon name="plus" size={22} />
      <span>Arraste o print aqui, cole com Ctrl+V ou</span>
      <button type="button" className="btn" data-autofocus onClick={() => inputRef.current?.click()}>
        Escolher imagem
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        aria-label="Imagem do print"
        onChange={(e) => {
          void pick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );

  return (
    <Modal title="Importar de imagem" onClose={onClose}>
      <div className="form ocr-flow">
        {step === 'pick' && (
          <>
            <p className="muted small">
              Envie o print de um post ou perfil com filmes, séries ou livros. O texto é lido aqui no seu navegador; a imagem não é
              enviada. Você confere cada título antes de cadastrar.
            </p>
            {pickZone}
            <ErrorNote error={error} />
          </>
        )}

        {(step === 'crop' || step === 'ocr') && image && (
          <>
            <p className="muted small" id={`${statusId}-crop`}>
              Arraste sobre a imagem para recortar só a parte com os títulos (opcional, melhora a leitura).
            </p>
            <div className="ocr-preview">
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={onCropComplete}
                disabled={step === 'ocr'}
                keepSelection
                ariaLabels={{
                  cropArea: 'Área de recorte',
                  nwDragHandle: 'Canto superior esquerdo',
                  nDragHandle: 'Borda de cima',
                  neDragHandle: 'Canto superior direito',
                  eDragHandle: 'Borda direita',
                  seDragHandle: 'Canto inferior direito',
                  sDragHandle: 'Borda de baixo',
                  swDragHandle: 'Canto inferior esquerdo',
                  wDragHandle: 'Borda esquerda',
                }}
              >
                <img ref={imgRef} src={image.url} alt={`Prévia de ${image.name}`} aria-describedby={`${statusId}-crop`} />
              </ReactCrop>
            </div>
            <p className="muted small">
              {image.width}×{image.height}px
              {pixelCrop ? ` · recorte ${Math.round(pixelCrop.width)}×${Math.round(pixelCrop.height)}px` : ' · imagem inteira'}
            </p>
            {step === 'ocr' && progress && (
              <div className="ocr-progress" role="status" aria-live="polite">
                <span>
                  {progress.phase === 'loading'
                    ? 'Carregando o leitor de texto (só na primeira vez)…'
                    : 'Lendo o texto da imagem…'}{' '}
                  {Math.round(progress.progress * 100)}%
                </span>
                <progress max={1} value={progress.progress} aria-label="Progresso da leitura" />
              </div>
            )}
            <ErrorNote error={error} />
            <div className="actions">
              {step === 'ocr' ? (
                <button type="button" className="btn" onClick={cancelOcr}>
                  Cancelar leitura
                </button>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
                    Trocar imagem
                  </button>
                  {pixelCrop && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setCrop(undefined);
                        setPixelCrop(null);
                      }}
                    >
                      Usar imagem inteira
                    </button>
                  )}
                  <button type="button" className="btn btn-primary" onClick={() => void extract()}>
                    Extrair texto
                  </button>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              className="sr-only"
              aria-label="Trocar imagem"
              tabIndex={-1}
              onChange={(e) => {
                void pick(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </>
        )}

        {step === 'review' && (
          <>
            <p className="muted small">
              Confira os títulos encontrados: corrija a grafia e escolha a categoria. O que você cadastrar vai para a Revisão, onde
              confirma a obra certa antes de entrar na fila.
            </p>
            {shown.length > 0 && (
              <label className="small cand-bulk">
                Categoria para todos os marcados{' '}
                <select value="" aria-label="Categoria para todos os marcados" onChange={(e) => setKindForAll((e.target.value || null) as CandidateKind | null)}>
                  <option value="">Escolher…</option>
                  {(Object.keys(KIND_LABEL) as CandidateKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ul className="cand-list" aria-label="Títulos encontrados">
              {shown.map((c, i) => {
                const missingText = showErrors && c.selected && !normalizeSpaces(c.text);
                const missingKind = showErrors && c.selected && !c.kind;
                return (
                  <li key={c.id} className={c.selected ? 'cand-row' : 'cand-row off'}>
                    <input
                      type="checkbox"
                      checked={c.selected}
                      aria-label={`Incluir "${c.text || `título ${i + 1}`}"`}
                      onChange={(e) => update(c.id, { selected: e.target.checked })}
                    />
                    <input
                      id={`cand-${c.id}`}
                      className="cand-text"
                      value={c.text}
                      maxLength={200}
                      aria-label={`Título ${i + 1}`}
                      aria-invalid={missingText || undefined}
                      placeholder="Título"
                      onChange={(e) => update(c.id, { text: e.target.value })}
                    />
                    <select
                      value={c.kind ?? ''}
                      aria-label={`Categoria do título ${i + 1}`}
                      aria-invalid={missingKind || undefined}
                      onChange={(e) => update(c.id, { kind: (e.target.value || null) as CandidateKind | null, selected: true })}
                    >
                      <option value="">Categoria…</option>
                      {(Object.keys(KIND_LABEL) as CandidateKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-icon" aria-label={`Remover título ${i + 1}`} onClick={() => setCandidates((cs) => cs.filter((x) => x.id !== c.id))}>
                      <Icon name="x" size={16} />
                    </button>
                    {c.uncertain && <span className="muted small cand-hint">leitura incerta, confira a grafia</span>}
                    {(missingText || missingKind) && (
                      <span className="field-error small cand-hint">{missingText ? 'Escreva o título.' : 'Escolha a categoria.'}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {shown.length === 0 && (
              <p className="muted small">Nenhuma linha parece título. Veja as outras linhas lidas abaixo ou adicione à mão.</p>
            )}
            {others.length > 0 && (
              <details className="cand-others" open={shown.length === 0}>
                <summary>Outras linhas lidas ({others.length}): abra se faltou algum título</summary>
                <ul className="cand-others-list" aria-label="Outras linhas lidas">
                  {others.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="btn btn-link" onClick={() => update(c.id, { visible: true, selected: true })}>
                        <Icon name="plus" size={14} /> {c.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="actions actions-start">
              <button type="button" className="btn" onClick={() => addManual()}>
                <Icon name="plus" size={16} /> Adicionar título
              </button>
              <button type="button" className="btn" onClick={() => setStep('crop')} disabled={!image}>
                Voltar ao recorte
              </button>
            </div>
            {fullText && (
              <details className="ocr-fulltext">
                <summary>Ver o texto completo lido</summary>
                <textarea ref={fullTextRef} readOnly value={fullText} rows={8} aria-label="Texto completo lido da imagem" />
                <button type="button" className="btn" onClick={addSelection}>
                  Adicionar o trecho selecionado
                </button>
              </details>
            )}
            <ErrorNote error={error} />
            <div className="actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={sending || chosen.length === 0} aria-busy={sending} onClick={confirm}>
                {sending ? 'Cadastrando…' : `Cadastrar ${chosen.length} título(s)`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && results && (
          <>
            <ul className="cand-results" aria-label="Resultado do cadastro">
              {results.map((r) => (
                <li key={r.item.id} className={`cand-result ${r.outcome}`}>
                  <strong>{r.item.text}</strong> <span className="muted small">· {KIND_LABEL[r.item.kind]}</span>
                  <span className="cand-outcome small">{OUTCOME_LABEL[r.outcome]}</span>
                </li>
              ))}
            </ul>
            <p className="muted small" role="status">
              {summary(results)}
            </p>
            <div className="actions">
              {results.some((r) => r.outcome === 'failed') && (
                <button type="button" className="btn" onClick={retryFailed}>
                  Corrigir e reenviar os que falharam
                </button>
              )}
              {results.some((r) => r.outcome === 'review') && (
                <Link className="btn btn-primary" to="/revisao" onClick={onClose}>
                  Abrir a Revisão
                </Link>
              )}
              <button type="button" className="btn" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function summary(results: ItemResult[]): string {
  const n = (o: ItemResult['outcome']) => results.filter((r) => r.outcome === o).length;
  const parts = [`${n('review')} na Revisão`];
  if (n('duplicate')) parts.push(`${n('duplicate')} já estava(m) na sua lista`);
  if (n('failed')) parts.push(`${n('failed')} não cadastrado(s)`);
  return `${parts.join(' · ')}.`;
}

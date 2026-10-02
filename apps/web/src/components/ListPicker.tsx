// Seletor de lista com "+ Nova lista…": cria a lista ali mesmo (sem sair do que está fazendo) e já a
// deixa escolhida. Usado no "Adicionar título".
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { ErrorNote } from './shared';

const NEW = '__nova__';

export function ListPicker({ value, onChange, label = 'Lista (opcional)' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) input.current?.focus();
  }, [creating]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const list = await api.createList(n);
      await qc.invalidateQueries({ queryKey: ['lists'] });
      onChange(list.id);
      setCreating(false);
      setName('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <div className="list-picker">
        <label htmlFor="list-picker-new">Nova lista</label>
        <div className="row list-picker-new">
          <input
            id="list-picker-new"
            ref={input}
            value={name}
            maxLength={80}
            placeholder="Ex.: Para ver com a família"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Enter cria a lista (sem enviar o formulário em volta); Esc desiste
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setCreating(false);
              }
            }}
          />
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Criando…' : 'Criar'}
          </button>
          <button type="button" className="btn btn-link" onClick={() => setCreating(false)}>
            Cancelar
          </button>
        </div>
        <ErrorNote error={error} />
      </div>
    );
  }

  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else onChange(e.target.value);
        }}
      >
        <option value="">Nenhuma</option>
        {(lists.data ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
        <option value={NEW}>+ Nova lista…</option>
      </select>
    </label>
  );
}

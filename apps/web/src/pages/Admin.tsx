// Administração: quem pode usar o Fruiqo. Pedidos de acesso (aprovar/recusar), autorizados (revogar) e
// autorizar um e-mail direto. A API só responde para o administrador com MFA numa sessão verificada.
import type { AccessEntry } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../labels';

export function Admin() {
  const access = useQuery({ queryKey: ['admin-access'], queryFn: api.adminAccess, retry: false });
  const qc = useQueryClient();
  const toast = useToast();
  const { signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function decide(target: string, status: 'approved' | 'denied') {
    setBusy(target);
    setError(null);
    try {
      await api.adminDecide({ email: target, status });
      await qc.invalidateQueries({ queryKey: ['admin-access'] });
      toast.show(status === 'approved' ? `${target} pode usar o Fruiqo.` : `${target} sem acesso.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;
    await decide(target, 'approved');
    setEmail('');
  }

  const code = access.error instanceof ApiError ? access.error.body.code : undefined;
  if (code === 'mfa_setup_required') {
    return (
      <section>
        <h1>Administração</h1>
        <div className="card">
          <p>Para usar a administração, ative a verificação em duas etapas.</p>
          <Link className="btn btn-primary" to="/perfil#mfa">
            Ativar no Perfil
          </Link>
        </div>
      </section>
    );
  }
  if (code === 'mfa_required') {
    return (
      <section>
        <h1>Administração</h1>
        <div className="card">
          <p>Esta sessão não passou pelo código do app autenticador. Entre de novo para usar a administração.</p>
          <button type="button" className="btn btn-primary" onClick={() => void signOut()}>
            Sair e entrar de novo
          </button>
        </div>
      </section>
    );
  }

  const entries = access.data?.entries ?? [];
  const by = (s: AccessEntry['status']) => entries.filter((e) => e.status === s);
  const row = (e: AccessEntry, actions: React.ReactNode) => (
    <li key={e.email} className="admin-row">
      <div className="admin-who">
        <strong>{e.email}</strong>
        <span className="muted small">
          {e.status === 'pending' ? `pediu em ${formatDateTime(e.requestedAt)}` : e.decidedAt ? `decidido em ${formatDateTime(e.decidedAt)}` : ''}
          {e.hasAccount ? ' · já tem conta' : ''}
        </span>
      </div>
      <div className="row admin-acts">{actions}</div>
    </li>
  );

  return (
    <section className="admin">
      <div className="page-head">
        <h1>Administração</h1>
      </div>
      <p className="muted">Quem pode usar o Fruiqo. Quem se cadastra (ou entra com o Google) sem autorização vira um pedido aqui.</p>
      <ErrorNote error={(access.error && !code ? access.error : null) ?? error} />

      <form className="row admin-add" onSubmit={(e) => void add(e)}>
        <label className="grow">
          Autorizar e-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@exemplo.com" autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!email.trim() || busy !== null}>
          Autorizar
        </button>
      </form>

      <h2>Pedidos de acesso {by('pending').length > 0 && <span className="badge">{by('pending').length}</span>}</h2>
      {by('pending').length === 0 ? (
        <p className="muted small">Nenhum pedido aguardando.</p>
      ) : (
        <ul className="admin-list" aria-label="Pedidos de acesso">
          {by('pending').map((e) =>
            row(
              e,
              <>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy === e.email} onClick={() => void decide(e.email, 'approved')}>
                  Aprovar
                </button>
                <button type="button" className="btn btn-sm" disabled={busy === e.email} onClick={() => void decide(e.email, 'denied')}>
                  Recusar
                </button>
              </>,
            ),
          )}
        </ul>
      )}

      <h2>Autorizados</h2>
      <ul className="admin-list" aria-label="Autorizados">
        {(access.data?.configured ?? []).map((c) => (
          <li key={`cfg:${c}`} className="admin-row">
            <div className="admin-who">
              <strong>{c}</strong>
              <span className="muted small">pela configuração do servidor</span>
            </div>
          </li>
        ))}
        {by('approved').map((e) =>
          row(
            e,
            <button type="button" className="btn btn-sm" disabled={busy === e.email} onClick={() => void decide(e.email, 'denied')}>
              Revogar
            </button>,
          ),
        )}
      </ul>

      {by('denied').length > 0 && (
        <>
          <h2>Sem acesso</h2>
          <ul className="admin-list" aria-label="Sem acesso">
            {by('denied').map((e) =>
              row(
                e,
                <button type="button" className="btn btn-sm" disabled={busy === e.email} onClick={() => void decide(e.email, 'approved')}>
                  Liberar
                </button>,
              ),
            )}
          </ul>
        </>
      )}
    </section>
  );
}

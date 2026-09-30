import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, mockViewport, renderWithProviders } from '../test/helpers';
import { Layout } from './Layout';
import { Modal } from './shared';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ email: 'dev@fruiqo.test', signOut: vi.fn() }),
}));

afterEach(() => __setAccessToken(null));

function FormPage() {
  return (
    <section>
      <h1>Com campo</h1>
      <input type="checkbox" aria-label="marcar" />
      <input aria-label="desabilitado" disabled />
      <input aria-label="primeiro campo" />
    </section>
  );
}

function LatePage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <section>
      <h1>Carrega depois</h1>
      {ready && <select aria-label="filtro carregado" />}
    </section>
  );
}

function ModalPage() {
  return (
    <section>
      <h1>Com modal</h1>
      <input aria-label="campo da página" />
      <Modal title="Aberto" onClose={() => {}}>
        <input aria-label="campo do modal" />
      </Modal>
    </section>
  );
}

function renderShell(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route path="form" element={<FormPage />} />
        <Route path="texto" element={<h1>Só texto</h1>} />
        <Route path="depois" element={<LatePage />} />
        <Route path="modal" element={<ModalPage />} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('foco automático por rota (RF-45)', () => {
  it('foca o primeiro campo habilitado (ignora checkbox e desabilitado)', async () => {
    mockViewport(1440);
    mockApi({});
    renderShell('/form');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('primeiro campo')));
  });

  it('sem campo, foca o título da página (tabIndex -1)', async () => {
    mockViewport(1440);
    mockApi({});
    renderShell('/texto');
    const h1 = screen.getByRole('heading', { name: 'Só texto' });
    await waitFor(() => expect(document.activeElement).toBe(h1));
    expect(h1.getAttribute('tabindex')).toBe('-1');
  });

  it('campo que chega depois (dados da API) ainda recebe o foco', async () => {
    mockViewport(1440);
    mockApi({});
    renderShell('/depois');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('filtro carregado')));
  });

  it('não rouba o foco de um modal aberto', async () => {
    mockViewport(1440);
    mockApi({});
    renderShell('/modal');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(document.activeElement).toBe(screen.getByLabelText('campo do modal'));
  });

  it('trocar de rota move o foco para a nova página', async () => {
    mockViewport(1440);
    mockApi({});
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="catalogo" element={<FormPage />} />
          <Route path="listas" element={<h1>Listas</h1>} />
        </Route>
      </Routes>,
      { route: '/catalogo' },
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('primeiro campo')));
    await user.click(screen.getByRole('link', { name: 'Listas' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Listas' })));
  });
});

describe('menu (D-23)', () => {
  it('Minha Área vem antes do Catálogo e a Revisão sai do menu', async () => {
    mockViewport(1440);
    __setAccessToken('tok');
    mockApi({});
    renderShell('/texto');
    const links = (await screen.findAllByRole('link')).map((a) => a.textContent ?? '');
    const area = links.findIndex((l) => l.includes('Minha Área'));
    expect(area).toBeGreaterThanOrEqual(0);
    expect(area).toBeLessThan(links.findIndex((l) => l.includes('Catálogo')));
    expect(screen.queryByRole('link', { name: /Revisão/ })).toBeNull();
  });
});

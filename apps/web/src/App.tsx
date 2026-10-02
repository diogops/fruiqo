import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { Activity, ActivityDetail } from './pages/Activity';
import { Catalog } from './pages/Catalog';
import { ListDetail, Lists } from './pages/Lists';
import { Login } from './pages/Login';
import { Admin } from './pages/Admin';
import { Privacy } from './pages/Privacy';
import { Profile } from './pages/Profile';
import { Sandbox } from './pages/Sandbox';
import { TonightPage } from './pages/Tonight';
import { SHOW_DEV_TOOLS } from './devTools';

function Gate() {
  const { state } = useAuth();
  if (state === 'checking') return <p className="muted center">Carregando…</p>;
  if (state === 'signed_out') return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/minha-area" replace />} />
        <Route path="minha-area" element={<Catalog key="area" area />} />
        <Route path="catalogo" element={<Catalog key="catalog" />} />
        {/* "Como estou" virou o "Assistir hoje" (mesma função): o endereço antigo leva para lá */}
        <Route path="como-estou" element={<Navigate to="/hoje" replace />} />
        <Route path="listas" element={<Lists />} />
        <Route path="listas/:id" element={<ListDetail />} />
        {/* D-23: sem revisão; o que se importa vai direto para a Minha Área */}
        <Route path="revisao" element={<Navigate to="/minha-area" replace />} />
        <Route path="atividade" element={<Activity />} />
        <Route path="atividade/:shareId" element={<ActivityDetail />} />
        <Route path="hoje" element={<TonightPage />} />
        <Route path="perfil" element={<Profile />} />
        <Route path="admin" element={<Admin />} />
        {SHOW_DEV_TOOLS && <Route path="sandbox" element={<Sandbox />} />}
        <Route path="*" element={<Navigate to="/minha-area" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* pública, sem login (exigida pelo login com Google e pela LGPD) */}
              <Route path="/privacidade" element={<Privacy />} />
              <Route path="*" element={<Gate />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

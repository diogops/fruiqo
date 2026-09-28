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
import { Profile } from './pages/Profile';
import { Review } from './pages/Review';
import { Sandbox } from './pages/Sandbox';

function Gate() {
  const { state } = useAuth();
  if (state === 'checking') return <p className="muted center">Carregando…</p>;
  if (state === 'signed_out') return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/catalogo" replace />} />
        <Route path="catalogo" element={<Catalog />} />
        <Route path="listas" element={<Lists />} />
        <Route path="listas/:id" element={<ListDetail />} />
        <Route path="revisao" element={<Review />} />
        <Route path="atividade" element={<Activity />} />
        <Route path="atividade/:shareId" element={<ActivityDetail />} />
        <Route path="perfil" element={<Profile />} />
        <Route path="sandbox" element={<Sandbox />} />
        <Route path="*" element={<Navigate to="/catalogo" replace />} />
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
            <Gate />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

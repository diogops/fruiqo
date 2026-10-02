import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupExternalLinks } from './pwa/external-links';
import { setupPwa } from './pwa/install';
import './styles.css';

// PWA: service worker e convite de instalação (Android)
setupPwa();
setupExternalLinks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// "Instalar app" (Android/Chrome/Edge): aparece só quando o navegador oferece a instalação.
// No iPhone a instalação é pelo menu Compartilhar → "Adicionar à Tela de Início" (dica no Layout).
import { useEffect, useState } from 'react';
import { Icon } from '../components/ui';
import { canInstall, onInstallChange, promptInstall } from './install';

export function InstallAppButton({ className = 'btn btn-primary' }: { className?: string }) {
  const [available, setAvailable] = useState(canInstall);
  useEffect(() => onInstallChange(() => setAvailable(canInstall())), []);
  if (!available) return null;
  return (
    <button type="button" className={className} onClick={() => void promptInstall()}>
      <Icon name="plus" size={14} /> Instalar app
    </button>
  );
}

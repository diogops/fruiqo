// Ferramentas de desenvolvimento (Sandbox) só em dev ou com VITE_SHOW_DEV_TOOLS=true.
// No build de produção a condição vira constante falsa e a página sai do bundle.
export const SHOW_DEV_TOOLS =
  import.meta.env.VITE_SHOW_DEV_TOOLS === 'true' || (import.meta.env.DEV && import.meta.env.VITE_SHOW_DEV_TOOLS !== 'false');

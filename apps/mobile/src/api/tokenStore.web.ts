// Preview no navegador (RF-17): o expo-secure-store não existe no web e o refresh token não pode ir para
// localStorage (XSS). Fica só em memória: recarregar a página exige login de novo, o que é aceitável em dev.
const memory = new Map<string, string>();

export const getToken = async (key: string): Promise<string | null> => memory.get(key) ?? null;
export const setToken = async (key: string, value: string): Promise<void> => {
  memory.set(key, value);
};
export const deleteToken = async (key: string): Promise<void> => {
  memory.delete(key);
};

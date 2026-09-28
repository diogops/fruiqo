// A Share Extension do iOS abre o app com `fruiqo://dataUrl=<chave>`. Esse link não é uma rota:
// o expo-share-intent o lê sozinho, então aqui só evitamos a tela de "rota não encontrada".
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('dataUrl=')) return '/';
  return path;
}

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { useAppState } from '../src/state/AppState';
import { Button } from '../src/ui/components';
import { ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

// Transparência sobre o tratamento dos dados antes do primeiro uso (TOS-REQ-30, SEC-REQ-23).
export default function Consent() {
  useTheme(); // re-renderiza na troca de tema
  const { acceptConsent } = useAppState();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad}>
      <Text style={ui.h1}>Como o Fruiqo usa o que você compartilha</Text>
      <Text style={ui.body}>
        Quando você compartilha um post ou vídeo com o Fruiqo, o link e o texto recebidos são enviados ao servidor do
        Fruiqo para identificar filmes, séries e músicas citados.
      </Text>
      <Text style={ui.body}>
        Quando a análise por inteligência artificial estiver habilitada, esse conteúdo também é enviado à Anthropic
        (provedora do modelo Claude), com servidores fora do Brasil. O conteúdo não é usado para treinar modelos.
      </Text>
      <Text style={ui.body}>
        Prints de tela (compartilhados, importados da galeria ou de arquivos) e fotos tiradas pelo app são lidos no próprio
        aparelho (reconhecimento de texto do Android/iOS). A imagem nunca sai do seu celular: só o texto extraído é
        enviado ao servidor do Fruiqo.
      </Text>
      <Text style={ui.body}>
        Para encontrar os títulos, o Fruiqo consulta serviços públicos de catálogo (como TMDB e Spotify). PDFs e outros
        arquivos ainda não são suportados nesta versão.
      </Text>
      <Text style={ui.body}>
        Você pode excluir qualquer compartilhamento a qualquer momento, e encerrar sessões nas Configurações.
      </Text>
      <Text style={ui.muted}>
        Não compartilhe conteúdo com dados pessoais sensíveis de outras pessoas.
      </Text>
      <Button
        title="Entendi e concordo"
        loading={saving}
        onPress={async () => {
          setSaving(true);
          try {
            await acceptConsent();
          } finally {
            setSaving(false);
          }
        }}
      />
      <Button title="Sobre o Fruiqo" variant="secondary" onPress={() => router.push('/about')} />
    </ScrollView>
  );
}

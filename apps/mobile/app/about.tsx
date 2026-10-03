import Constants from 'expo-constants';
import { ScrollView, Text } from 'react-native';

import { Link } from '../src/ui/components';
import { ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

// Atribuições exigidas (TOS-REQ-01, TOS-REQ-10) e avisos de licença OSS (TOS-REQ-34).
export default function About() {
  useTheme(); // re-renderiza na troca de tema
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad}>
      <Text style={ui.h1}>Fruiqo</Text>
      <Text style={ui.muted}>Versão {Constants.expoConfig?.version ?? '0.1.0'}</Text>

      <Text style={ui.h2}>Dados de catálogo</Text>
      <Text style={ui.body}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
      <Link title="themoviedb.org" url="https://www.themoviedb.org/" />
      <Text style={ui.body}>
        Gêneros, sinopses, pôsteres e duração vêm do TMDB. "Onde assistir" no Brasil: dados de disponibilidade da JustWatch,
        fornecidos pelo TMDB. Tocar no logo de um serviço abre a página do título no site dele, com os identificadores do
        Wikidata (dados CC0); sem o identificador, abre a busca do serviço.
      </Text>
      <Link title="justwatch.com" url="https://www.justwatch.com/" />
      <Link title="wikidata.org" url="https://www.wikidata.org/" />
      <Text style={ui.body}>
        Metadados de música fornecidos pelo Spotify. Cada item exibido tem um link de volta para o Spotify.
      </Text>
      <Link title="spotify.com" url="https://www.spotify.com/" />
      <Text style={ui.body}>Dados de livros: Open Library (capas de covers.openlibrary.org).</Text>
      <Link title="openlibrary.org" url="https://openlibrary.org/" />

      <Text style={ui.h2}>Licenças de código aberto</Text>
      <Text style={ui.body}>
        expo-share-intent — Copyright (c) 2023 Evan Bacon. Licença MIT.
      </Text>
      <Text style={ui.body}>
        expo-text-extractor — Copyright (c) Petr Chalupa (pchalupa). Licença MIT. Usa o Google ML Kit (Android) e o Apple Vision
        (iOS) para ler o texto dos prints no próprio aparelho.
      </Text>
      <Text style={ui.body}>
        expo-image-picker e expo-document-picker (Expo) — Licença MIT. Abrem os seletores do próprio sistema (galeria,
        arquivos e câmera); o app recebe só as imagens escolhidas.
      </Text>
      <Text style={ui.body}>
        expo-speech-recognition — Copyright (c) jamsch. Licença MIT. Usa o reconhecimento de voz do sistema (no aparelho
        quando disponível; senão, o serviço do Google no Android ou da Apple no iOS) para transformar em texto o pedido
        falado no "Como estou". O áudio não passa pelo Fruiqo.
      </Text>
      <Text style={ui.body}>
        Expo, React Native, React e demais bibliotecas incluídas são distribuídas sob suas próprias licenças de código
        aberto (majoritariamente MIT).
      </Text>
      <Text style={ui.muted}>
        A licença MIT permite uso, cópia, modificação e distribuição, desde que o aviso de copyright e a permissão sejam
        mantidos em todas as cópias.
      </Text>
    </ScrollView>
  );
}

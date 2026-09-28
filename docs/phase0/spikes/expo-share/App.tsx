// SPIKE-15: inspetor de share intent para o teste §4.1 (o que IG/YT/TT entregam ao share sheet).
// Código de spike, não de produção: só mostra o payload recebido e permite exportá-lo como texto.
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Button, Image, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useShareIntent, type ShareIntent } from 'expo-share-intent';

type Entry = { at: string; payload: ShareIntent };

export default function App() {
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({
    resetOnBackground: false,
  });
  const [log, setLog] = useState<Entry[]>([]);

  useEffect(() => {
    if (hasShareIntent) {
      setLog((prev) => [{ at: new Date().toISOString(), payload: shareIntent }, ...prev]);
      resetShareIntent();
    }
  }, [hasShareIntent]);

  const exportLog = () =>
    Share.share({ message: JSON.stringify({ platform: Platform.OS, version: Platform.Version, log }, null, 2) });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Share Inspector (SPIKE-15)</Text>
      <Text style={styles.hint}>Compartilhe algo do Instagram, YouTube ou TikTok para este app.</Text>
      {error && <Text style={styles.error}>Erro: {error}</Text>}
      <View style={styles.actions}>
        <Button title="Exportar log" onPress={exportLog} disabled={log.length === 0} />
        <Button title="Limpar" onPress={() => setLog([])} disabled={log.length === 0} />
      </View>
      <ScrollView style={styles.list}>
        {log.length === 0 && <Text style={styles.hint}>Nenhum compartilhamento recebido ainda.</Text>}
        {log.map((entry, i) => (
          <View key={entry.at + i} style={styles.card}>
            <Text style={styles.meta}>
              #{log.length - i} · {entry.at} · type={String(entry.payload.type)} · files={entry.payload.files?.length ?? 0}
            </Text>
            {entry.payload.files?.map((f) =>
              f.mimeType.startsWith('image/') ? (
                <Image key={f.path} source={{ uri: f.path }} style={styles.thumb} resizeMode="contain" />
              ) : null,
            )}
            <Text selectable style={styles.json}>
              {JSON.stringify(entry.payload, null, 2)}
            </Text>
          </View>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 56, paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  hint: { color: '#555', marginVertical: 6 },
  error: { color: '#b00020', marginVertical: 6 },
  actions: { flexDirection: 'row', gap: 12, marginVertical: 8 },
  list: { flex: 1 },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 12 },
  meta: { fontWeight: '600', marginBottom: 6 },
  thumb: { width: '100%', height: 180, marginBottom: 6, backgroundColor: '#f2f2f2' },
  json: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
});

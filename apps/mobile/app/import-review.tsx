// "Conferir títulos": o texto lido dos prints (OCR no aparelho) vira candidatos pelas mesmas regras do
// web (@fruiqo/contracts: extractCandidates). Na lista, só o que parece título; o resto fica recolhido.
// O usuário corrige, escolhe a categoria e só o que confirmar é cadastrado, pelo fluxo existente
// (.txt com cabeçalho por categoria em POST /shares → Revisão). A imagem nunca sai do aparelho.
import {
  buildImportRequest,
  type Candidate,
  type CandidateKind,
  type ConfirmedItem,
  extractCandidates,
  type ItemResult,
  matchOutcomes,
  newCandidateId,
  normalizeSpaces,
  type Share,
} from '@fruiqo/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ApiError, createShare, getShare, getShareSteps } from '../src/api/client';
import { takeImportDraft } from '../src/share/importDraft';
import { Button, Chip, Icon } from '../src/ui/components';
import { colors, ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

const KIND_LABEL: Record<CandidateKind, string> = { movie: 'Filme', series: 'Série', book: 'Livro' };
const KINDS = Object.keys(KIND_LABEL) as CandidateKind[];
const OUTCOME_LABEL: Record<ItemResult['outcome'], string> = {
  review: 'Na Revisão',
  duplicate: 'Já estava na sua lista',
  failed: 'Não foi cadastrado',
};

async function waitShare(id: string): Promise<Share> {
  for (let i = 0; i < 45; i++) {
    const s = await getShare(id);
    if (s.status === 'done' || s.status === 'failed' || s.status === 'rejected') return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return getShare(id);
}

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function ImportReview() {
  useTheme();
  const router = useRouter();
  // o rascunho é lido uma vez (só em memória)
  const [draft] = useState(() => takeImportDraft());
  const [candidates, setCandidates] = useState<Candidate[]>(() => (draft ? extractCandidates(draft.lines) : []));
  const [showOthers, setShowOthers] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const pending = useRef<{ key: string; id: string } | null>(null);

  if (!draft && !results) {
    return (
      <View style={[ui.screen, ui.pad, { gap: 12 }]}>
        <Text style={ui.body}>Nada para conferir. Importe prints pela Galeria, Arquivos, Câmera ou Colar.</Text>
        <Button title="Voltar" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const shown = candidates.filter((c) => c.visible);
  const others = candidates.filter((c) => !c.visible);
  const chosen = candidates.filter((c) => c.selected);
  const invalid = chosen.filter((c) => !normalizeSpaces(c.text) || !c.kind);

  const update = (id: string, patch: Partial<Candidate>) => setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addManual = () =>
    setCandidates((cs) => [...cs, { id: newCandidateId(), text: '', selected: true, visible: true, kind: null, uncertain: false, source: 'manual' }]);
  const kindForAll = (kind: CandidateKind) => setCandidates((cs) => cs.map((c) => (c.selected ? { ...c, kind } : c)));

  async function submit(items: ConfirmedItem[]) {
    if (sending || items.length === 0) return;
    setSending(true);
    setError(null);
    // o mesmo envio (retry, toque repetido) reaproveita o clientShareId: idempotente
    const key = JSON.stringify(items.map((i) => [i.kind, normalizeSpaces(i.text)]));
    if (pending.current?.key !== key) pending.current = { key, id: randomUUID() };
    try {
      const created = await createShare(buildImportRequest(items, pending.current.id));
      const done = await waitShare(created.id);
      if (done.status !== 'done') throw new Error(done.error ?? 'Não foi possível cadastrar agora. Tente de novo.');
      const steps = await getShareSteps(done.id);
      pending.current = null;
      setResults(matchOutcomes(items, steps.decisions));
    } catch (e) {
      // nada confirmado: os itens continuam na tela e o mesmo envio pode ser repetido
      setError(message(e));
    } finally {
      setSending(false);
    }
  }

  function confirm() {
    if (invalid.length > 0) {
      setShowErrors(true);
      Alert.alert('Falta completar', 'Escolha a categoria (e o título) de cada item marcado.');
      return;
    }
    void submit(chosen.map((c) => ({ id: c.id, text: normalizeSpaces(c.text), kind: c.kind! })));
  }

  function retryFailed() {
    const failed = (results ?? []).filter((r) => r.outcome === 'failed').map((r) => r.item);
    setCandidates(failed.map((i) => ({ id: newCandidateId(), text: i.text, kind: i.kind, selected: true, visible: true, uncertain: false, source: 'manual' as const })));
    setResults(null);
    setShowErrors(false);
  }

  if (results) {
    const count = (o: ItemResult['outcome']) => results.filter((r) => r.outcome === o).length;
    return (
      <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { gap: 10, paddingBottom: 32 }]}>
        <Text style={ui.h2}>Resultado</Text>
        {results.map((r) => (
          <View
            key={r.item.id}
            style={[ui.card, { gap: 2 }, r.outcome === 'failed' && { borderColor: colors.danger }]}
            accessibilityLabel={`${r.item.text}, ${KIND_LABEL[r.item.kind]}: ${OUTCOME_LABEL[r.outcome]}`}
          >
            <Text style={[ui.body, { fontWeight: '700', color: colors.text }]}>{r.item.text}</Text>
            <Text style={[ui.muted, r.outcome === 'review' && { color: colors.ok }, r.outcome === 'failed' && { color: colors.danger }]}>
              {KIND_LABEL[r.item.kind]} · {OUTCOME_LABEL[r.outcome]}
            </Text>
          </View>
        ))}
        <Text style={ui.muted}>
          {[`${count('review')} na Revisão`, count('duplicate') ? `${count('duplicate')} já estava(m) na sua lista` : null, count('failed') ? `${count('failed')} não cadastrado(s)` : null]
            .filter(Boolean)
            .join(' · ')}
          .
        </Text>
        {count('failed') > 0 && <Button title="Corrigir e reenviar os que falharam" variant="secondary" onPress={retryFailed} />}
        {count('review') > 0 && <Button title="Abrir a Revisão" icon="checkmark-done" onPress={() => router.replace('/review' as never)} />}
        <Button title="Fechar" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { gap: 12, paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
      <Text style={ui.muted}>
        Confira os títulos lidos {draft && draft.prints > 1 ? `dos ${draft.prints} prints` : 'do print'}: corrija a grafia e escolha a
        categoria. O que você cadastrar vai para a Revisão, onde confirma a obra certa.
      </Text>

      {shown.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={ui.muted}>Categoria para todos os marcados</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {KINDS.map((k) => (
              <Chip key={k} label={KIND_LABEL[k]} onPress={() => kindForAll(k)} />
            ))}
          </View>
        </View>
      )}

      {shown.map((c, i) => {
        const missingText = showErrors && c.selected && !normalizeSpaces(c.text);
        const missingKind = showErrors && c.selected && !c.kind;
        return (
          <View key={c.id} style={[ui.card, { gap: 8, opacity: c.selected ? 1 : 0.6 }, (missingText || missingKind) && { borderColor: colors.danger }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: c.selected }}
                accessibilityLabel={`Incluir ${c.text || `título ${i + 1}`}`}
                onPress={() => update(c.id, { selected: !c.selected })}
                hitSlop={8}
              >
                <Icon name={c.selected ? 'checkbox' : 'square-outline'} size={26} color={c.selected ? colors.primary : colors.muted} />
              </Pressable>
              <TextInput
                style={[ui.input, { flex: 1 }]}
                value={c.text}
                onChangeText={(text) => update(c.id, { text })}
                placeholder="Título"
                placeholderTextColor={colors.muted}
                accessibilityLabel={`Título ${i + 1}`}
                maxLength={200}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={`Remover título ${i + 1}`} onPress={() => setCandidates((cs) => cs.filter((x) => x.id !== c.id))} hitSlop={8}>
                <Icon name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {KINDS.map((k) => (
                <Chip key={k} label={KIND_LABEL[k]} selected={c.kind === k} onPress={() => update(c.id, { kind: k, selected: true })} />
              ))}
            </View>
            {missingText ? <Text style={ui.error}>Escreva o título.</Text> : missingKind ? <Text style={ui.error}>Escolha a categoria.</Text> : null}
          </View>
        );
      })}
      {shown.length === 0 && <Text style={ui.muted}>Nenhuma linha parece título. Veja as outras linhas lidas ou adicione à mão.</Text>}

      {others.length > 0 && (
        <View style={{ gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOthers }} onPress={() => setShowOthers((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            <Icon name={showOthers ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.muted} />
            <Text style={[ui.body, { color: colors.text2 }]}>Outras linhas lidas ({others.length}): toque se faltou algum título</Text>
          </Pressable>
          {showOthers &&
            others.map((c) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`Adicionar ${c.text}`} onPress={() => update(c.id, { visible: true, selected: true })} style={{ flexDirection: 'row', gap: 6, paddingVertical: 6 }}>
                <Icon name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[ui.body, { flex: 1 }]}>{c.text}</Text>
              </Pressable>
            ))}
        </View>
      )}

      <Button title="Adicionar título" icon="add" variant="secondary" onPress={addManual} />

      {draft?.fullText ? (
        <View style={{ gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFull }} onPress={() => setShowFull((v) => !v)} style={{ paddingVertical: 8 }}>
            <Text style={{ color: colors.primary, fontSize: 15 }}>{showFull ? 'Ocultar o texto completo lido' : 'Ver o texto completo lido'}</Text>
          </Pressable>
          {showFull && (
            <Text selectable style={[ui.muted, { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }]}>
              {draft.fullText}
            </Text>
          )}
        </View>
      ) : null}

      {error ? <Text style={ui.error}>{error}</Text> : null}
      <Button title={sending ? 'Cadastrando…' : `Cadastrar ${chosen.length} título(s)`} icon="checkmark" loading={sending} disabled={sending || chosen.length === 0} onPress={confirm} />
      <Button title="Cancelar" variant="secondary" disabled={sending} onPress={() => router.back()} />
    </ScrollView>
  );
}

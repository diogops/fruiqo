import { JUSTWATCH_ATTRIBUTION, providerTitleLink, type ShareStatus, TMDB_ATTRIBUTION, type Title, type WatchProvider } from '@fruiqo/contracts';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, gradients, onThemeChange } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Ícones do app: um único conjunto (Ionicons), fontes carregadas pelo expo-font. */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color ?? colors.text2} />;
}

/**
 * Fundo em degradê sem módulo nativo novo: `experimental_backgroundImage` do React Native
 * (New Architecture) com CSS linear-gradient; `backgroundColor` é o fallback.
 */
export function Gradient({
  colors: gradient,
  fallback,
  style,
  children,
}: {
  colors: string;
  fallback: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  return (
    <View style={[{ backgroundColor: fallback }, { experimental_backgroundImage: gradient } as ViewStyle, style]}>{children}</View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  /** altura menor (44px), para linhas com vários botões */
  compact?: boolean;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : colors.surface2;
  const fg = variant === 'secondary' ? colors.text : variant === 'danger' ? colors.danger : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'primary' && ({ experimental_backgroundImage: gradients.brand } as ViewStyle),
        variant === 'primary' && styles.buttonGlow,
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.borderStrong },
        variant === 'danger' && { borderWidth: 1, borderColor: colors.dangerBorder },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Icon name={icon} size={compact ? 17 : 19} color={fg} /> : null}
          <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: fg }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function statusLabel(): Record<ShareStatus, { label: string; color: string }> {
  return {
    queued: { label: 'Na fila', color: colors.muted },
    processing: { label: 'Processando', color: colors.warn },
    done: { label: 'Pronto', color: colors.ok },
    failed: { label: 'Falhou', color: colors.danger },
    rejected: { label: 'Recusado', color: colors.danger },
  };
}

export function StatusBadge({ status }: { status: ShareStatus }) {
  const s = statusLabel()[status];
  return (
    <View style={[styles.badge, { borderColor: s.color }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

/** Abre só URLs https públicas (SEC-REQ-12). */
export function openExternal(url: string | undefined) {
  if (!url) return;
  try {
    if (new URL(url).protocol !== 'https:') return;
  } catch {
    return;
  }
  void Linking.openURL(url);
}

export function Link({ title, url }: { title: string; url: string | undefined }) {
  if (!url) return null;
  return (
    <Text accessibilityRole="link" style={styles.link} onPress={() => openExternal(url)}>
      {title}
    </Text>
  );
}

/** Capa (ou outro conteúdo) que abre a página da obra para conferir; sem `url`, só o conteúdo. */
export function WorkLink({ url, label, children }: { url: string | undefined; label: string; children: React.ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={() => openExternal(url)} hitSlop={4}>
      {children}
    </Pressable>
  );
}

/** Linha de links "Ver no TMDB ↗ · IMDb ↗" para conferir a obra antes de incluir/aprovar. */
export function WorkLinks({ title, page }: { title: string; page: { url: string; label: string; imdbUrl?: string } | undefined }) {
  if (!page) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
      <Text accessibilityRole="link" accessibilityLabel={`Ver ${title} no ${page.label}`} style={styles.link} onPress={() => openExternal(page.url)}>
        Ver no {page.label} ↗
      </Text>
      {page.imdbUrl ? (
        <Text accessibilityRole="link" accessibilityLabel={`Ver ${title} no IMDb`} style={styles.link} onPress={() => openExternal(page.imdbUrl)}>
          IMDb ↗
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  onPress,
  selected,
  disabled,
  hint,
  icon,
  compact,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** texto pequeno ao lado do rótulo (ex.: quantos títulos combinam) */
  hint?: string;
  /** versão baixa, para barras de atalho (a área de toque segue ampliada pelo hitSlop) */
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled || !onPress}
      hitSlop={compact ? 6 : undefined}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.chipCompact,
        selected && ({ backgroundColor: colors.primary, borderColor: 'transparent', experimental_backgroundImage: gradients.brand } as ViewStyle),
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      <View style={styles.buttonRow}>
        {icon ? <Icon name={icon} size={compact ? 14 : 16} color={selected ? colors.primaryText : colors.primary2} /> : null}
        <Text style={[styles.chipText, compact && styles.chipTextCompact, selected && { color: colors.primaryText }]}>
          {label}
          {hint ? <Text style={[styles.chipHint, selected && { color: colors.primaryText }]}> {hint}</Text> : null}
        </Text>
      </View>
    </Pressable>
  );
}

/** Botão só com ícone (barra do catálogo); `badge` mostra um número pequeno no canto. */
export function IconButton({
  icon,
  label,
  onPress,
  primary,
  badge,
}: {
  icon: IconName;
  /** rótulo acessível */
  label: string;
  onPress: () => void;
  primary?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} (${badge})` : label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        primary && ({ backgroundColor: colors.primary, borderColor: 'transparent', experimental_backgroundImage: gradients.brand } as ViewStyle),
        { opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Icon name={icon} size={20} color={primary ? colors.primaryText : colors.text2} />
      {badge ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
  const pct = `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%` as const;
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar">
      <View style={[styles.progressFill, { width: pct }, { experimental_backgroundImage: gradients.brand } as ViewStyle]} />
    </View>
  );
}

/** Pôster (só https, SEC-REQ-12) ou placeholder com a inicial do título. */
export function Poster({ url, title, size = 'md' }: { url?: string; title: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? { width: 44, height: 66 } : size === 'lg' ? { width: 110, height: 165 } : { width: 72, height: 108 };
  if (url?.startsWith('https://')) {
    return <Image source={{ uri: url }} style={[dims, styles.poster]} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[dims, styles.poster, styles.posterEmpty, { experimental_backgroundImage: gradients.posterFallback } as ViewStyle]}>
      <Text style={styles.posterLetter}>{title.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

const PROVIDER_GROUP: Record<WatchProvider['type'], string> = { flatrate: 'Assinatura', rent: 'Aluguel', buy: 'Compra' };

/** Um logo por serviço e tipo (o TMDB repete variantes como "com anúncios"). */
export function groupProviders(providers: WatchProvider[]): [WatchProvider['type'], WatchProvider[]][] {
  const out: [WatchProvider['type'], WatchProvider[]][] = [];
  for (const type of ['flatrate', 'rent', 'buy'] as const) {
    const seen = new Set<string>();
    const list = providers.filter((p) => p.type === type && !seen.has(p.key ?? p.name) && seen.add(p.key ?? p.name));
    if (list.length > 0) out.push([type, list]);
  }
  return out;
}

/**
 * RF-38 / TOS-REQ-01: onde assistir no Brasil (dados do TMDB, fonte JustWatch). O botão abre a
 * página pública do TMDB, nunca um deep link para o app de streaming (TOS-REQ-17).
 */
export function WatchProviders({ title, compact }: { title: Pick<Title, 'title' | 'watchProvidersBR' | 'watchUrl' | 'resolution'>; compact?: boolean }) {
  const providers = title.watchProvidersBR ?? [];
  if (providers.length === 0 && !title.watchUrl) return null;
  const groups = groupProviders(providers);
  return (
    <View style={{ gap: 6 }}>
      {groups.map(([type, list]) => (
        <View key={type} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {!compact && <Text style={styles.providerGroup}>{PROVIDER_GROUP[type]}</Text>}
          {list.slice(0, compact ? 4 : 8).map((p) => {
            const logo = p.logoUrl?.startsWith('https://') ? (
              <Image source={{ uri: p.logoUrl }} style={styles.providerLogo} accessibilityLabel={p.name} />
            ) : (
              <Text style={styles.providerName}>{p.name}</Text>
            );
            // D-22: toque no logo abre o título no site do serviço (direto pelo Wikidata, senão a busca,
            // senão a página inicial); serviço desconhecido → página do TMDB
            const target = providerTitleLink(p.name, title.title, title.resolution?.titleLinks);
            const url = target?.url ?? title.watchUrl;
            const label =
              target?.kind === 'title' ? `Abrir "${title.title}" no ${p.name}` : target?.kind === 'search' ? `Buscar "${title.title}" no ${p.name}` : `Abrir ${p.name}`;
            return url ? (
              <Pressable key={p.name} accessibilityRole="link" accessibilityLabel={label} onPress={() => openExternal(url)} hitSlop={4}>
                {logo}
              </Pressable>
            ) : (
              <View key={p.name}>{logo}</View>
            );
          })}
          {compact && <Text style={styles.providerGroup}>{PROVIDER_GROUP[type].toLowerCase()}</Text>}
        </View>
      ))}
      {!compact && <Link title="Ver todas as opções no TMDB" url={title.watchUrl ?? title.resolution?.url} />}
      {/* TOS-REQ-38: crédito à JustWatch em cada exibição de onde assistir */}
      {providers.length > 0 && <Text style={styles.attribution}>{JUSTWATCH_ATTRIBUTION}</Text>}
    </View>
  );
}

/** "★★★½" para uma nota de 0,5 a 5 (meia em meia). */
export function ratingText(v: number): string {
  return '★'.repeat(Math.floor(v)) + (v % 1 ? '½' : '');
}

/** Próxima nota ao tocar na estrela n: cheia → meia → sem nota. */
export function nextRating(current: number | null | undefined, n: number): number | null {
  if (current === n) return n - 0.5;
  if (current === n - 0.5) return null;
  return n;
}

/** Nota de 0,5 a 5 em estrelas. Sem `onChange`, só leitura. */
export function StarRating({
  value,
  onChange,
  size = 30,
  disabled,
}: {
  value?: number | null;
  onChange?: (v: number | null) => void;
  size?: number;
  disabled?: boolean;
}) {
  const v = value ?? 0;
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }} accessibilityLabel={v ? `Nota ${String(v).replace('.', ',')} de 5` : 'Sem nota'}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name: IconName = v >= n ? 'star' : v >= n - 0.5 ? 'star-half' : 'star-outline';
        const icon = <Icon name={name} size={size} color={v >= n - 0.5 ? colors.star : colors.muted} />;
        return onChange ? (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} estrela${n > 1 ? 's' : ''}`}
            disabled={disabled}
            onPress={() => onChange(nextRating(value, n))}
            hitSlop={6}
          >
            {icon}
          </Pressable>
        ) : (
          <View key={n}>{icon}</View>
        );
      })}
    </View>
  );
}

/** Crédito obrigatório onde aparece dado do TMDB (TOS-REQ-01). */
export function TmdbAttribution() {
  return <Text style={styles.attribution}>Dados de filmes e séries: TMDB. {TMDB_ATTRIBUTION}</Text>;
}

function buildStyles() {
  return StyleSheet.create({
    providerLogo: { width: 30, height: 30, borderRadius: 8 },
    providerName: { fontSize: 13, color: colors.text, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    providerGroup: { fontSize: 12, color: colors.muted, minWidth: 70 },
    attribution: { fontSize: 11, color: colors.muted },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
    },
    chipText: { fontSize: 14, fontWeight: '600', color: colors.text2 },
    chipCompact: { minHeight: 30, paddingVertical: 4, paddingHorizontal: 10 },
    chipTextCompact: { fontSize: 12.5 },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBadge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    iconBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primaryText },
    chipHint: { fontSize: 12, color: colors.muted },
    progressTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surface3, overflow: 'hidden' },
    progressFill: { height: 7, borderRadius: 4, backgroundColor: colors.primary },
    poster: { borderRadius: 10 },
    posterEmpty: { backgroundColor: colors.primary3, alignItems: 'center', justifyContent: 'center' },
    posterLetter: { fontSize: 24, fontWeight: '800', color: '#ffffff' },
    buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    buttonCompact: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12 },
    buttonTextCompact: { fontSize: 15 },
    button: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
    buttonGlow: { shadowColor: '#2563eb', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
    buttonText: { fontSize: 16, fontWeight: '700' },
    badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
    badgeText: { fontSize: 12, fontWeight: '700' },
    link: { color: colors.primary2, fontSize: 15, fontWeight: '600' },
  });
}

const styles = buildStyles();
onThemeChange(() => Object.assign(styles, buildStyles()));


import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { POV_OPTIONS, TENSE_OPTIONS } from '@behindthestory/core/onboarding';

import { Eyebrow, useCardStyle, useFieldStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNovelId } from '@/lib/novel-context';
import { useAiStyle } from '@/lib/queries/ai';
import { useNovel, useUpdateNovel } from '@/lib/queries/novels';
import { useUsage } from '@/lib/queries/story';
import type { Novel } from '@/lib/types';

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </View>
  );
}

export default function StoryBible() {
  const novelId = useNovelId();
  const theme = useTheme();
  const field = useFieldStyle();
  const card = useCardStyle();

  const { data: novel = null } = useNovel(novelId);
  const { data: usage = null } = useUsage(novelId);
  const [form, setForm] = useState<Partial<Novel>>({});
  const update = useUpdateNovel(novelId);
  const suggest = useAiStyle();

  // The form is a working copy; it only resets when a different novel loads
  // or a save comes back, never on an unrelated cache refresh.
  useEffect(() => {
    if (novel) setForm(novel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel?.id]);

  const set = (patch: Partial<Novel>) => setForm((f) => ({ ...f, ...patch }));

  function save() {
    update.mutate(
      {
        title: form.title,
        premise: form.premise,
        genre: form.genre ?? undefined,
        tone: form.tone ?? undefined,
        pov: form.pov,
        tense: form.tense,
        targetChapterWords: form.targetChapterWords,
        styleNotes: form.styleNotes ?? undefined,
      },
      {
        onSuccess: (updated) => {
          setForm(updated);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        onError: (error) => Alert.alert('Could not save', error.message),
      },
    );
  }

  function suggestStyle() {
    suggest.mutate(
      { novelId },
      {
        onSuccess: (out) => {
          set(out);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        onError: (error) => Alert.alert('Could not suggest a style', error.message),
      },
    );
  }

  if (!novel) {
    return (
      <ThemedView style={[styles.screen, styles.waiting]}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(novel);

  function Choice<T extends string>({
    options,
    value,
    onChange,
  }: {
    options: readonly { value: T; label: string }[];
    value: T | undefined;
    onChange: (value: T) => void;
  }) {
    return (
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              style={[card, styles.choice, selected && { borderColor: theme.primary, borderWidth: 1 }]}
              onPress={() => onChange(option.value)}>
              <ThemedText type="small" style={selected ? { color: theme.primary } : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const words = form.targetChapterWords ?? 1800;
  const nudgeWords = (direction: 1 | -1) =>
    set({ targetChapterWords: Math.min(20_000, Math.max(200, words + direction * 100)) });

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={24}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText style={styles.heading}>Story Bible</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Everything here is compiled into every AI generation for this novel. Vague settings
              produce vague prose.
            </ThemedText>
          </View>
          <Pressable onPress={save} disabled={update.isPending || !dirty} hitSlop={8}>
            {update.isPending ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <ThemedText
                type="small"
                style={{ color: dirty ? theme.primary : theme.textSecondary, fontWeight: '600' }}>
                {dirty ? 'Save' : 'Saved'}
              </ThemedText>
            )}
          </Pressable>
        </View>

        <Field label="Title">
          <TextInput
            style={field}
            value={form.title ?? ''}
            onChangeText={(title) => set({ title })}
            autoCorrect={false}
          />
        </Field>

        <Field label="Premise">
          <TextInput
            style={[field, styles.premise]}
            value={form.premise ?? ''}
            onChangeText={(premise) => set({ premise })}
            placeholder="The one-paragraph spine of the novel."
            placeholderTextColor={theme.textSecondary}
            multiline
            textAlignVertical="top"
          />
        </Field>

        <View style={[card, styles.section]}>
          <View style={styles.sectionHeader}>
            <View style={styles.headerText}>
              <ThemedText type="smallBold">Style contract</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Binding rules the AI is told never to break.
              </ThemedText>
            </View>
            <Pressable
              onPress={suggestStyle}
              disabled={suggest.isPending}
              hitSlop={8}
              style={styles.suggest}>
              {suggest.isPending ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <SymbolView name="sparkles" size={14} tintColor={theme.primary} />
              )}
              <ThemedText type="small" style={{ color: theme.primary, fontWeight: '500' }}>
                Suggest from premise
              </ThemedText>
            </Pressable>
          </View>

          <Field label="Genre">
            <TextInput
              style={field}
              value={form.genre ?? ''}
              onChangeText={(genre) => set({ genre })}
              placeholder="literary thriller"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
            />
          </Field>

          <Field label="Tone">
            <TextInput
              style={field}
              value={form.tone ?? ''}
              onChangeText={(tone) => set({ tone })}
              placeholder="bleak, wry, slow-burn dread"
              placeholderTextColor={theme.textSecondary}
            />
          </Field>

          <Field label="Point of view">
            <Choice options={POV_OPTIONS} value={form.pov} onChange={(pov) => set({ pov })} />
          </Field>

          <Field label="Tense">
            <Choice options={TENSE_OPTIONS} value={form.tense} onChange={(tense) => set({ tense })} />
          </Field>

          <Field label="Target chapter length">
            <View style={styles.stepper}>
              <Pressable style={[card, styles.stepButton]} onPress={() => nudgeWords(-1)}>
                <SymbolView name="minus" size={16} tintColor={theme.primary} />
              </Pressable>
              <ThemedText style={styles.words}>{words.toLocaleString('en-US')} words</ThemedText>
              <Pressable style={[card, styles.stepButton]} onPress={() => nudgeWords(1)}>
                <SymbolView name="plus" size={16} tintColor={theme.primary} />
              </Pressable>
            </View>
          </Field>

          <Field label="Prose rules">
            <TextInput
              style={[field, styles.notes]}
              value={form.styleNotes ?? ''}
              onChangeText={(styleNotes) => set({ styleNotes })}
              placeholder={'Written as directives, one per line.'}
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
            />
          </Field>
        </View>

        <View style={[card, styles.section]}>
          <View style={styles.headerText}>
            <ThemedText type="smallBold">AI usage</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tokens spent on this novel, by endpoint.
            </ThemedText>
          </View>
          {!usage || usage.totals.calls === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No generations recorded yet.
            </ThemedText>
          ) : (
            <>
              <View style={styles.totals}>
                {(
                  [
                    [String(usage.totals.calls), 'calls'],
                    [compact(usage.totals.inputTokens), 'input tokens'],
                    [compact(usage.totals.outputTokens), 'output tokens'],
                  ] as const
                ).map(([value, label]) => (
                  <View key={label}>
                    <ThemedText style={styles.total}>{value}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {label}
                    </ThemedText>
                  </View>
                ))}
              </View>
              <View style={[styles.routes, { borderTopColor: theme.border }]}>
                {usage.byRoute.map((r) => (
                  <View key={r.route} style={styles.routeRow}>
                    <ThemedText type="small" style={styles.route}>
                      {r.route}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
                      {r.calls} × · {compact(r.inputTokens)} in · {compact(r.outputTokens)} out
                    </ThemedText>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </KeyboardAwareScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  waiting: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: Spacing.four, gap: Spacing.four, paddingBottom: 96 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flex: 1, gap: 4 },
  heading: { fontFamily: Fonts.serif, fontSize: 24, lineHeight: 30, fontWeight: '600' },
  group: { gap: Spacing.two },
  premise: { minHeight: 120, lineHeight: 22 },
  section: { padding: Spacing.three, gap: Spacing.three },
  sectionHeader: { gap: Spacing.two },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: { paddingHorizontal: Spacing.three, paddingVertical: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepButton: { padding: Spacing.two + 2, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'], fontWeight: '600' },
  notes: { minHeight: 140, lineHeight: 22 },
  totals: { flexDirection: 'row', gap: Spacing.four },
  total: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  routes: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: 6 },
  routeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  route: { fontWeight: '500', flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});

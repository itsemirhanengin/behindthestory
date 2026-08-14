import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SymbolView } from 'expo-symbols';

import {
  CHAPTER_WORDS,
  POV_OPTIONS,
  TENSE_OPTIONS,
  readingMinutes,
} from '@behindthestory/core/onboarding';

import { Eyebrow, PrimaryButton, StepHeader, useCardStyle, useFieldStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWizard } from '@/lib/new-novel-wizard';

function Field({
  label,
  rationale,
  children,
}: {
  label: string;
  rationale?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.group}>
      <Eyebrow>{label}</Eyebrow>
      {children}
      {rationale ? (
        <ThemedText type="small" themeColor="textSecondary">
          {rationale}
        </ThemedText>
      ) : null}
    </View>
  );
}

export default function StyleStep() {
  const router = useRouter();
  const theme = useTheme();
  const field = useFieldStyle();
  const card = useCardStyle();
  const wizard = useWizard();

  const { style, styleProposal, styleBusy, styleError, styleStale, reading } = wizard;

  // Kicks off on arrival, exactly like the reading. A failed call waits for
  // the retry button rather than retrying itself on every render.
  useEffect(() => {
    if (reading && !style && !styleError && !styleBusy) {
      void wizard.runStyle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nudgeWords(direction: 1 | -1) {
    if (!style) return;
    const next = style.targetChapterWords + direction * CHAPTER_WORDS.step;
    wizard.patchStyle({
      targetChapterWords: Math.min(CHAPTER_WORDS.max, Math.max(CHAPTER_WORDS.min, next)),
    });
  }

  function Choice<T extends string>({
    options,
    value,
    onChange,
  }: {
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
  }) {
    return (
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              style={[
                card,
                styles.choice,
                selected && { borderColor: theme.primary, borderWidth: 1 },
              ]}
              onPress={() => onChange(option.value)}>
              <ThemedText type="small" style={selected ? { color: theme.primary } : undefined}>
                {option.label}
              </ThemedText>
              {selected ? (
                <SymbolView name="checkmark" size={12} tintColor={theme.primary} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={24}>
        <Eyebrow>Step 3 of 4</Eyebrow>
        <StepHeader
          heading="How it should be written"
          subheading="Derived from your premise. These become binding rules on every generation, so change anything that is not you."
        />

        {!style && styleBusy ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Deriving house style…
            </ThemedText>
          </View>
        ) : !style && styleError ? (
          <View style={styles.group}>
            <ThemedText style={{ color: theme.destructive }}>{styleError}</ThemedText>
            <PrimaryButton label="Try again" onPress={() => void wizard.runStyle()} />
          </View>
        ) : style ? (
          <>
            {styleStale ? (
              <View style={[card, styles.stale, { borderColor: theme.primary }]}>
                <ThemedText type="small">
                  The reading changed after this style was derived from it.
                </ThemedText>
                <Pressable onPress={() => void wizard.runStyle()} disabled={styleBusy} hitSlop={8}>
                  <ThemedText type="small" style={{ color: theme.primary, fontWeight: '500' }}>
                    {styleBusy ? 'Re-deriving…' : 'Re-derive from the corrected reading'}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            <Field label="Genre" rationale={styleProposal?.rationale.genre}>
              <TextInput
                style={field}
                value={style.genre ?? ''}
                onChangeText={(genre) => wizard.patchStyle({ genre })}
                autoCorrect={false}
              />
            </Field>

            <Field label="Tone" rationale={styleProposal?.rationale.tone}>
              <TextInput
                style={field}
                value={style.tone ?? ''}
                onChangeText={(tone) => wizard.patchStyle({ tone })}
              />
            </Field>

            <Field label="Narration" rationale={styleProposal?.rationale.narration}>
              <Choice
                options={POV_OPTIONS}
                value={style.pov}
                onChange={(pov) => wizard.patchStyle({ pov })}
              />
              <Choice
                options={TENSE_OPTIONS}
                value={style.tense}
                onChange={(tense) => wizard.patchStyle({ tense })}
              />
            </Field>

            <Field label="Chapter length" rationale={styleProposal?.rationale.length}>
              <View style={styles.stepper}>
                <Pressable
                  style={[card, styles.stepButton]}
                  onPress={() => nudgeWords(-1)}
                  disabled={style.targetChapterWords <= CHAPTER_WORDS.min}>
                  <SymbolView name="minus" size={16} tintColor={theme.primary} />
                </Pressable>
                <View style={styles.stepValue}>
                  <ThemedText style={styles.words}>
                    {style.targetChapterWords.toLocaleString('en-US')} words
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    ≈ {readingMinutes(style.targetChapterWords)} min read
                  </ThemedText>
                </View>
                <Pressable
                  style={[card, styles.stepButton]}
                  onPress={() => nudgeWords(1)}
                  disabled={style.targetChapterWords >= CHAPTER_WORDS.max}>
                  <SymbolView name="plus" size={16} tintColor={theme.primary} />
                </Pressable>
              </View>
            </Field>

            <Field label="Style notes" rationale={styleProposal?.rationale.styleNotes}>
              <TextInput
                style={[field, styles.notes]}
                value={style.styleNotes ?? ''}
                onChangeText={(styleNotes) => wizard.patchStyle({ styleNotes })}
                multiline
                textAlignVertical="top"
              />
            </Field>

            <ThemedText type="small" themeColor="textSecondary">
              All of it stays editable later.
            </ThemedText>

            <PrimaryButton label="Continue" onPress={() => router.push('/new-novel/review')} />
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.four, gap: Spacing.four },
  group: { gap: Spacing.two },
  waiting: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  stale: { padding: Spacing.three, gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepButton: { padding: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  stepValue: { flex: 1, alignItems: 'center', gap: 2 },
  words: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  notes: { minHeight: 160, lineHeight: 22 },
});

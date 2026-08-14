import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { Eyebrow, PrimaryButton, StepHeader, useCardStyle, useFieldStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWizard } from '@/lib/new-novel-wizard';

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Eyebrow>{label}</Eyebrow>
      {typeof children === 'string' ? <ThemedText>{children}</ThemedText> : children}
    </View>
  );
}

export default function AlignmentStep() {
  const router = useRouter();
  const theme = useTheme();
  const field = useFieldStyle();
  const card = useCardStyle();
  const wizard = useWizard();
  const [correction, setCorrection] = useState('');

  const { reading, readingBusy, readingError, turns } = wizard;

  // The reading kicks off on arrival — pressing a button to start the only
  // thing this step does is friction. A failed call does NOT retry itself;
  // the retry button hands that back to the author.
  useEffect(() => {
    if (!reading && !readingError && !readingBusy) {
      void wizard.runReading([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastNote = turns.length ? turns[turns.length - 1].changeNote : '';

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={24}>
        <Eyebrow>Step 2 of 4</Eyebrow>
        <StepHeader
          heading="Did it understand you?"
          subheading="This is what the AI thinks your book is. Correct it until it is right — every chapter it ever writes is generated against this reading."
        />

        {!reading && readingBusy ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              Reading your premise…
            </ThemedText>
          </View>
        ) : !reading && readingError ? (
          <View style={styles.group}>
            <ThemedText style={{ color: theme.destructive }}>{readingError}</ThemedText>
            <PrimaryButton
              label="Try again"
              onPress={() => void wizard.runReading(turns.map((t) => t.correction))}
            />
          </View>
        ) : reading ? (
          <>
            <Section label="Title">
              <TextInput
                style={field}
                value={wizard.title}
                onChangeText={(value) => wizard.setTitle(value)}
                autoCorrect={false}
              />
              {wizard.titleFromAi ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Named by the AI — keep it or write your own.
                </ThemedText>
              ) : null}
              <View style={styles.chips}>
                {reading.titleSuggestions
                  .filter((s) => s !== wizard.title)
                  .map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      style={[card, styles.chip]}
                      onPress={() => wizard.setTitle(suggestion, true)}>
                      <ThemedText type="small">{suggestion}</ThemedText>
                    </Pressable>
                  ))}
              </View>
            </Section>

            {lastNote ? (
              <View style={[card, styles.note, { borderColor: theme.primary }]}>
                <Eyebrow>What changed</Eyebrow>
                <ThemedText type="small">{lastNote}</ThemedText>
              </View>
            ) : null}

            <Section label="Logline">{reading.logline}</Section>
            <Section label="Premise">{reading.premise}</Section>
            <Section label="Protagonist">{reading.protagonist}</Section>
            <Section label="Conflict">{reading.conflict}</Section>
            <Section label="World">{reading.world}</Section>
            <Section label="Stakes">{reading.stakes}</Section>

            <Section label="Themes">
              <View style={styles.chips}>
                {reading.themes.map((theme_) => (
                  <View key={theme_} style={[card, styles.chip]}>
                    <ThemedText type="small">{theme_}</ThemedText>
                  </View>
                ))}
              </View>
            </Section>

            <Section label="What it assumed — audit this">
              {reading.assumptions.map((assumption) => (
                <ThemedText key={assumption} type="small">
                  · {assumption}
                </ThemedText>
              ))}
            </Section>

            {reading.questions.length ? (
              <Section label="Open questions">
                {reading.questions.map((question) => (
                  <ThemedText key={question} type="small" themeColor="textSecondary">
                    · {question}
                  </ThemedText>
                ))}
              </Section>
            ) : null}

            <Section label="Correct the reading">
              <TextInput
                style={[field, styles.correction]}
                value={correction}
                onChangeText={setCorrection}
                placeholder="“The sister is the narrator, not the detective…”"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
              />
              <Pressable
                onPress={() => {
                  const text = correction.trim();
                  if (!text) return;
                  setCorrection('');
                  void wizard.refine(text);
                }}
                disabled={readingBusy || !correction.trim()}
                hitSlop={8}>
                <ThemedText
                  type="small"
                  style={{
                    color: readingBusy || !correction.trim() ? theme.textSecondary : theme.primary,
                    fontWeight: '500',
                  }}>
                  {readingBusy ? 'Re-reading…' : 'Send correction'}
                </ThemedText>
              </Pressable>
            </Section>

            <PrimaryButton
              label="Continue"
              disabled={!wizard.title.trim() || readingBusy}
              onPress={() => router.push('/new-novel/style')}
            />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.two + 2, paddingVertical: 6 },
  note: { padding: Spacing.three, gap: Spacing.one },
  correction: { minHeight: 90, lineHeight: 22 },
});

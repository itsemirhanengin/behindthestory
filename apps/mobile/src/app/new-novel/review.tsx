import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { povLabel, readingMinutes, tenseLabel } from '@behindthestory/core/onboarding';

import { Eyebrow, PrimaryButton, StepHeader, useCardStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useWizard } from '@/lib/new-novel-wizard';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Eyebrow>{label}</Eyebrow>
      <ThemedText type="small" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function ReviewStep() {
  const router = useRouter();
  const card = useCardStyle();
  const wizard = useWizard();
  const { reading, style } = wizard;

  if (!reading || !style) return null;

  async function create() {
    try {
      await wizard.create();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The list under the sheet has already been told to refetch; closing
      // the sheet lands the author on it with the new novel at the top.
      router.dismiss();
    } catch (e) {
      Alert.alert('Could not create the novel', (e as Error).message);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic">
        <Eyebrow>Step 4 of 4</Eyebrow>
        <StepHeader
          heading="Everything in one place"
          subheading="Exactly what will be created. Every word of it stays editable in the Story Bible afterwards."
        />

        <View style={[card, styles.titlePage]}>
          <ThemedText style={styles.title}>{wizard.title.trim()}</ThemedText>
          {wizard.titleFromAi ? <Eyebrow>Named by the AI</Eyebrow> : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.dinkus}>
            · · ·
          </ThemedText>
          <ThemedText type="small">{reading.premise}</ThemedText>
        </View>

        <View style={[card, styles.contract]}>
          <Row label="Genre" value={style.genre || '—'} />
          <Row label="Tone" value={style.tone || '—'} />
          <Row label="Narration" value={`${povLabel(style.pov)}, ${tenseLabel(style.tense)}`} />
          <Row
            label="Chapter length"
            value={`${style.targetChapterWords.toLocaleString('en-US')} words · ≈ ${readingMinutes(style.targetChapterWords)} min`}
          />
          <View style={styles.rowLast}>
            <Eyebrow>Style notes</Eyebrow>
            <ThemedText type="small">{style.styleNotes || '—'}</ThemedText>
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Nothing has been saved yet.
        </ThemedText>

        <PrimaryButton label="Create novel" busy={wizard.creating} onPress={() => void create()} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.four, gap: Spacing.four },
  titlePage: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600',
    textAlign: 'center',
  },
  dinkus: { letterSpacing: 6, marginVertical: Spacing.one },
  contract: { padding: Spacing.four, gap: Spacing.three },
  row: { gap: 4 },
  rowLast: { gap: 4 },
  rowValue: { fontWeight: '500' },
  hint: { textAlign: 'center' },
});

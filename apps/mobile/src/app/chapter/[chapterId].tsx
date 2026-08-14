import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Eyebrow, PrimaryButton, useCardStyle } from '@/components/editorial';
import { Manuscript } from '@/components/manuscript';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEntity } from '@/lib/queries/entities';
import type { Chapter } from '@/lib/types';

/**
 * The writing studio's chapter, in view-only form for now: the plan the
 * prose was written against (summary, outline, beats), then the manuscript
 * itself. Editing arrives in a later pass — the segmentation model and the
 * offline store land together with it.
 */
export default function ChapterScreen() {
  const { chapterId } = useLocalSearchParams<{ chapterId: string }>();
  const theme = useTheme();
  const card = useCardStyle();
  const { data: chapter, error, refetch } = useEntity<Chapter>('chapters', chapterId);

  const hasPlan = Boolean(
    chapter && (chapter.summary.trim() || chapter.outline.trim() || chapter.beats.length),
  );

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: chapter ? `Chapter ${chapter.number}` : '' }} />
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        {error ? (
          <View style={styles.waiting}>
            <ThemedText style={{ color: theme.destructive, textAlign: 'center' }}>
              {error.message}
            </ThemedText>
            <PrimaryButton label="Try again" onPress={() => void refetch()} />
          </View>
        ) : !chapter ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : (
          <>
            <Eyebrow>{`Chapter ${chapter.number}${chapter.status === 'draft' ? ' · draft' : ''}`}</Eyebrow>
            <ThemedText style={styles.title}>{chapter.title}</ThemedText>

            {hasPlan ? (
              <View style={[card, styles.plan]}>
                {chapter.summary.trim() ? (
                  <View style={styles.planBlock}>
                    <Eyebrow>Summary</Eyebrow>
                    <ThemedText type="small">{chapter.summary}</ThemedText>
                  </View>
                ) : null}
                {chapter.outline.trim() ? (
                  <View style={styles.planBlock}>
                    <Eyebrow>Outline</Eyebrow>
                    <ThemedText type="small">{chapter.outline}</ThemedText>
                  </View>
                ) : null}
                {chapter.beats.length ? (
                  <View style={styles.planBlock}>
                    <Eyebrow>Beats</Eyebrow>
                    {chapter.beats.map((beat) => (
                      <View key={beat.id} style={styles.beat}>
                        <SymbolView
                          name={beat.done ? 'checkmark.square' : 'square'}
                          size={14}
                          tintColor={beat.done ? theme.primary : theme.textSecondary}
                        />
                        <ThemedText type="small" style={styles.beatText}>
                          {beat.text}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}
                {!chapter.continuesFromPrevious ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Opens on a break — a time jump, a POV switch or a flashback.
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <ThemedText type="small" themeColor="textSecondary" style={styles.dinkus}>
              · · ·
            </ThemedText>

            <Manuscript markdown={chapter.content} />
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.four, paddingBottom: 96, gap: Spacing.two },
  waiting: { paddingVertical: Spacing.six, alignItems: 'center', gap: Spacing.three },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  plan: { padding: Spacing.three, gap: Spacing.three, marginTop: Spacing.two },
  planBlock: { gap: Spacing.one },
  beat: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  beatText: { flex: 1 },
  dinkus: { letterSpacing: 6, textAlign: 'center', marginVertical: Spacing.two },
});

import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { Eyebrow, PrimaryButton, useCardStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEntity } from '@/lib/queries/entities';
import type { Character } from '@/lib/types';

const ROLE_LABEL = { main: 'Main character', side: 'Side character', minor: 'Minor character' } as const;

function Section({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <View style={styles.group}>
      <Eyebrow>{label}</Eyebrow>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

/** A character's sheet, view-only for now — the studio's node card as a page. */
export default function CharacterScreen() {
  const { characterId } = useLocalSearchParams<{ characterId: string }>();
  const theme = useTheme();
  const card = useCardStyle();
  const { data: character, error, refetch } = useEntity<Character>('characters', characterId);

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: character?.name ?? '' }} />
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        {error ? (
          <View style={styles.waiting}>
            <ThemedText style={{ color: theme.destructive, textAlign: 'center' }}>
              {error.message}
            </ThemedText>
            <PrimaryButton label="Try again" onPress={() => void refetch()} />
          </View>
        ) : !character ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <View style={[styles.dot, { backgroundColor: character.color }]} />
              <View style={styles.headerText}>
                <ThemedText style={styles.name}>{character.name}</ThemedText>
                <Eyebrow>{ROLE_LABEL[character.role]}</Eyebrow>
              </View>
            </View>

            <Section label="Summary" text={character.summary} />

            {character.traits.length ? (
              <View style={styles.group}>
                <Eyebrow>Traits</Eyebrow>
                <View style={styles.chips}>
                  {character.traits.map((trait) => (
                    <View key={trait} style={[card as ViewStyle, styles.chip]}>
                      <ThemedText type="small">{trait}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <Section label="Appearance" text={character.appearance} />
            <Section label="Motivation — what they want right now" text={character.motivation} />
            <Section label="Arc — where they are headed" text={character.arc} />
            <Section label="Backstory" text={character.backstory} />
            <Section label="Secrets" text={character.secrets} />

            {character.voice.trim() || character.speechSample.trim() ? (
              <View style={[card, styles.voice]}>
                <Section label="Voice" text={character.voice} />
                {character.speechSample.trim() ? (
                  <View style={styles.group}>
                    <Eyebrow>In their own words</Eyebrow>
                    <ThemedText type="small" style={styles.speech}>
                      {character.speechSample}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.four, gap: Spacing.four, paddingBottom: 96 },
  waiting: { paddingVertical: Spacing.six, alignItems: 'center', gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerText: { gap: 4, flex: 1 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  name: { fontFamily: Fonts.serif, fontSize: 26, lineHeight: 32, fontWeight: '600' },
  group: { gap: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.two + 2, paddingVertical: 6 },
  voice: { padding: Spacing.three, gap: Spacing.three },
  speech: { fontFamily: Fonts.serif, fontStyle: 'italic' },
});

import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { useCardStyle } from '@/components/editorial';
import { Eyebrow } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useNovelId } from '@/lib/novel-context';
import { useEntityList } from '@/lib/queries/entities';
import type { Character } from '@/lib/types';

const ROLES = [
  { role: 'main', label: 'Main characters' },
  { role: 'side', label: 'Side characters' },
  { role: 'minor', label: 'Minor characters' },
] as const;

/**
 * The cast as a sectioned list. The studio draws this as a relationship
 * graph; that visual is a Skia rewrite of its own and comes later — the list
 * is not a placeholder for it but the phone's own reading of the same data.
 */
export default function CharactersScreen() {
  const novelId = useNovelId();
  const router = useRouter();
  const card = useCardStyle();
  const { data: characters, error, refetch, isRefetching } = useEntityList<Character>(novelId, 'characters');

  const sections = ROLES.map(({ role, label }) => ({
    title: label,
    data: (characters ?? [])
      .filter((character) => character.role === role)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((section) => section.data.length > 0);

  return (
    <ThemedView style={styles.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(character) => character.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListEmptyComponent={
          <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {error ? error.message : !characters ? 'Loading…' : 'No characters yet.'}
            </ThemedText>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Eyebrow>{section.title}</Eyebrow>
          </View>
        )}
        renderItem={({ item: character }) => (
          <Pressable
            style={({ pressed }) => [card, styles.row, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/character/${character.id}`)}>
            <View style={[styles.dot, { backgroundColor: character.color }]} />
            <View style={styles.rowText}>
              <ThemedText style={styles.name}>{character.name}</ThemedText>
              {character.summary.trim() ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {character.summary}
                </ThemedText>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: 96 },
  sectionHeader: { marginTop: Spacing.two, marginBottom: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.serif, fontSize: 17, fontWeight: '600' },
  empty: { padding: Spacing.five },
  centered: { textAlign: 'center' },
});

import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { useCardStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useNovelId } from '@/lib/novel-context';
import { useEntityList } from '@/lib/queries/entities';
import type { Chapter } from '@/lib/types';

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * The manuscript spine from the studio sidebar, as its own tab: only the
 * active variant of each slot, in reading order. Tapping a chapter opens it —
 * reading for now, the writing studio when it lands.
 */
export default function ChaptersScreen() {
  const novelId = useNovelId();
  const router = useRouter();
  const card = useCardStyle();
  const { data: allChapters, error, refetch, isRefetching } = useEntityList<Chapter>(novelId, 'chapters');

  const chapters = (allChapters ?? [])
    .filter((chapter) => chapter.isActive)
    .sort((a, b) => a.number - b.number);

  return (
    <ThemedView style={styles.screen}>
      <FlatList
        data={chapters}
        keyExtractor={(chapter) => chapter.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListEmptyComponent={
          <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {error ? error.message : !allChapters ? 'Loading…' : 'No chapters yet.'}
            </ThemedText>
          </View>
        }
        renderItem={({ item: chapter }) => (
          <Pressable
            style={({ pressed }) => [card, styles.row, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/chapter/${chapter.id}`)}>
            <ThemedText themeColor="textSecondary" style={styles.number}>
              {chapter.number}
            </ThemedText>
            <View style={styles.rowText}>
              <ThemedText style={styles.title} numberOfLines={1}>
                {chapter.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
                {words(chapter.content).toLocaleString('en-US')} words
              </ThemedText>
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
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  number: { fontVariant: ['tabular-nums'], minWidth: 20 },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: Fonts.serif, fontSize: 17, fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
  empty: { padding: Spacing.five },
  centered: { textAlign: 'center' },
});

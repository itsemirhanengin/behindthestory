import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Eyebrow, useCardStyle } from '@/components/editorial';
import { Manuscript } from '@/components/manuscript';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNovelId } from '@/lib/novel-context';
import { useEntityList } from '@/lib/queries/entities';
import { useNovel } from '@/lib/queries/novels';
import type { Chapter } from '@/lib/types';

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * The manuscript read straight through — the studio's reading view. One
 * chapter per list row keeps a long novel from being laid out all at once.
 */
export default function ReadScreen() {
  const novelId = useNovelId();
  const theme = useTheme();
  const card = useCardStyle();
  const { data: novel } = useNovel(novelId);
  const { data: allChapters, error, refetch, isRefetching } = useEntityList<Chapter>(novelId, 'chapters');

  // Only the active take of each slot is part of the manuscript, and only
  // written chapters belong in the reading flow.
  const written = (allChapters ?? [])
    .filter((chapter) => chapter.isActive && chapter.content.trim())
    .sort((a, b) => a.number - b.number);
  const totalWords = written.reduce((sum, chapter) => sum + words(chapter.content), 0);

  return (
    <ThemedView style={styles.screen}>
      <FlatList
        data={written}
        keyExtractor={(chapter) => chapter.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListHeaderComponent={
          novel ? (
            <View style={[styles.titlePage, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.novelTitle}>{novel.title}</ThemedText>
              {novel.premise.trim() ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  {novel.premise}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {written.length} chapter{written.length === 1 ? '' : 's'} ·{' '}
                {totalWords.toLocaleString('en-US')} words
              </ThemedText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {error ? error.message : !allChapters ? 'Loading…' : 'Nothing written yet.'}
            </ThemedText>
          </View>
        }
        renderItem={({ item: chapter }) => (
          <View style={styles.chapter}>
            <View style={styles.chapterHeader}>
              <Eyebrow>{`Chapter ${chapter.number}${chapter.status === 'draft' ? ' · draft' : ''}`}</Eyebrow>
              <ThemedText style={styles.chapterTitle}>{chapter.title}</ThemedText>
            </View>
            <Manuscript markdown={chapter.content} />
          </View>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: Spacing.four, paddingBottom: 96 },
  titlePage: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    marginBottom: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  novelTitle: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  centered: { textAlign: 'center' },
  chapter: { marginBottom: Spacing.six, gap: Spacing.two },
  chapterHeader: { alignItems: 'center', gap: 4, marginBottom: Spacing.two },
  chapterTitle: {
    fontFamily: Fonts.serif,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    textAlign: 'center',
  },
  empty: { padding: Spacing.five },
});

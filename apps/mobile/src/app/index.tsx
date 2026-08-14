import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { Eyebrow, PrimaryButton, useCardStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDeleteNovel, useNovels, type Novel } from '@/lib/queries/novels';

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The studio home, spoken iOS: the header's wordmark becomes the native
 * large title, "New Novel" moves into the navigation bar, and the hover-only
 * delete button becomes a long-press — the phone's word for hover.
 */
export default function NovelsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const card = useCardStyle();
  const { data: novels, error, refetch, isRefetching } = useNovels();
  const remove = useDeleteNovel();

  function confirmDelete(novel: Novel) {
    const destroy = () =>
      remove.mutate(novel.id, {
        onError: (cause) => Alert.alert('Could not delete', cause.message),
      });

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: novel.title,
          options: ['Cancel', 'Delete novel'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        (index) => {
          if (index === 1) destroy();
        },
      );
    } else {
      Alert.alert('Delete novel?', novel.title, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: destroy },
      ]);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/new-novel')}
              hitSlop={12}
              accessibilityLabel="New novel">
              <SymbolView name="plus" size={20} tintColor={theme.primary} />
            </Pressable>
          ),
        }}
      />

      <FlatList
        data={novels ?? []}
        keyExtractor={(novel) => novel.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        ListEmptyComponent={
          error ? (
            <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
              <ThemedText themeColor="textSecondary" style={styles.centered}>
                {error.message}
              </ThemedText>
              <PrimaryButton label="Try again" onPress={() => void refetch()} />
            </View>
          ) : !novels ? null : (
            <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
              <ThemedText themeColor="textSecondary" style={styles.centered}>
                No novels yet. The first step is describing one — the AI takes it from there.
              </ThemedText>
              <PrimaryButton
                label="Start your first novel"
                onPress={() => router.push('/new-novel')}
              />
            </View>
          )
        }
        renderItem={({ item: novel }) => (
          <Pressable
            style={({ pressed }) => [card, styles.card, pressed && { opacity: 0.85 }]}
            // TODO(phase 04): push the novel's own screens once they exist.
            onLongPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              confirmDelete(novel);
            }}>
            <ThemedText style={styles.title}>{novel.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
              {novel.premise || 'No premise yet.'}
            </ThemedText>
            <Eyebrow>{formatDate(novel.createdAt)}</Eyebrow>
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.three },
  card: { padding: Spacing.three, gap: Spacing.two },
  title: { fontFamily: Fonts.serif, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  empty: { padding: Spacing.five, gap: Spacing.four, alignItems: 'stretch' },
  centered: { textAlign: 'center' },
});

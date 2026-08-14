import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { useCardStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useNovelId } from '@/lib/novel-context';
import { useEntityList } from '@/lib/queries/entities';
import type { Location } from '@/lib/types';

/** The world's places. The map view is Skia work for later; see characters. */
export default function LocationsScreen() {
  const novelId = useNovelId();
  const router = useRouter();
  const card = useCardStyle();
  const { data: locations, error, refetch, isRefetching } = useEntityList<Location>(novelId, 'locations');

  const sorted = (locations ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ThemedView style={styles.screen}>
      <FlatList
        data={sorted}
        keyExtractor={(location) => location.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListEmptyComponent={
          <View style={[card, styles.empty, { borderStyle: 'dashed' }]}>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {error ? error.message : !locations ? 'Loading…' : 'No locations yet.'}
            </ThemedText>
          </View>
        }
        renderItem={({ item: location }) => (
          <Pressable
            style={({ pressed }) => [card, styles.row, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/location/${location.id}`)}>
            <ThemedText style={styles.name}>{location.name}</ThemedText>
            {location.description.trim() ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {location.description}
              </ThemedText>
            ) : null}
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: 96 },
  row: { padding: Spacing.three, gap: 2 },
  name: { fontFamily: Fonts.serif, fontSize: 17, fontWeight: '600' },
  empty: { padding: Spacing.five },
  centered: { textAlign: 'center' },
});

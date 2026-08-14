import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Eyebrow, PrimaryButton } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useEntity } from '@/lib/queries/entities';
import type { Location } from '@/lib/types';

function Section({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <View style={styles.group}>
      <Eyebrow>{label}</Eyebrow>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

/** A place's sheet, view-only for now. */
export default function LocationScreen() {
  const { locationId } = useLocalSearchParams<{ locationId: string }>();
  const theme = useTheme();
  const { data: location, error, refetch } = useEntity<Location>('locations', locationId);

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: location?.name ?? '' }} />
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        {error ? (
          <View style={styles.waiting}>
            <ThemedText style={{ color: theme.destructive, textAlign: 'center' }}>
              {error.message}
            </ThemedText>
            <PrimaryButton label="Try again" onPress={() => void refetch()} />
          </View>
        ) : !location ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : (
          <>
            <ThemedText style={styles.name}>{location.name}</ThemedText>
            <Section label="Description" text={location.description} />
            <Section label="Atmosphere" text={location.atmosphere} />
            <Section label="Significance" text={location.significance} />
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
  name: { fontFamily: Fonts.serif, fontSize: 26, lineHeight: 32, fontWeight: '600' },
  group: { gap: Spacing.one },
});

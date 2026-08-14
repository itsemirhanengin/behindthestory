import { Stack, useLocalSearchParams } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { NovelIdProvider } from '@/lib/novel-context';
import { useNovel } from '@/lib/queries/novels';

/**
 * The studio's per-novel sidebar, restated as a native tab bar. The pushed
 * stack header above carries the novel's title (the sidebar's masthead), and
 * the sections become tabs. Story Map and the graphs are Skia work of their
 * own and join later; the writing screen pushes from Chapters rather than
 * being a tab, mirroring how the sidebar treats the spine.
 */
export default function NovelTabs() {
  const { novelId } = useLocalSearchParams<{ novelId: string }>();
  const { data: novel } = useNovel(novelId);
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NovelIdProvider novelId={novelId}>
      <Stack.Screen options={{ title: novel?.title ?? '' }} />
      <NativeTabs
        backgroundColor={colors.background}
        indicatorColor={colors.backgroundElement}
        tintColor={colors.primary}
        labelStyle={{ selected: { color: colors.primary } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Bible</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="book.closed" />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="chapters">
          <NativeTabs.Trigger.Label>Chapters</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="list.number" />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="characters">
          <NativeTabs.Trigger.Label>Cast</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="person.2" />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="locations">
          <NativeTabs.Trigger.Label>Places</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="mappin.and.ellipse" />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="read">
          <NativeTabs.Trigger.Label>Read</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="book" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </NovelIdProvider>
  );
}

import { Stack, useRouter } from 'expo-router';
import { Alert, Pressable } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { useTheme } from '@/hooks/use-theme';
import { WizardProvider, useWizard } from '@/lib/new-novel-wizard';

/**
 * Studio's exit dialog, restated for a sheet: the X asks before discarding a
 * premise the author has started, because nothing is saved until the last
 * step. Swiping the sheet down skips the question — that gesture is iOS's
 * own and fighting it would feel worse than the risk it carries.
 */
function CancelButton() {
  const router = useRouter();
  const { dirty } = useWizard();

  function close() {
    if (!dirty) return router.dismiss();
    Alert.alert(
      'Leave without creating?',
      'Nothing has been saved yet, so this premise and everything the AI worked out from it will be lost.',
      [
        { text: 'Keep working', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.dismiss() },
      ],
    );
  }

  return (
    <Pressable onPress={close} hitSlop={12} accessibilityLabel="Leave the wizard">
      <XMark />
    </Pressable>
  );
}

function XMark() {
  const theme = useTheme();
  return <SymbolView name="xmark" size={17} tintColor={theme.textSecondary} />;
}

export default function NewNovelLayout() {
  return (
    <WizardProvider>
      <Stack
        screenOptions={{
          headerRight: () => <CancelButton />,
        }}>
        <Stack.Screen name="index" options={{ title: 'Premise' }} />
        <Stack.Screen name="alignment" options={{ title: 'Alignment' }} />
        <Stack.Screen name="style" options={{ title: 'House style' }} />
        <Stack.Screen name="review" options={{ title: 'Title page' }} />
      </Stack>
    </WizardProvider>
  );
}

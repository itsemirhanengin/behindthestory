import { useRouter } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { MIN_DESCRIPTION_WORDS, countWords } from '@behindthestory/core/onboarding';

import { Eyebrow, PrimaryButton, StepHeader, useFieldStyle } from '@/components/editorial';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWizard } from '@/lib/new-novel-wizard';

export default function PremiseStep() {
  const router = useRouter();
  const theme = useTheme();
  const field = useFieldStyle();
  const wizard = useWizard();

  const words = countWords(wizard.description);
  const ready = words >= MIN_DESCRIPTION_WORDS;

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        contentInsetAdjustmentBehavior="automatic"
        bottomOffset={24}>
        <Eyebrow>Step 1 of 4</Eyebrow>
        <StepHeader
          heading="What is this novel?"
          subheading="Write it the way you would tell a friend over a long dinner. None of it has to be final — it only has to be true."
        />

        <View style={styles.group}>
          <Eyebrow>Working title — optional</Eyebrow>
          <TextInput
            style={field}
            value={wizard.title}
            onChangeText={(value) => wizard.setTitle(value)}
            placeholder="Untitled for now is fine"
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
          />
        </View>

        <View style={styles.group}>
          <Eyebrow>The novel, in your words</Eyebrow>
          <TextInput
            style={[field, styles.description]}
            value={wizard.description}
            onChangeText={wizard.setDescription}
            placeholder="The place, the person, the trouble they are in, why it matters…"
            placeholderTextColor={theme.textSecondary}
            multiline
            textAlignVertical="top"
          />
          <ThemedText type="small" themeColor="textSecondary">
            {ready
              ? 'The AI reads this next.'
              : `${MIN_DESCRIPTION_WORDS - words} more words and the AI has something to work with.`}
          </ThemedText>
        </View>

        <PrimaryButton
          label="Continue"
          disabled={!ready}
          onPress={() => router.push('/new-novel/alignment')}
        />
      </KeyboardAwareScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: Spacing.four, gap: Spacing.four },
  group: { gap: Spacing.two },
  description: { minHeight: 220, lineHeight: 24 },
});

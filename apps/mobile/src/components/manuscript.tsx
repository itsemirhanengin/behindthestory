import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';

/**
 * Manuscript prose, set the way the studio's reading view sets it: serif at
 * 1.8 leading, continuation paragraphs opening with an em-space indent
 * (React Native has no first-line indent), and horizontal rules rendered as
 * the house dinkus. Content is Markdown, but manuscript prose is
 * overwhelmingly plain paragraphs — the block-faithful renderer arrives with
 * the writing studio, where the segmentation model lives anyway.
 */
export function Manuscript({ markdown }: { markdown: string }) {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return <ThemedText themeColor="textSecondary">Nothing written yet.</ThemedText>;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) =>
        /^(-{3,}|\*{3,}|_{3,})$/.test(paragraph) ? (
          <ThemedText key={index} type="small" themeColor="textSecondary" style={styles.dinkus}>
            · · ·
          </ThemedText>
        ) : (
          <ThemedText key={index} style={styles.prose}>
            {index > 0 ? ' ' : ''}
            {paragraph}
          </ThemedText>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dinkus: { letterSpacing: 6, textAlign: 'center', marginVertical: Spacing.two },
  prose: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 30 },
});

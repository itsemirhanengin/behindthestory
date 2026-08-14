import { ActivityIndicator, Pressable, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The studio's editorial primitives, restated for React Native: the
 * small-caps eyebrow, the serif step heading, the square filled button and
 * the hairline field. Every wizard screen and the novels list speak through
 * these so the three house rules (no radius, no shadow, warm ink) are
 * enforced in one file rather than per screen.
 */

/** `.label-caps` — the small-caps label used for eyebrows and field names. */
export function Eyebrow({ children }: { children: string }) {
  return (
    <ThemedText themeColor="textSecondary" style={styles.eyebrow}>
      {children}
    </ThemedText>
  );
}

export function StepHeader({ heading, subheading }: { heading: string; subheading: string }) {
  return (
    <>
      <ThemedText style={styles.heading}>{heading}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
        {subheading}
      </ThemedText>
    </>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.primary },
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.85 },
      ]}
      onPress={onPress}
      disabled={disabled || busy}>
      {busy ? (
        <ActivityIndicator color={theme.primaryForeground} />
      ) : (
        <ThemedText style={[styles.buttonLabel, { color: theme.primaryForeground }]}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** The hairline-ruled input surface, themed at the call site. */
export function useFieldStyle(): TextStyle {
  const theme = useTheme();
  return {
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.input,
    backgroundColor: theme.card,
    color: theme.text,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    fontSize: 17,
  };
}

/** A square-cut block of ground — the studio's card, hairline and all. */
export function useCardStyle(): ViewStyle {
  const theme = useTheme();
  return {
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.card,
  };
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    lineHeight: 14,
  },
  heading: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginTop: Spacing.two,
  },
  subheading: { marginTop: Spacing.two },
  button: { borderRadius: 0, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
});

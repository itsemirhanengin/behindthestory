import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { OtpInput, type OtpInputRef } from 'react-native-otp-entry';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiError, rpc } from '@/lib/api';
import { useSession } from '@/lib/session-context';

type Step = 'email' | 'code';

/**
 * The studio's sign-in page, spoken with an iOS accent: same two steps, same
 * copy, same paper-and-ink surfaces — but system fonts (New York for the
 * wordmark), SF Symbols and haptics instead of webfonts and toasts.
 */
export default function SignIn() {
  const theme = useTheme();
  const session = useSession();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Resending immediately is almost always a misread, not a lost email. */
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<OtpInputRef>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rpc.api.auth.otp.request.$post({ json: { email: email.trim() } });
      if (!res.ok) throw await apiError(res);
      setStep('code');
      setCooldown(30);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      // `client: "mobile"` is what makes the API answer with the raw token
      // instead of setting a cookie no native app could use.
      const res = await rpc.api.auth.otp.verify.$post({
        json: { email: email.trim(), code: value, client: 'mobile' },
      });
      if (!res.ok) throw await apiError(res);

      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new Error('The server did not return a session.');

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Flipping the session state is the navigation: the root layout's
      // Protected guards swap this screen out for the tabs on their own.
      await session.signIn(body.token);
    } catch (e) {
      setError((e as Error).message);
      // Wrong codes are far more often mistyped than misread, so clear the
      // field and keep focus rather than making them select-all first.
      codeRef.current?.clear();
      codeRef.current?.focus();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  }

  const hairline = {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.input,
    backgroundColor: theme.card,
    color: theme.text,
  };

  return (
    <ThemedView style={styles.screen}>
      {/* The library's KeyboardAvoidingView, not React Native's: it tracks the
          keyboard frame natively, so the content glides with the keyboard's
          own animation curve instead of jumping when the notification fires. */}
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <View style={styles.body}>
          <View style={styles.wordmark}>
            <SymbolView name="book.closed" size={24} tintColor={theme.primary} />
            <ThemedText style={styles.title}>BehindTheStory</ThemedText>
          </View>

          {step === 'email' ? (
            <>
              <ThemedText themeColor="textSecondary">
                Enter your email and we&apos;ll send you a sign-in code. No password to remember.
              </ThemedText>

              <View style={styles.fieldGroup}>
                <ThemedText themeColor="textSecondary" style={styles.label}>
                  Email
                </ThemedText>
                <TextInput
                  style={[styles.field, hairline]}
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={sendCode}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.primary },
                  pressed && styles.pressed,
                ]}
                onPress={sendCode}
                disabled={busy || !email.includes('@')}>
                {busy ? (
                  <ActivityIndicator color={theme.primaryForeground} />
                ) : (
                  <ThemedText style={[styles.buttonLabel, { color: theme.primaryForeground }]}>
                    Send code
                  </ThemedText>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText themeColor="textSecondary">
                We sent a six-digit code to <ThemedText>{email}</ThemedText>. It&apos;s in the
                subject line, so you may not need to open the email.
              </ThemedText>

              <View style={styles.fieldGroup}>
                <ThemedText themeColor="textSecondary" style={styles.label}>
                  Sign-in code
                </ThemedText>
                <OtpInput
                  ref={codeRef}
                  numberOfDigits={6}
                  type="numeric"
                  autoFocus
                  disabled={busy}
                  focusColor={theme.primary}
                  // Six digits is the whole input — waiting for a button press
                  // after the last one is a keystroke nobody needs.
                  onFilled={(value) => {
                    if (!busy) void verify(value);
                  }}
                  textInputProps={{
                    textContentType: 'oneTimeCode',
                    accessibilityLabel: 'One-time sign-in code',
                  }}
                  theme={{
                    containerStyle: styles.otp,
                    pinCodeContainerStyle: {
                      ...styles.otpBox,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.input,
                      backgroundColor: theme.card,
                    },
                    focusedPinCodeContainerStyle: {
                      borderColor: theme.primary,
                      borderWidth: 1,
                    },
                    pinCodeTextStyle: { ...styles.otpDigit, color: theme.text },
                    focusStickStyle: { ...styles.focusStick, backgroundColor: theme.primary },
                    disabledPinCodeContainerStyle: { opacity: 0.5 },
                  }}
                />
              </View>

              <View style={styles.row}>
                <Pressable
                  onPress={() => {
                    setStep('email');
                    setError(null);
                  }}
                  hitSlop={12}
                  disabled={busy}>
                  <ThemedText style={[styles.ghost, { color: theme.primary }]}>
                    ← Change email
                  </ThemedText>
                </Pressable>
                <Pressable onPress={sendCode} hitSlop={12} disabled={cooldown > 0 || busy}>
                  <ThemedText
                    style={[
                      styles.ghost,
                      { color: cooldown > 0 ? theme.textSecondary : theme.primary },
                    ]}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </ThemedText>
                </Pressable>
              </View>

              {busy ? (
                <View style={styles.checking}>
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Checking…
                  </ThemedText>
                </View>
              ) : null}
            </>
          )}

          {error ? (
            <ThemedText type="small" style={{ color: theme.destructive }}>
              {error}
            </ThemedText>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.two },
  title: { fontFamily: Fonts.serif, fontSize: 24, fontWeight: '600', letterSpacing: -0.3 },
  fieldGroup: { gap: Spacing.two },
  /* The studio's `.label-caps`: a small-caps eyebrow instead of a bold label. */
  label: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    lineHeight: 14,
  },
  /* Square-cut, hairline-ruled, no shadow — the studio's three rules. */
  field: {
    borderRadius: 0,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    fontSize: 17,
  },
  /* Square-cut cells, hairline-ruled like every other surface; the focused
     cell swaps its rule for the accent instead of glowing or rounding. */
  otp: { gap: Spacing.two, justifyContent: 'space-between' },
  otpBox: { borderRadius: 0, width: 48, height: 56 },
  otpDigit: { fontFamily: Fonts.mono, fontSize: 24, fontVariant: ['tabular-nums'] },
  focusStick: { width: 2, height: 24 },
  button: { borderRadius: 0, paddingVertical: 14, alignItems: 'center', marginTop: Spacing.one },
  pressed: { opacity: 0.85 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.one },
  ghost: { fontSize: 14, fontWeight: '500' },
  checking: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});

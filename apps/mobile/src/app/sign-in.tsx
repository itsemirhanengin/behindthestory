import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiError, rpc } from '@/lib/api';
import { useSession } from '@/lib/session-context';

const TINT = '#208AEF';
const DESTRUCTIVE = '#E5484D';

/**
 * Two steps, one screen. The code arrives while the app is open, so pushing a
 * second screen would only put an animation between the writer and the field
 * they are about to type into.
 */
export default function SignIn() {
  const theme = useTheme();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await rpc.api.auth.otp.request.$post({ json: { email: email.trim() } });
      if (!res.ok) throw await apiError(res);
      setSent(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      // `client: "mobile"` is what makes the API answer with the raw token
      // instead of setting a cookie no native app could use.
      const res = await rpc.api.auth.otp.verify.$post({
        json: { email: email.trim(), code: code.trim(), client: 'mobile' },
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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    borderColor: theme.backgroundSelected,
    backgroundColor: theme.backgroundElement,
    color: theme.text,
  };

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.body}>
          <ThemedText type="subtitle" style={styles.title}>
            BehindTheStory
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {sent ? `Enter the six digits sent to ${email}.` : 'Sign in with your email address.'}
          </ThemedText>

          {sent ? (
            <TextInput
              style={[styles.field, styles.code, field]}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoFocus
              maxLength={6}
            />
          ) : (
            <TextInput
              style={[styles.field, field]}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          )}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={sent ? verify : requestCode}
            disabled={busy || (sent ? code.length < 6 : !email.includes('@'))}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.buttonLabel}>{sent ? 'Sign in' : 'Send code'}</ThemedText>
            )}
          </Pressable>

          {sent ? (
            <Pressable onPress={() => setSent(false)} hitSlop={12}>
              <ThemedText style={styles.secondary}>Use a different address</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  title: { fontFamily: Fonts.serif },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 17,
  },
  code: { fontSize: 28, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  button: {
    backgroundColor: TINT,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.8 },
  buttonLabel: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { color: TINT, fontSize: 15, textAlign: 'center' },
  error: { color: DESTRUCTIVE, fontSize: 15 },
});

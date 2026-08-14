import * as SecureStore from 'expo-secure-store';

const KEY = 'behindthestory.session';

/**
 * The session token lives in the keychain, not in AsyncStorage.
 *
 * It is a bearer credential with a long life: anything that can read it can act
 * as this writer until the session is revoked. SecureStore puts it behind the
 * device's own protection, which is the difference between a stolen backup
 * being an inconvenience and being an account takeover.
 */

let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await SecureStore.getItemAsync(KEY);
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  await SecureStore.setItemAsync(KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY);
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const key = 'lumora.session.v1';
// Web deliberately keeps the token in React memory only, never localStorage.
export async function readSession() {
  return Platform.OS === 'web' ? null : SecureStore.getItemAsync(key);
}
export async function saveSession(token: string) {
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(key, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function clearSession() {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
}

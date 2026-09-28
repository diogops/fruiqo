// Armazenamento do refresh token no device: Keychain (iOS) / Keystore (Android) via expo-secure-store (SEC-REQ-08).
// No navegador (preview RF-17) o Metro resolve `tokenStore.web.ts` no lugar deste arquivo.
import * as SecureStore from 'expo-secure-store';

export const getToken = (key: string): Promise<string | null> => SecureStore.getItemAsync(key);
export const setToken = (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value);
export const deleteToken = (key: string): Promise<void> => SecureStore.deleteItemAsync(key);

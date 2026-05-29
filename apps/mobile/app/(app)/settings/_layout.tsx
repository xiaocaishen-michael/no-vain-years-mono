import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '设置' }} />
      {/* account-security has its own nested Stack — disable outer header to avoid double header */}
      <Stack.Screen name="account-security" options={{ headerShown: false }} />
    </Stack>
  );
}

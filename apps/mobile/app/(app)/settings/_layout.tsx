import { Stack } from 'expo-router';

import { makeHeaderBackOrParent } from '~/ui';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen
        name="index"
        options={{
          title: '设置',
          // On web refresh the stack has no history beneath /settings → fall back
          // to the profile tab (where the settings entry lives).
          headerLeft: makeHeaderBackOrParent('/(app)/(tabs)/profile'),
        }}
      />
      {/* account-security has its own nested Stack — disable outer header to avoid double header */}
      <Stack.Screen name="account-security" options={{ headerShown: false }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

export default function AccountSecurityLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '账号与安全' }} />
      <Stack.Screen name="delete-account" options={{ title: '注销账号' }} />
      {/*
       * B2 (device-management amend 005): add
       *   <Stack.Screen name="login-management" options={{ headerShown: false }} />
       */}
    </Stack>
  );
}

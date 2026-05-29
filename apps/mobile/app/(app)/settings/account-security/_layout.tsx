import { Stack } from 'expo-router';

export default function AccountSecurityLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '账号与安全' }} />
      {/*
       * B2 (device-management amend 005): add
       *   <Stack.Screen name="login-management" options={{ headerShown: false }} />
       * B3 (account-deletion settings 入口 amend 004): add
       *   <Stack.Screen name="delete-account" options={{ title: '注销账号' }} />
       */}
    </Stack>
  );
}

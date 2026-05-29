import { Stack } from 'expo-router';

export default function LoginManagementLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '登录管理' }} />
      <Stack.Screen name="[recordId]" options={{ title: '登录设备详情' }} />
    </Stack>
  );
}

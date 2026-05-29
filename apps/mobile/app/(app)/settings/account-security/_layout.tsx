import { Stack } from 'expo-router';

export default function AccountSecurityLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: '账号与安全' }} />
      <Stack.Screen name="delete-account" options={{ title: '注销账号' }} />
      {/* login-management 子树自带 Stack header (登录管理 / 登录设备详情),
          父级不再渲染,否则路由名 header 会叠在中文 header 上形成双标题。 */}
      <Stack.Screen name="login-management" options={{ headerShown: false }} />
    </Stack>
  );
}

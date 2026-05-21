// FR-013 / FR-024 — bottom tab bar registers 4 routes (首页 / 搜索 / 外脑 / 我的).
// Labels only — no tabBarIcon this batch per FR-024 (图标系统 PHASE 2 mockup 决定).
// FR-027 — explicit useSafeAreaInsets for tabBarStyle.paddingBottom (iOS home
// indicator). Active-state visual uses Expo Router default + brand-tinted label.

import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@nvy/design-tokens';

const TAB_LABELS = {
  home: '首页',
  search: '搜索',
  pkm: '外脑',
  profile: '我的',
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.colors.brand[500],
        tabBarInactiveTintColor: tokens.colors.ink.subtle,
        tabBarStyle: { paddingBottom: insets.bottom },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: TAB_LABELS.home, tabBarLabel: TAB_LABELS.home }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: TAB_LABELS.search, tabBarLabel: TAB_LABELS.search }}
      />
      <Tabs.Screen
        name="pkm"
        options={{ title: TAB_LABELS.pkm, tabBarLabel: TAB_LABELS.pkm }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: TAB_LABELS.profile, tabBarLabel: TAB_LABELS.profile }}
      />
    </Tabs>
  );
}

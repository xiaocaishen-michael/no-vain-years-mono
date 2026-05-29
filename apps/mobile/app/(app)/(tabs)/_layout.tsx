// FR-013 / FR-024 — bottom tab bar registers 4 routes (首页 / 外脑 / 投资 / 我的).
// 图标系统 per portfolio handoff「底部 Tab 图标系统」(2026-05-29)：线性描边 24×24,
// inactive 中性灰 (ink.subtle) / active 品牌蓝实心 (brand[500])，经 ~/ui TabBarIcon。
// FR-027 — explicit useSafeAreaInsets for tabBarStyle.paddingBottom (iOS home indicator).

import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '~/theme';
import { TabBarIcon, type TabIconName } from '~/ui';

const TABS: { name: string; label: string; icon: TabIconName }[] = [
  { name: 'index', label: '首页', icon: 'home' },
  { name: 'pkm', label: '外脑', icon: 'brain' },
  { name: 'portfolio', label: '投资', icon: 'invest' },
  { name: 'profile', label: '我的', icon: 'profile' },
];

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
      {TABS.map(({ name, label, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarLabel: label,
            tabBarIcon: ({ focused, color, size }) => (
              <TabBarIcon name={icon} focused={focused} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

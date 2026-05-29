// FR-013 / FR-024 — bottom tab bar registers 4 routes (首页 / 外脑 / 投资 / 我的).
// 图标系统 per portfolio handoff「底部 Tab 图标系统」(2026-05-29)：线性描边 24×24,
// inactive 中性灰 (ink.subtle) / active 品牌蓝实心 (brand[500])，经 ~/ui TabBarIcon。
//
// 高度 + 安全区：**不覆写** tabBarStyle.height。React Navigation v7 bottom-tabs 的高度是
// 平台常量 `49 + insets.bottom`（getTabBarHeight in BottomTabBar.tsx），且**只有「不传数字
// height」时它才会自动叠 insets.bottom**（传数字会短路、丢掉 inset，得自己重算 + 自己补
// paddingBottom）。让库自管高度 + iOS home indicator 安全区，iOS/Android/web 三端一致。
//
// 标签裁切根因（web + CJK）：RN 的 tab label 是 `<Text numberOfLines={1}>`，RN-Web 下
// numberOfLines 会加 `overflow:hidden`；缺显式 lineHeight 时 CJK 字形（满 em 盒、descender
// 长）落在行盒外被裁（necolas/react-native-web#1585）。web 上 insets.bottom=0 → bar 恰好
// 49px，CJK 标签最先溢出，故只在 web 暴露。修法 = 显式 lineHeight > fontSize（~1.3×），
// 含住字形盒 —— 与高度无关，高度从不是问题。

import { Tabs } from 'expo-router';
import { tokens } from '~/theme';
import { TabBarIcon, type TabIconName } from '~/ui';

const TABS: { name: string; label: string; icon: TabIconName }[] = [
  { name: 'index', label: '首页', icon: 'home' },
  { name: 'pkm', label: '外脑', icon: 'brain' },
  { name: 'portfolio', label: '投资', icon: 'invest' },
  { name: 'profile', label: '我的', icon: 'profile' },
];

const TAB_ICON_SIZE = 24; // 与 TabBarIcon viewBox 一致
const TAB_LABEL_FONT_SIZE = 11; // 比 RN 默认(10)略大、贴近 design handoff；整档可调
const TAB_LABEL_LINE_HEIGHT = 15; // > fontSize，含住 CJK descender —— 修裁切的唯一杠杆

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.colors.brand[500],
        tabBarInactiveTintColor: tokens.colors.ink.subtle,
        // 显式 lineHeight（> fontSize）含住 CJK 字形盒，根治 web 端 overflow:hidden 裁切。
        tabBarLabelStyle: {
          fontSize: TAB_LABEL_FONT_SIZE,
          lineHeight: TAB_LABEL_LINE_HEIGHT,
        },
        // 不设 tabBarStyle.height —— 交给 RN 的 49 + insets.bottom 自适应三端安全区。
      }}
    >
      {TABS.map(({ name, label, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarLabel: label,
            tabBarIcon: ({ focused, color }) => (
              <TabBarIcon name={icon} focused={focused} color={color} size={TAB_ICON_SIZE} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

// PHASE 1 PLACEHOLDER — business flow validated; visuals pending mockup.
// 账号与安全页（007 重构）：图式三段组合页 = 资料卡 / 身份·绑定卡 / 安全卡。
// 占位行（头像/性别/主页背景图/邮箱/微信/google/安全小知识）= disabled 原生 RN Row，
// 无精确视觉决策（占位 UI 4 边界）。active 行：个人简介（→ bio-edit，本 feature）/
// 登录管理（005 不回归）/ 注销账号（004 不回归）。复用 006 ~/settings/primitives。
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useAuthStore } from '~/auth/store';
import { maskPhone } from '~/format/phone';
import { Card, Divider, Row } from '~/settings/primitives';

const COPY = {
  // 资料卡
  avatar: '头像',
  displayName: '昵称',
  bio: '个人简介',
  gender: '性别',
  homeBackground: '主页背景图',
  // 身份 / 绑定卡
  phone: '手机号',
  email: '邮箱',
  wechat: '微信',
  google: 'google',
  // 安全卡
  loginManagement: '登录管理',
  deleteAccount: '注销账号',
  securityTips: '安全小知识',
};

export default function AccountSecurityIndex() {
  const displayName = useAuthStore((s) => s.displayName);
  const phone = useAuthStore((s) => s.phone);
  const router = useRouter();

  return (
    <ScrollView
      className="flex-1 bg-surface-sunken"
      contentContainerClassName="px-md pt-md pb-xl gap-md"
    >
      {/* 资料卡 — 昵称展示真实 displayName（disabled）；个人简介 active → 编辑页；
          头像 / 性别 / 主页背景图 disabled 占位；不渲染二维码名片 */}
      <Card>
        <Row label={COPY.avatar} disabled />
        <Divider />
        <Row label={COPY.displayName} value={displayName ?? undefined} disabled />
        <Divider />
        <Row
          label={COPY.bio}
          onPress={() => router.push('/(app)/settings/account-security/bio-edit')}
        />
        <Divider />
        <Row label={COPY.gender} disabled />
        <Divider />
        <Row label={COPY.homeBackground} disabled />
      </Card>

      {/* 身份 / 绑定卡 — 全 disabled 占位；手机号脱敏；微信 / google 为后续绑定预留挂载点 */}
      <Card>
        <Row label={COPY.phone} value={maskPhone(phone)} disabled />
        <Divider />
        <Row label={COPY.email} disabled />
        <Divider />
        <Row label={COPY.wechat} disabled />
        <Divider />
        <Row label={COPY.google} disabled />
      </Card>

      {/* 安全卡 — 现状功能不回归（005 登录管理 / 004 注销账号）；安全小知识 disabled */}
      <Card>
        <Row
          label={COPY.loginManagement}
          onPress={() => router.push('/(app)/settings/account-security/login-management')}
        />
        <Divider />
        <Row
          label={COPY.deleteAccount}
          destructive
          onPress={() => router.push('/(app)/settings/account-security/delete-account')}
        />
        <Divider />
        <Row label={COPY.securityTips} disabled />
      </Card>
    </ScrollView>
  );
}

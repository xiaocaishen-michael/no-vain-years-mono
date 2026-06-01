// PHASE 1 PLACEHOLDER — business flow validated; visuals pending mockup.
// 账号与安全页（008 资料编辑 + 009 头像/背景图换图）：图式三段组合页 = 资料卡 / 身份·绑定卡 / 安全卡。
// 资料卡行序 = 头像 / 昵称 / 性别 / 个人简介 / 主页背景图（008 FR-C01：个人简介↔性别对换）。
// active 行：头像 / 主页背景图（009 → action sheet 换图/查看）/ 昵称（→ name-edit）/
// 性别（→ gender-edit）/ 个人简介（→ bio-edit）/ 登录管理（005 不回归）/ 注销账号（004 不回归）。
// 占位行（邮箱/微信/google）= disabled 原生 RN Row（占位 UI 4 边界）。复用 006 ~/settings/primitives。
import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useMe } from '~/core/api/use-me';
import { maskPhone } from '~/format/phone';
import { useProfileImageEditor } from '~/profile-image/use-profile-image-editor';
import { Card, Divider, Row } from '~/settings/primitives';
import { genderLabel } from '~/settings/gender';

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
};

export default function AccountSecurityIndex() {
  // 资料卡全部字段读 /me 查询缓存（单一真相源）：昵称 / 手机号 / 性别 / 个人简介同源，
  // 不再分别读 store（store 仅作冷启动 seed，不对外暴露用于展示）。
  const { data: profile } = useMe();
  const displayName = profile?.displayName ?? null;
  const phone = profile?.phone ?? null;
  const router = useRouter();

  // 009：头像 / 主页背景图行点击 → action sheet 换图 / 查看大图。
  const avatarEditor = useProfileImageEditor('avatar', profile?.avatarUrl ?? null);
  const backgroundEditor = useProfileImageEditor('background', profile?.backgroundImageUrl ?? null);

  return (
    <ScrollView
      className="flex-1 bg-surface-sunken"
      contentContainerClassName="px-md pt-md pb-xl gap-md"
    >
      {/* 资料卡 — 行序 头像 / 昵称 / 性别 / 个人简介 / 主页背景图（008 FR-C01）；
          头像 / 主页背景图（009）+ 昵称 / 性别 / 个人简介 active → 各编辑屏 / 换图 sheet */}
      <Card>
        <Row label={COPY.avatar} onPress={avatarEditor.open} />
        <Divider />
        <Row
          label={COPY.displayName}
          value={displayName ?? undefined}
          onPress={() => router.push('/(app)/settings/account-security/name-edit')}
        />
        <Divider />
        <Row
          label={COPY.gender}
          value={genderLabel(profile?.gender) || undefined}
          onPress={() => router.push('/(app)/settings/account-security/gender-edit')}
        />
        <Divider />
        <Row
          label={COPY.bio}
          onPress={() => router.push('/(app)/settings/account-security/bio-edit')}
        />
        <Divider />
        <Row label={COPY.homeBackground} onPress={backgroundEditor.open} />
      </Card>
      {avatarEditor.overlay}
      {backgroundEditor.overlay}

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

      {/* 安全卡 — 登录管理（005 设备列表，不回归）*/}
      <Card>
        <Row
          label={COPY.loginManagement}
          onPress={() => router.push('/(app)/settings/account-security/login-management')}
        />
      </Card>

      {/* 注销账号 — 独立卡片，居中红色无 chevron（同「退出登录」风格；004 短信注销，不回归）*/}
      <Card>
        <Row
          label={COPY.deleteAccount}
          destructive
          showChevron={false}
          align="center"
          onPress={() => router.push('/(app)/settings/account-security/delete-account')}
        />
      </Card>
    </ScrollView>
  );
}

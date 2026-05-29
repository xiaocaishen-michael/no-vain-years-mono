import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { useAuthStore } from '~/auth/store';
import { maskPhone } from '~/format/phone';
import { Card, Divider, Row } from '~/settings/primitives';

const COPY = {
  phone: '手机号',
  realname: '实名认证',
  thirdPartyBinding: '第三方账号绑定',
  loginManagement: '登录管理',
  deleteAccount: '注销账号',
  securityTips: '安全小知识',
};

export default function AccountSecurityIndex() {
  const phone = useAuthStore((s) => s.phone);
  const router = useRouter();

  return (
    <ScrollView
      className="flex-1 bg-surface-sunken"
      contentContainerClassName="px-md pt-md pb-xl gap-md"
    >
      <Card>
        {/* 手机号 disabled until a dedicated phone-management feature ships */}
        <Row label={COPY.phone} value={maskPhone(phone)} disabled />
        <Divider />
        <Row label={COPY.realname} disabled />
        <Divider />
        <Row label={COPY.thirdPartyBinding} disabled />
      </Card>

      <Card>
        {/* B2 (device-management amend 005) 已激活：登录管理屏 (US5) */}
        <Row
          label={COPY.loginManagement}
          onPress={() => router.push('/(app)/settings/account-security/login-management')}
        />
      </Card>

      <Card>
        {/* B3 (account-deletion 发起屏 amend 004) 已激活：destructive Row 无 chevron 保留 */}
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

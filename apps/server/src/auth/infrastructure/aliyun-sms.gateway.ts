import { Injectable, Logger } from '@nestjs/common';
import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import type { RetryExecutor } from '../application/ports/retry-executor.port';
import type { SmsGateway } from '../application/ports/sms-gateway.port';

export interface AliyunSmsGatewayCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  endpoint?: string;
  regionId?: string;
}

const DEFAULT_ENDPOINT = 'dysmsapi.aliyuncs.com';
const DEFAULT_REGION = 'cn-hangzhou';

/**
 * AliyunSmsGateway — production SmsGateway adapter (W3 A4, FR-S03)。
 *
 * Skeleton-only (per 2026-05-17 W3 起手 user choice "Skeleton-only 没 cred"):
 * - 完整 SDK 调用 + RetryExecutor 包 retry 策略
 * - ENV-gated provider 切换 (mock 默认 dev/test, aliyun 仅在 SMS_GATEWAY=aliyun 时启用)
 * - 真 SMS env-gated IT defer 到 cred + SignName/TemplateCode 审批后单独 PR
 *
 * Client + signName + templateCode 通过 ctor 显式注入 (testable), provider
 * factory 在 auth.module.ts 内部 new client + new gateway。
 *
 * Phone format conversion: Aliyun 国内短信接 11 digit (no +86 prefix), strip
 * +86 if present。
 */
@Injectable()
export class AliyunSmsGateway implements SmsGateway {
  private readonly logger = new Logger(AliyunSmsGateway.name);

  constructor(
    private readonly client: Dysmsapi,
    private readonly signName: string,
    private readonly templateCode: string,
    private readonly retryExecutor: RetryExecutor,
  ) {}

  static createClient(cred: AliyunSmsGatewayCredentials): Dysmsapi {
    const config = new $OpenApiUtil.Config({
      accessKeyId: cred.accessKeyId,
      accessKeySecret: cred.accessKeySecret,
      endpoint: cred.endpoint ?? DEFAULT_ENDPOINT,
      regionId: cred.regionId ?? DEFAULT_REGION,
    });
    return new Dysmsapi(config);
  }

  async sendCode(phone: Phone, code: SmsCode): Promise<void> {
    const phoneNumber = phone.value.startsWith('+86')
      ? phone.value.slice(3)
      : phone.value;

    const request = new SendSmsRequest({
      phoneNumbers: phoneNumber,
      signName: this.signName,
      templateCode: this.templateCode,
      templateParam: JSON.stringify({ code: code.value }),
    });

    const response = await this.retryExecutor.execute(() =>
      this.client.sendSms(request),
    );

    if (response.body?.code !== 'OK') {
      throw new Error(
        `Aliyun SMS send failed: code=${response.body?.code ?? 'UNKNOWN'} message=${response.body?.message ?? ''}`,
      );
    }
    this.logger.log(
      `Aliyun SMS sent to ${phone.value} (bizId=${response.body.bizId ?? 'unknown'})`,
    );
  }
}

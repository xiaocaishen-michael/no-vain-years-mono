---
adr_id: ADR-0026
status: Proposed
applies_to: [apps/server, infrastructure]
sunset_trigger: |
  - 本 ADR 是 stub,Plan 3 Phase 1 落地后转 Accepted
  - Plan 3 重新 scope (e.g. 推 P2P / 仅本地) 让部署形态判废
---

# ADR-0026: Backend Deployment Topology (stub — Plan 3 Phase 1 决)

* Status: Proposed (stub, Plan 3 Phase 1 deadline)
* Deciders: project owner
* Tags: backend / deployment / infrastructure / cross-cutting

## Context

[Plan 2/3](../plans/plan2-plan3-clever-sutherland.md) Phase 1 (后端首次部署) 决定后端物理部署形态。当前(2026-05-21)实际状态:

* 后端 `apps/server`(NestJS + Fastify + Prisma)只在本地 Docker Compose 跑过 W1.4 PoC
* 数据库 Postgres + Redis 仍走本地 Testcontainers
* 部署目标 cn user(M1 自用 → M2 100 内测 → M3 1000+)
* SWAS(阿里云轻量应用服务器)单实例为 baseline 候选,memory `reference_aliyun_swas_ufw_incompat` 已实证 SWAS 不能开 ufw

## Decision (Open — 7 子问题)

7 决策点留 Plan 3 Phase 1 真做时定:

| # | 决策点 | 候选 | 决策时机 |
|---|---|---|---|
| 1 | Compute 形态 | (a) SWAS 单实例 (b) ECS + 自管 docker (c) ACK/K8s (d) Serverless (函数计算/SAE) | Phase 1 起步 |
| 2 | DB 托管 | (a) RDS PG (b) PolarDB (c) SWAS 自管 PG | Phase 1 起步 |
| 3 | Redis 托管 | (a) 云 Redis (b) SWAS 自管 (c) Upstash 海外 | Phase 1 起步 |
| 4 | Secrets 注入 | (a) volumes mount (per [ADR-0037](0037-security-credentials-governance.md)) (b) 云密钥服务 KMS (c) env 文件 | Phase 1 起步 |
| 5 | 镜像 registry | (a) ACR 个人版 (b) GHCR (c) 本地 build push | Phase 1 起步 |
| 6 | CI/CD pipeline | (a) GitHub Actions → ssh deploy (b) Aliyun云效 (c) Drone self-hosted | Phase 1 起步 |
| 7 | 备案 / 域名 | (a) 国内备案 + 大陆 ECS (b) 海外 CDN + 国内中转 (c) 仅海外不备案 | Plan 3 早期 |

## Consequences (依 Decision 而定)

* 当前所有引用 ADR-0026 的 ADR (ADR-0037 secrets / ADR-0036 log 输出目标) 视为 Proposed 联动,Phase 1 ship 同步 Accepted

## Open Questions

* CF Workers → Aliyun ECS 525 问题 (per `reference_cf_workers_to_aliyun_ecs_525`) 对 Phase 1 备案 vs 不备案选择的影响
* SWAS 不能开 ufw 对单实例安全策略的影响 — 必须靠 SWAS 管理面单层防护
* Plan 3 是否需早期接入 OTLP / APM (per [ADR-0036](0036-observability-logging-governance.md) sunset 触发)

## References

* [Plan 2/3](../plans/plan2-plan3-clever-sutherland.md) Phase 1
* memory `reference_aliyun_swas_ufw_incompat`
* memory `reference_cf_workers_to_aliyun_ecs_525`
* [ADR-0037](0037-security-credentials-governance.md) (secrets 注入路径)

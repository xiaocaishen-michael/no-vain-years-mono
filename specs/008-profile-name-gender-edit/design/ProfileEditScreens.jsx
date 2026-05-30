// ProfileEditScreens.jsx — 资料编辑 baseline: 设置昵称 + 设置性别
// no-vain-years · account 模块 · 范式 1（settings 子屏 · Expo Router stack）
// 0 新 token。参考图橙色 accent 一律映射到 app brand-500 (#2456E5)。
// 复用：~/settings/primitives 的 Card / Row / Divider 视觉 + ~/theme tokens。
//   brand-500 #2456E5  · surface #FFF · surface-sunken #F2F4F7
//   ink #1A1A1A · ink-muted #666 · ink-subtle #999 · line-soft #EEF0F3
//   err #EF4444 · rounded-md 12 · spacing xs/md/lg 4/16/24

const { useState } = React;

const T = {
  brand: '#2456E5', // brand-500  ← 参考图橙色 accent 映射于此
  surface: '#FFFFFF', // bg-surface
  sunken: '#F2F4F7', // bg-surface-sunken
  ink: '#1A1A1A', // text-ink
  inkMuted: '#666666', // text-ink-muted
  inkSubtle: '#999999', // text-ink-subtle
  lineSoft: '#EEF0F3', // border-line-soft
  err: '#EF4444', // text-err
  sans: 'var(--nvy-font-sans)',
  mono: 'var(--nvy-font-mono)',
};

// ── native settings header — 返回 + 标题 + 右上操作位 ──────────────────
function SettingsHeader({ title, right }) {
  return (
    <div
      style={{
        flexShrink: 0,
        paddingTop: 54,
        background: T.surface,
        borderBottom: `1px solid ${T.lineSoft}`,
      }}
    >
      <div style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
        <span
          style={{
            width: 48,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 4,
            color: T.brand,
            fontSize: 28,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ‹
        </span>
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 16,
            fontWeight: 600,
            color: T.ink,
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 6,
          }}
        >
          {right}
        </div>
      </div>
    </div>
  );
}

// ── settings card (surface + rounded-md + line-soft border) ───────────
function Card({ children, style }) {
  return (
    <div
      style={{
        background: T.surface,
        margin: '0 16px',
        borderRadius: 12,
        border: `1px solid ${T.lineSoft}`,
        overflow: 'hidden',
        boxShadow: '0 1px 2px 0 rgba(17,24,39,.04)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  设置昵称
// ════════════════════════════════════════════════════════════════════
function NicknameScreen({ initial = '夜航西飞', value, max = 12 }) {
  const [val, setVal] = useState(value !== undefined ? value : initial);
  const len = [...val].length; // 按码点计（中英文一致）
  const over = len > max;
  const dirty = val !== initial;
  const canSave = dirty && len > 0 && !over;
  const saveColor = canSave ? T.brand : T.inkSubtle;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.sunken }}>
      <SettingsHeader
        title="设置昵称"
        right={
          <span
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: saveColor,
              cursor: canSave ? 'pointer' : 'default',
              padding: '4px 0',
            }}
          >
            保存
          </span>
        }
      />
      <div style={{ flex: 1, overflow: 'auto', paddingTop: 16 }}>
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 12px 0 16px',
              minHeight: 52,
            }}
          >
            <input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="起一个名字"
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: 0,
                background: 'transparent',
                fontFamily: T.sans,
                fontSize: 16,
                fontWeight: 500,
                color: T.ink,
                padding: '15px 0',
              }}
            />
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 12.5,
                color: over ? T.err : T.inkSubtle,
                flexShrink: 0,
                letterSpacing: '-0.01em',
              }}
            >
              {len}/{max}
            </span>
            {len > 0 && (
              <button
                type="button"
                onClick={() => setVal('')}
                aria-label="清空"
                style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  marginRight: -4,
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: T.inkSubtle,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </Card>

        {over && (
          <div style={{ padding: '10px 20px 0', fontSize: 12.5, color: T.err, lineHeight: 1.5 }}>
            已超出 {len - max} 个字，请精简后保存
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  设置性别
// ════════════════════════════════════════════════════════════════════
const GENDERS = ['男', '女', '非二元', '保密'];

function CheckMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" style={{ flexShrink: 0 }} aria-hidden="true">
      <path
        d="M4.2 10.6 8.3 14.6 15.8 6.2"
        fill="none"
        stroke="#2456E5"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GenderScreen({ initial = '保密' }) {
  const [sel, setSel] = useState(initial);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.sunken }}>
      <SettingsHeader title="设置性别" />
      <div style={{ flex: 1, overflow: 'auto', paddingTop: 16 }}>
        <Card>
          {GENDERS.map((g, i) => (
            <div
              key={g}
              onClick={() => setSel(g)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                minHeight: 52,
                padding: '0 16px',
                cursor: 'pointer',
              }}
            >
              <span style={{ flex: 1, fontSize: 16, fontWeight: 500, color: T.ink }}>{g}</span>
              {sel === g && <CheckMark />}
              {i < GENDERS.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 16,
                    right: 0,
                    bottom: 0,
                    height: 1,
                    background: T.lineSoft,
                  }}
                />
              )}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { NicknameScreen, GenderScreen, SettingsHeader, ProfileCard: Card });

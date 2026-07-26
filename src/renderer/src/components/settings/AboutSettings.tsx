import { useSessionStore } from '../../state/sessionStore'
import { Button } from '../ui'
import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

export function AboutSettings(): React.JSX.Element {
  const about = useSessionStore((s) => s.about)
  const resetSettings = useSessionStore((s) => s.resetSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const setShortcutsOpen = useSessionStore((s) => s.setShortcutsOpen)

  return (
    <div className="about-card">
      <div>
        <span className="about-logo" role="img" aria-label="vav">
          <img className="logo-light" src={wordmark} alt="" />
          <img className="logo-dark" src={wordmarkDark} alt="" />
        </span>
        <div className="muted">{about?.version ?? '1.0.0'} · MIT</div>
      </div>

      <div>
        <div className="kv-row">
          <span className="kv-label">数据</span>
          <span className="kv-value">仅本机（Keychain + Application Support）</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">终端</span>
          <span className="kv-value">xterm.js + node-pty（本地 PTY）</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">网络</span>
          <span className="kv-value">仅调用你配置的 LLM API 端点</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">记录</span>
          <span className="kv-value">{about?.conversationsPath ?? ''}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button label="查看快捷键" variant="secondary" onClick={() => setShortcutsOpen(true)} />
        <Button
          label="重置所有设置"
          variant="danger"
          onClick={() =>
            showDialog({
              title: '重置所有设置',
              body: '所有配置将恢复默认，API Key 将从 Keychain 删除。此操作不可撤销。',
              confirmLabel: '重置',
              destructive: true,
              onConfirm: () => void resetSettings()
            })
          }
        />
      </div>
    </div>
  )
}

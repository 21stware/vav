import type { ShellKind } from '@shared/types'
import { shellsFor } from '@shared/platform'
import { useSessionStore } from '../../state/sessionStore'
import { Button, InlineAlert, Segmented, Toggle } from '../ui'
import { PLATFORM } from '../../lib/platform'

const SHELLS = shellsFor(PLATFORM)

export function WorkspaceSettings(): React.JSX.Element {
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)

  return (
    <div className="form">
      <div className="form-row">
        <label>默认工作目录</label>
        <div className="control">
          <input
            className="text-field"
            placeholder="留空 = 临时 Workspace"
            value={settings.defaultWorkingDirectory}
            onChange={(event) =>
              void updateSettings({ defaultWorkingDirectory: event.target.value })
            }
          />
          <Button
            label="选择…"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const path = await window.vav.settings.pickDirectory()
              if (path) void updateSettings({ defaultWorkingDirectory: path })
            }}
          />
          {settings.defaultWorkingDirectory && (
            <Button
              label="恢复临时"
              size="sm"
              onClick={() => void updateSettings({ defaultWorkingDirectory: '' })}
            />
          )}
        </div>
      </div>
      <div className="form-hint">
        留空时新建会话使用系统 Temporary 下的 Workspace；主界面 chip 仍可单独切换当前会话目录。
      </div>

      <div className="form-row">
        <label>Shell</label>
        <div className="control">
          <Segmented<ShellKind>
            options={SHELLS}
            value={settings.shell}
            onChange={(shell) => void updateSettings({ shell })}
          />
        </div>
      </div>
      <div className="form-hint">
        {SHELLS.map((option) => `${option.label} = ${option.hint}`).join(' · ')}
        {SHELLS.length > 1 && '（未安装时启动会失败）'}
      </div>

      <div className="form-row">
        <label>命令超时</label>
        <div className="control">
          <input
            type="range"
            min={10}
            max={600}
            step={10}
            style={{ flex: 1 }}
            value={settings.commandTimeout}
            onChange={(event) =>
              void updateSettings({ commandTimeout: Number(event.target.value) })
            }
          />
          <span className="muted" style={{ width: 52 }}>
            {settings.commandTimeout} 秒
          </span>
        </div>
      </div>

      <div className="form-row">
        <label>自动批准只读操作</label>
        <div className="control">
          <Toggle
            checked={settings.autoApproveReadonly}
            onChange={(autoApproveReadonly) => void updateSettings({ autoApproveReadonly })}
          />
        </div>
      </div>
      <div className="form-hint">fs_read / fs_list 无需确认；写入与 terminal 仍需人工留意。</div>

      <InlineAlert
        kind="warning"
        title="权限提示"
        message="Terminal 与 Agent 可在所选目录执行任意 shell。请勿对不信任提示词打开整个 Home 等高权限目录。"
      />
    </div>
  )
}

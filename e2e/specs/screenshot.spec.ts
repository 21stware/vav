import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchVav } from '../launch'

async function overlayPage(app: ElectronApplication, timeoutMs = 15_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const root = win.locator('[data-testid="screenshot-overlay"]')
      try {
        if ((await root.count()) > 0 && (await root.isVisible())) return win
      } catch {
        // window closed while polling
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('screenshot overlay did not appear')
}

function cropBox(page: Page) {
  return page.locator('.screenshot-crop').evaluate((el: HTMLElement) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height)
  }))
}

async function pointer(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  await page.locator('[data-testid="screenshot-overlay"]').evaluate(
    (el, args) => {
      el.dispatchEvent(
        new PointerEvent(args.type, {
          clientX: args.x,
          clientY: args.y,
          button: 0,
          buttons: args.type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse'
        })
      )
    },
    { type, x, y }
  )
}

test('screenshot overlay crop can move and resize, then attach without crashing', async () => {
  const harness = await launchVav()
  try {
    const { app, page } = harness
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    await page.locator('[data-testid="composer-screenshot"]').click()

    const overlay = await overlayPage(app)
    await expect(overlay.locator('[data-testid="screenshot-overlay"]')).toBeVisible()

    await pointer(overlay, 'pointerdown', 180, 160)
    await pointer(overlay, 'pointermove', 420, 340)
    await pointer(overlay, 'pointerup', 420, 340)
    await expect(overlay.locator('.screenshot-handle-se')).toBeVisible()

    const before = await cropBox(overlay)
    expect(before.w).toBeGreaterThan(80)
    expect(before.h).toBeGreaterThan(80)

    await pointer(overlay, 'pointerdown', before.x + before.w / 2, before.y + before.h / 2)
    await pointer(overlay, 'pointermove', before.x + before.w / 2 + 50, before.y + before.h / 2)
    await pointer(overlay, 'pointerup', before.x + before.w / 2 + 50, before.y + before.h / 2)
    const moved = await cropBox(overlay)
    expect(moved.x).toBeGreaterThan(before.x + 20)
    expect(moved.w).toBeCloseTo(before.w, 0)
    expect(moved.h).toBeCloseTo(before.h, 0)

    await pointer(overlay, 'pointerdown', moved.x + moved.w, moved.y + moved.h)
    await pointer(overlay, 'pointermove', moved.x + moved.w + 60, moved.y + moved.h + 50)
    await pointer(overlay, 'pointerup', moved.x + moved.w + 60, moved.y + moved.h + 50)
    const resized = await cropBox(overlay)
    expect(resized.w).toBeGreaterThan(moved.w + 20)
    expect(resized.h).toBeGreaterThan(moved.h + 20)

    await overlay.locator('[data-testid="screenshot-copy"]').click()
    await expect(overlay.locator('[data-testid="screenshot-copy"]')).toHaveAttribute(
      'data-copied',
      'true',
      { timeout: 8_000 }
    )
    await expect
      .poll(async () => {
        return app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
      }, { timeout: 8_000 })
      .toBe(true)
    // Copy deliberately ends the session (clipboard exit) — no attachment.
    await expect.poll(() => overlayOnScreen(app), { timeout: 8_000 }).toBe(false)
    await expect(page.locator('.attachment-image-chip')).toHaveCount(0)

    // Attach flows through a fresh session's confirm button.
    await page.locator('[data-testid="composer-screenshot"]').click()
    const overlay2 = await overlayPage(app)
    await pointer(overlay2, 'pointerdown', 180, 160)
    await pointer(overlay2, 'pointermove', 420, 340)
    await pointer(overlay2, 'pointerup', 420, 340)
    await expect(overlay2.locator('[data-testid="screenshot-crop"]')).toBeVisible()
    await overlay2.locator('[aria-label="Add to chat"]').click()

    await expect
      .poll(async () => page.locator('.attachment-image-chip').count(), { timeout: 12_000 })
      .toBeGreaterThan(0)
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    expect(
      app.windows().some((win) => {
        try {
          return win === page && !win.isClosed()
        } catch {
          return false
        }
      })
    ).toBe(true)
  } finally {
    await harness.dispose()
  }
})

async function overlayOnScreen(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((win) => {
      if (win.isDestroyed()) return false
      const url = win.webContents.getURL()
      if (!url.includes('screenshot')) return false
      const bounds = win.getBounds()
      return bounds.x > -10_000 && win.getOpacity() > 0.05
    })
  )
}

test('screenshot Esc exits instead of clearing the crop', async () => {
  const harness = await launchVav()
  try {
    const { app, page } = harness
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    await page.locator('[data-testid="composer-screenshot"]').click()

    const overlay = await overlayPage(app)
    await pointer(overlay, 'pointerdown', 160, 140)
    await pointer(overlay, 'pointermove', 400, 320)
    await pointer(overlay, 'pointerup', 400, 320)
    await expect(overlay.locator('[data-testid="screenshot-crop"]')).toBeVisible()

    // Esc lands on the overlay window (real input is forwarded there by the
    // main process; CDP-synthesized keys never trigger before-input-event).
    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlayOnScreen(app), { timeout: 8_000 }).toBe(false)
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    await expect(page.locator('.attachment-image-chip')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('screenshot marks can be selected and Esc only deselects first', async () => {
  const harness = await launchVav()
  try {
    const { app, page } = harness
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    await page.locator('[data-testid="composer-screenshot"]').click()

    const overlay = await overlayPage(app)
    await pointer(overlay, 'pointerdown', 140, 120)
    await pointer(overlay, 'pointermove', 520, 400)
    await pointer(overlay, 'pointerup', 520, 400)
    await expect(overlay.locator('[data-testid="screenshot-crop"]')).toBeVisible()

    await overlay.locator('[data-testid="screenshot-rect"]').click()
    await pointer(overlay, 'pointerdown', 200, 180)
    await pointer(overlay, 'pointermove', 320, 280)
    await pointer(overlay, 'pointerup', 320, 280)
    await expect(overlay.locator('[data-testid="screenshot-overlay"]')).toHaveAttribute(
      'data-selected-mark',
      /.+/
    )

    await pointer(overlay, 'pointerdown', 260, 230)
    await pointer(overlay, 'pointermove', 300, 260)
    await pointer(overlay, 'pointerup', 300, 260)
    await expect(overlay.locator('[data-testid="screenshot-overlay"]')).toHaveAttribute(
      'data-selected-mark',
      /.+/
    )

    await overlay.keyboard.press('Escape')
    await expect(overlay.locator('[data-testid="screenshot-overlay"]')).not.toHaveAttribute(
      'data-selected-mark'
    )
    await expect.poll(() => overlayOnScreen(app), { timeout: 4_000 }).toBe(true)

    await overlay.keyboard.press('Escape')
    await expect.poll(() => overlayOnScreen(app), { timeout: 8_000 }).toBe(false)
  } finally {
    await harness.dispose()
  }
})

test('screenshot double-click confirms the crop', async () => {
  const harness = await launchVav()
  try {
    const { app, page } = harness
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
    await page.locator('[data-testid="composer-screenshot"]').click()

    const overlay = await overlayPage(app)
    await pointer(overlay, 'pointerdown', 180, 160)
    await pointer(overlay, 'pointermove', 420, 340)
    await pointer(overlay, 'pointerup', 420, 340)
    await expect(overlay.locator('[data-testid="screenshot-crop"]')).toBeVisible()

    // Real Chromium pointerdowns carry detail 0 (Pointer Events spec) — the
    // helper omits detail, so this exercises the manual double-click path:
    // two quick press/release pairs at the same spot inside the crop. One
    // evaluate keeps the gap well inside the 500ms double-click window.
    await overlay.locator('[data-testid="screenshot-overlay"]').evaluate(async (el) => {
      const fire = (type: string, buttons: number) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            clientX: 260,
            clientY: 220,
            button: 0,
            buttons,
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse'
          })
        )
      }
      fire('pointerdown', 1)
      fire('pointerup', 0)
      await new Promise((resolve) => setTimeout(resolve, 60))
      fire('pointerdown', 1)
      fire('pointerup', 0)
    })

    await expect
      .poll(async () => page.locator('.attachment-image-chip').count(), { timeout: 12_000 })
      .toBeGreaterThan(0)
  } finally {
    await harness.dispose()
  }
})

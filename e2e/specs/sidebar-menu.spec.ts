import { test, expect } from '@playwright/test'
import {
  chooseNativeMenu,
  dismissNativeMenu,
  E2E_SESSION_B_ID,
  E2E_SESSION_ID,
  launchVav,
  peekNativeMenu,
  sessionRow
} from '../launch'

/**
 * Sidebar session context menu — AppKit is intercepted under VAV_E2E.
 * Empty sessions skip the native delete confirm.
 */
async function openSessionMenu(page: Parameters<typeof sessionRow>[0], id: string): Promise<void> {
  await sessionRow(page, id).click({ button: 'right' })
}

test('session menu lists pin, archive, rename, duplicate, and delete', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openSessionMenu(page, E2E_SESSION_ID)
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(
        expect.arrayContaining(['Pin', 'Archive', 'Rename', 'Duplicate Session', 'Delete'])
      )
    await dismissNativeMenu(page)
  } finally {
    await harness.dispose()
  }
})

test('Archive moves the active session into the archive list and Unarchive restores it', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openSessionMenu(page, E2E_SESSION_ID)
    await chooseNativeMenu(page, 'Archive')

    await expect(page.locator('[data-testid="sidebar-archive"]')).toHaveCount(0)
    await expect(sessionRow(page, E2E_SESSION_ID)).toBeVisible()
    await expect(sessionRow(page, E2E_SESSION_ID)).toHaveClass(/selected/)

    await openSessionMenu(page, E2E_SESSION_ID)
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['Unarchive', 'Delete']))
    await chooseNativeMenu(page, 'Unarchive')

    await expect(page.locator('[data-testid="sidebar-archive"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-archive"] .sidebar-archive-count')).toHaveCount(
      0
    )
    await expect(sessionRow(page, E2E_SESSION_ID)).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Rename is an inline field and commits on Enter', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    const row = sessionRow(page, E2E_SESSION_ID)
    await openSessionMenu(page, E2E_SESSION_ID)
    await chooseNativeMenu(page, 'Rename')

    const field = row.locator('.rename-field')
    await expect(field).toBeVisible()
    await field.fill('Renamed e2e')
    await field.press('Enter')
    await expect(row).toContainText('Renamed e2e')
    await expect(row.locator('.rename-field')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('Pin creates a Pinned section and Unpin removes it', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openSessionMenu(page, E2E_SESSION_ID)
    await chooseNativeMenu(page, 'Pin')

    await expect(page.locator('.conv-pinned-section .conv-section-title')).toHaveText('Pinned')
    await expect(sessionRow(page, E2E_SESSION_ID)).toHaveClass(/selected/)

    await openSessionMenu(page, E2E_SESSION_ID)
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['Unpin']))
    await chooseNativeMenu(page, 'Unpin')
    await expect(page.locator('.conv-pinned-section')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('Delete of an empty session selects the remaining row', async () => {
  const harness = await launchVav({ extraSession: true })
  try {
    const { page } = harness
    await openSessionMenu(page, E2E_SESSION_ID)
    await chooseNativeMenu(page, 'Delete')

    await expect(sessionRow(page, E2E_SESSION_ID)).toHaveCount(0)
    await expect(sessionRow(page, E2E_SESSION_B_ID)).toHaveClass(/selected/)
  } finally {
    await harness.dispose()
  }
})

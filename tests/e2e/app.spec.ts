import { expect, test } from '@playwright/test';

test('empty state, examples, filtering, search, view switching and category assignment', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await expect(page.getByText('下一次复制，从这里开始')).toBeVisible();
  await page.getByRole('button', { name: '体验示例' }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(9);
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true });
  await page.getByRole('button', { name: /^链接\s*2$/ }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(2);
  await page.getByRole('button', { name: /^所有记录\s*9$/ }).click();
  await page.getByRole('textbox', { name: '搜索历史记录' }).fill('const ideas');
  await expect(page.getByTestId('entry-card')).toHaveCount(1);
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.entries')).toHaveClass('entries list');
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.getByRole('button', { name: '新建分类' }).click();
  await page.getByLabel('分类名称', { exact: true }).fill('翻译素材');
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await page.getByRole('button', { name: '查看：Design is how it feels.' }).click();
  await page.getByLabel('收纳到分类', { exact: true }).selectOption({ label: '翻译素材' });
  await page.getByRole('button', { name: /^翻译素材\s*1$/ }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(1);
  await page.reload(); await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await page.getByRole('button', { name: /^翻译素材\s*1$/ }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('copy writes the selected text to the actual browser clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/'); await page.getByRole('button', { name: '管理记录', exact: true }).click(); await page.getByRole('button', { name: '体验示例' }).click();
  await page.getByRole('button', { name: '查看：Design is how it feels.' }).click();
  await page.getByRole('button', { name: /^复制内容/ }).click();
  await expect(page.getByRole('status')).toContainText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Design is how it feels.');
});

test('settings records shortcut and clear keeps pinned entries by default', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '管理记录', exact: true }).click(); await page.getByRole('button', { name: '体验示例' }).click();
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  const recorder = page.getByRole('button', { name: '录制全局快捷键' });
  await recorder.click(); await recorder.press('Control+Alt+P');
  await expect(recorder).toContainText('Alt'); await expect(recorder).toContainText('P');
  await page.getByLabel('历史记录容量').selectOption('500');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('status')).toContainText('设置已保存');
  await page.getByLabel('更多操作').click(); await page.getByRole('button', { name: '清理历史记录', exact: true }).click();
  await page.getByRole('button', { name: '确认清理' }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(2);
  await page.getByRole('button', { name: /^置顶收藏\s*2$/ }).click();
  await expect(page.getByTestId('entry-card')).toHaveCount(2);
});

test('AI configuration explains provider privacy and never persists a preview key', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '管理记录', exact: true }).click(); await page.getByRole('button', { name: '体验示例' }).click();
  await page.getByRole('button', { name: '设置 AI 翻译' }).click();
  await expect(page.getByLabel('API 服务地址')).toHaveValue('https://api.openai.com/v1');
  await expect(page.getByText('当前环境仅在本次会话保存密钥')).toBeVisible();
  await page.getByLabel('API 密钥', { exact: true }).fill('preview-test-key');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByRole('alert')).toContainText('浏览器预览不会保存密钥');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('preview-test-key');
});

test('small-screen preview stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('button', { name: '管理记录', exact: true }).click(); await page.getByRole('button', { name: '体验示例' }).click();
  await expect(page.getByTestId('entry-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: '查看：Design is how it feels.' }).click();
  await expect(page.getByTestId('original-content')).toBeVisible();
  await expect(page.getByRole('button', { name: '翻译这段内容' })).toBeVisible();
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByTestId('original-content')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});


test('compact first, management and settings open explicitly, unlimited capacity and image opt-in', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 400, height: 580 });
  await page.goto('/');
  await expect(page.getByTestId('compact-board')).toBeVisible();
  await expect(page.getByText('历史无限条', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '所有记录' })).not.toBeVisible();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '偏好设置' })).toBeVisible();
  await expect(page.getByLabel('历史记录容量')).toHaveValue('0');
  await expect(page.getByRole('switch', { name: '记录图片', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('switch', { name: '记录图片', exact: true }).click();
  await page.getByLabel('历史记录容量').selectOption('custom');
  await page.getByLabel('自定义历史条数').fill('15000');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByTestId('compact-board')).toBeVisible();
  await expect(page.getByText('容量 15000 条')).toBeVisible();
  await page.getByRole('button', { name: '体验示例' }).click();
  await expect(page.getByTestId('compact-record')).toHaveCount(7);
  await page.screenshot({ path: 'test-results/compact.png' });
  await page.getByRole('button', { name: '复制：Design is how it feels.' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Design is how it feels.');
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '所有记录' })).toBeVisible();
  await page.getByRole('button', { name: '返回小窗口' }).click();
  await expect(page.getByTestId('compact-board')).toBeVisible();
});


test('Win11 popup translates with the supplied dictionary without an API and copies its translation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('bread'));
  await page.getByRole('button', { name: '捕获剪贴板', exact: true }).click();
  await page.getByRole('button', { name: '返回小窗口', exact: true }).click();
  await page.getByRole('button', { name: '翻译：bread', exact: true }).click();
  await expect(page.getByTestId('inline-translation')).toContainText('面包');
  await expect(page.getByTestId('inline-translation')).toContainText('本地词库');
  await page.getByRole('button', { name: '粘贴译文', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('面包');
  await page.getByTestId('compact-board').screenshot({ path: 'test-results/win11-popup.png' });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.locator('.fluent-settings-nav')).toBeVisible();
  await page.getByRole('button', { name: '翻译与词库', exact: true }).click();
  await expect(page.getByLabel('翻译方式')).toHaveValue('auto');
  await expect(page.getByText('32,159 条六向查询记录 · 离线可用')).toBeVisible();
  await page.screenshot({ path: 'test-results/win11-settings.png', fullPage: true });
});

test('Win11 manager and settings keep the same aligned search field', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '管理记录', exact: true }).click();
  await page.getByRole('button', { name: '体验示例', exact: true }).click();
  await expect(page.getByRole('heading', { name: '所有记录' })).toBeVisible();
  const managerSearch = await page.getByRole('textbox', { name: '搜索历史记录' }).boundingBox();
  await page.screenshot({ path: 'test-results/win11-manager.png' });
  await page.getByRole('textbox', { name: '搜索历史记录' }).fill('const ideas');
  await expect(page.getByTestId('entry-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await page.getByRole('button', { name: /^偏好设置/ }).click();
  const settingsSearch = page.getByRole('textbox', { name: '搜索设置' });
  const settingsBounds = await settingsSearch.boundingBox();
  expect(settingsBounds!.x).toBeCloseTo(managerSearch!.x, 0);
  expect(settingsBounds!.y).toBeCloseTo(managerSearch!.y, 0);
  expect(settingsBounds!.width).toBeCloseTo(managerSearch!.width, 0);
  const container = await page.locator('.fluent-window-search').boundingBox();
  const icon = await page.locator('.fluent-window-search > svg').boundingBox();
  expect(Math.abs(settingsBounds!.y + settingsBounds!.height / 2 - container!.y - container!.height / 2)).toBeLessThan(1);
  expect(Math.abs(icon!.y + icon!.height / 2 - container!.y - container!.height / 2)).toBeLessThan(1);
  await settingsSearch.fill('API');
  await expect(page.getByRole('heading', { name: '翻译与词库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空设置搜索' }).click();
  await page.screenshot({ path: 'test-results/win11-settings-aligned.png' });
});

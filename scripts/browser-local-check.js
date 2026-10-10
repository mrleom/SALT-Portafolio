// Run with Playwright CLI run-code --filename scripts/browser-local-check.js.
// Checks only the local fake-auth demo in the browser's current localhost origin.
async (page) => {
  const origin = page.url().split('/').slice(0, 3).join('/');
  if (!origin.startsWith('http://localhost:')) throw new Error('Local demo only');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const clickApi = async (button, path, expected) => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().split('?')[0] === origin + '/api' + path),
      page.getByRole('button', { name: button, exact: true }).click(),
    ]);
    check(response.status() === expected, button + ': wrong HTTP status');
  };
  if (await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(origin + '/protected');
  await page.getByRole('heading', { name: 'Sign in to open this page' }).waitFor();
  check(await page.getByRole('heading', { name: 'Access granted by the backend' }).count() === 0, 'Signed-out data exposed');
  console.log('PASS signed-out direct /protected navigation');

  for (const group of ['Employee', 'Technician', 'Manager', 'Administrator', 'Auditor']) {
    await page.getByRole('combobox', { name: 'Demo group' }).selectOption(group);
    await page.getByRole('button', { name: 'Start local demo' }).click();
    await page.getByRole('heading', { name: 'Access granted by the backend' }).waitFor();
    check(await page.locator('dd').getByText(group, { exact: true }).isVisible(), 'Wrong group displayed');
    await clickApi('Call protected API', '/demo', 200);
    const admin = group === 'Administrator';
    await clickApi(admin ? 'Open admin demo' : 'Test denied admin request', '/admin', admin ? 200 : 403);
    if (!admin) await page.getByRole('alert').filter({ hasText: 'Your group does not have permission' }).waitFor();
    if (admin) {
      await page.getByRole('status').filter({ hasText: 'The backend verified Administrator membership.' }).waitFor();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: 'output/playwright/local-admin-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
      await page.screenshot({ path: 'output/playwright/local-admin-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.reload();
    await page.getByRole('heading', { name: 'Access granted by the backend' }).waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Start local demo' }).waitFor();
    await page.goto(origin + '/protected');
    await page.getByRole('heading', { name: 'Sign in to open this page' }).waitFor();
    console.log('PASS ' + group + ': protected API, role restriction, reload, logout, direct navigation');
  }
  await page.getByRole('combobox', { name: 'Demo group' }).selectOption('Employee');
  await page.getByRole('button', { name: 'Start local demo' }).click();
  await page.getByRole('heading', { name: 'Access granted by the backend' }).waitFor();
  await page.context().clearCookies();
  await clickApi('Call protected API', '/demo', 401);
  await page.getByRole('heading', { name: 'Sign in to open this page' }).waitFor();
  check(await page.getByRole('heading', { name: 'Access granted by the backend' }).count() === 0, '401 did not clear protected view');
  check(errors.length === 0, 'Browser JavaScript errors: ' + errors.join('; '));
  console.log('PASS local session loss clears protected view; no JavaScript page errors; mobile fits viewport');
}

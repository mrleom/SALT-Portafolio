// Local, synthetic demo only. Run using Playwright CLI run-code --filename.
// Start a fresh dev server first: test:local creates extra synthetic assets.
async (page) => {
  const origin = page.url().split('/').slice(0, 3).join('/');
  if (!origin.startsWith('http://localhost:')) throw new Error('Local demo only');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  if (await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(origin + '/depreciation');
  await page.getByRole('heading', { name: 'Sign in to open this page' }).waitFor();
  check(await page.getByRole('table').count() === 0, 'Signed-out portfolio exposed');
  console.log('PASS signed-out direct depreciation route');

  for (const [role, count] of [['Employee', 3], ['Technician', 10], ['Manager', 4], ['Administrator', 10], ['Auditor', 10]]) {
    await page.getByRole('combobox', { name: 'Demo group' }).selectOption(role);
    await page.getByRole('button', { name: 'Start local demo' }).click();
    await page.getByRole('heading', { name: 'Depreciation intelligence.' }).waitFor();
    await page.getByRole('status').filter({ hasText: `${count} of ${count} assets` }).waitFor();
    check(await page.locator('tbody tr').count() === count, role + ' financial scope');
    check(await nav.getByRole('button', { name: 'Users', exact: true }).count() === (role === 'Administrator' ? 1 : 0), 'Admin navigation');
    const creates = ['Administrator', 'Technician'].includes(role);
    check(await nav.getByRole('button', { name: 'Register asset', exact: true }).count() === (creates ? 1 : 0), 'Create navigation');
    await nav.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('heading', { name: 'Every asset. One clear picture.' }).waitFor();
    await nav.getByRole('button', { name: 'Depreciation', exact: true }).click();
    await page.getByRole('status').filter({ hasText: `${count} of ${count} assets` }).waitFor();
    if (role === 'Administrator') {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: 'output/playwright/depreciation-desktop.png', fullPage: true });
      console.log('First row:', await page.locator('tbody tr').first().innerText());
      await page.getByRole('spinbutton', { name: 'Retained-value threshold (%)' }).fill('0');
      await page.getByRole('heading', { name: 'No assets match these filters' }).waitFor();
      check(await page.getByRole('button', { name: 'Export filtered CSV' }).isDisabled(), 'Empty export allowed');
      await page.getByRole('spinbutton', { name: 'Retained-value threshold (%)' }).fill('101');
      await page.getByRole('alert').filter({ hasText: 'Enter a threshold from 0 to 100.' }).waitFor();
      await page.getByRole('checkbox', { name: 'Show all permitted assets' }).check();
      await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('Laptop');
      check(await page.locator('tbody tr').count() === 2, 'Category filter');
      await page.getByRole('textbox', { name: 'Search', exact: true }).fill('LAP-001');
      check(await page.locator('tbody tr').count() === 1, 'Search filter');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export filtered CSV' }).click();
      const download = await downloadPromise;
      check(download.suggestedFilename() === 'salt-depreciation.csv', 'Download filename');
      await download.saveAs('output/playwright/filtered-depreciation.csv');
      await page.getByRole('button', { name: 'LAP-001', exact: true }).click();
      await page.getByRole('heading', { name: /LAP-001/ }).waitFor();
      await nav.getByRole('button', { name: 'Depreciation', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '10 of 10 assets' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: 'output/playwright/depreciation-mobile.png', fullPage: true });
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.table-wrap') && !e.closest('nav')).map(e => [e.tagName, e.className, e.getBoundingClientRect().width]));
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Depreciation mobile overflow: ' + JSON.stringify(overflow));
      await nav.getByRole('button', { name: 'Overview', exact: true }).click();
      await page.getByRole('heading', { name: 'Every asset. One clear picture.' }).waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Dashboard mobile overflow');
      await page.screenshot({ path: 'output/playwright/overview-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: 'output/playwright/overview-desktop.png', fullPage: true });
      await nav.getByRole('button', { name: 'Assets', exact: true }).click();
      await page.getByRole('heading', { name: 'Asset records' }).waitFor();
      await nav.getByRole('button', { name: 'Register asset', exact: true }).click();
      await page.getByRole('heading', { name: 'Register an asset' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Registration mobile overflow');
      await page.screenshot({ path: 'output/playwright/register-mobile.png', fullPage: true });
      await nav.getByRole('button', { name: 'Reports', exact: true }).click();
      await page.getByRole('heading', { name: 'Problem reports' }).waitFor();
      await nav.getByRole('button', { name: 'Users', exact: true }).click();
      await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto(origin + '/depreciation');
    await page.getByRole('button', { name: 'Start local demo' }).waitFor();
    console.log('PASS ' + role + ': permitted financial scope, navigation, dashboard, logout');
  }
  check(errors.length === 0, 'JavaScript page errors: ' + errors.join('; '));
  console.log('PASS thresholds, filters, export, asset links, mobile layout, no JavaScript page errors');
}

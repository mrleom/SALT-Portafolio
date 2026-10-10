// Run against the LOCAL preview of the fixture AWS-mode build only.
async (page) => {
  if (!page.url().startsWith('http://localhost:')) throw new Error('Local preview only');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (await page.getByRole('combobox', { name: 'Demo group' }).count()) throw new Error('Mock role picker in AWS build');
  const signIn = page.getByRole('button', { name: 'Sign in with Cognito' });
  await signIn.waitFor();
  await signIn.click();
  await page.waitForTimeout(1500);
  if (await page.getByRole('heading', { name: 'Access granted by the backend' }).count())
    throw new Error('AWS mode granted access without a Cognito session');
  await page.screenshot({ path: 'output/playwright/aws-placeholder.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS AWS-mode fixture: no role picker, Cognito sign-in control, no granted access, no JavaScript page errors');
}

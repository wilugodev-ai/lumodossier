import { test, expect, type Page, type Browser } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { samplePdf } from '../sample-pdf';

async function account(page: Page) {
  const email = 'sender-' + randomUUID() + '@example.invalid',
    password = 'Local-' + randomUUID();
  await page.goto('/login?mode=signup');
  await page.getByLabel('Full name').fill('Test Sender');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { email, password };
}
async function upload(page: Page, title: string) {
  await page
    .getByLabel('Choose PDF', { exact: true })
    .setInputFiles({ name: title + '.pdf', mimeType: 'application/pdf', buffer: await samplePdf() });
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients and routing' })).toBeVisible();
}
async function share(page: Page, name: string) {
  await page
    .locator('.track-person')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Create sharing link' })
    .click();
  const url = await page
    .getByRole('textbox', { name: 'Private recipient link for ' + name })
    .inputValue();
  await page.getByRole('button', { name: 'Hide link' }).click();
  return url;
}
async function fillRecipient(browser: Browser, url: string, name: string, draw = false) {
  const context = await browser.newContext(),
    p = await context.newPage();
  await p.goto(url);
  await expect(p.getByRole('heading', { name: 'Your fields' })).toBeVisible();
  if (draw) {
    await p.getByRole('button', { name: 'Draw', exact: true }).click();
    const pad = await p.getByRole('img', { name: 'Draw your signature here' }).boundingBox();
    expect(pad).toBeTruthy();
    const { x, y, width: w, height: h } = pad!;
    await p.mouse.move(x + w * 0.1, y + h * 0.7);
    await p.mouse.down();
    await p.mouse.move(x + w * 0.32, y + h * 0.24, { steps: 8 });
    await p.mouse.move(x + w * 0.55, y + h * 0.75, { steps: 8 });
    await p.mouse.move(x + w * 0.83, y + h * 0.38, { steps: 8 });
    await p.mouse.up();
  } else await p.getByPlaceholder('Type your full name').fill(name);
  await p.getByRole('checkbox', { name: /I consent/ }).check();
  await p.getByRole('checkbox', { name: /I have reviewed/ }).check();
  await p.getByRole('button', { name: 'Confirm and sign' }).click();
  await expect(
    p.getByRole('heading', { name: /Your signature is recorded|Your copy is ready/ }),
  ).toBeVisible();
  return { p, context };
}
test('landing and mobile navigation fit the viewport', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign. Send.Keep everythingmoving.');
  await page.getByRole('button', { name: 'Pause background motion' }).click();
  await expect(page.getByRole('button', { name: 'Play background motion' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('landing-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('landing-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Explore the workflow' }).click();
  await expect(page).toHaveURL(/#workflow$/);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
test('disposable sender prepares, resumes and sends a PDF; two account-free recipients sign and download the verified final copy', async ({
  page,
  browser,
}, info) => {
  const user = await account(page);
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name: 'Create workspace' })
    .click();
  await page.getByLabel('Workspace name').fill('Studio workspace');
  await page.locator('form').getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Your document shelf is empty')).toBeVisible();
  await page.getByRole('button', { name: 'New request' }).click();
  await upload(page, 'Studio agreement');
  for (const [i, name] of ['Ada Hart', 'Lin Vale'].entries()) {
    await page.getByRole('button', { name: 'Add recipient' }).click();
    await page.getByLabel('Recipient ' + (i + 1) + ' name').fill(name);
    await page
      .getByLabel('Recipient ' + (i + 1) + ' email')
      .fill((i ? 'lin' : 'ada') + '@example.invalid');
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await expect(page.getByLabel('Recipient 2 name')).toHaveValue('Lin Vale');
  await page.getByRole('button', { name: 'Continue to fields' }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByRole('button', { name: 'Select Signature' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('field-editor.png') });
  await page.getByText('Position and size').click();
  await page.getByLabel('Top percent').fill('65');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByLabel('Assign to').selectOption({ label: 'Lin Vale' });
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipient progress' })).toBeVisible();
  await expect(page.locator('.track-person').first()).toContainText('Email not sent');
  const first = await fillRecipient(browser, await share(page, 'Ada Hart'), 'Ada Hart');
  await expect(page.locator('.status')).toHaveText('Partially signed');
  const second = await fillRecipient(browser, await share(page, 'Lin Vale'), 'Lin Vale', true);
  await expect(second.p.getByRole('heading', { name: 'Your copy is ready.' })).toBeVisible();
  await expect(page.locator('.status')).toHaveText('Completed');
  await page.screenshot({ path: info.outputPath('completed-dashboard.png') });
  const copyEvent = second.p.waitForEvent('download');
  await second.p.getByRole('button', { name: 'Download signed PDF' }).click();
  const bytes = await readFile((await (await copyEvent).path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const recordEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Completion record' }).click();
  const record = JSON.parse(await readFile((await (await recordEvent).path())!, 'utf8'));
  expect(record.completedSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(record.recipients.map((r: { name: string }) => r.name)).toEqual(['Ada Hart', 'Lin Vale']);
  await first.context.close();
  await second.context.close();
  const back = page.url();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3029/');
  await page.goto(back);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('Completed');
});
test('connected customer view prefills a request and tracks the same completion as the sender', async ({
  page,
  browser,
}) => {
  await account(page);
  const path =
    '/touchlumo?workspace=7900f3d7-c514-4981-bfde-39276ad914ea&customer=c06c78ed-2f82-4e5b-9431-f462f32935c7';
  await page.goto(path);
  await page.getByRole('link', { name: 'New signature request' }).click();
  await upload(page, 'Customer approval');
  await expect(page.getByLabel('Recipient 1 name')).toHaveValue('Customer One');
  await page.getByRole('button', { name: 'Continue to fields' }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  const signer = await fillRecipient(browser, await share(page, 'Customer One'), 'Customer One');
  await expect(page.locator('.status')).toHaveText('Completed');
  await page.goto(path);
  await expect(page.getByRole('listitem').filter({ hasText: 'Customer approval' })).toContainText(
    'Completed',
  );
  const d = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download signed PDF' }).click();
  expect((await d).suggestedFilename()).toBe('LumoDossier-signed.pdf');
  await signer.context.close();
});

import { test, expect, type Page, type Browser } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { samplePdf } from '../sample-pdf';
import { recoveryMailbox, recoveryLink } from './recovery-mail';

async function account(
  page: Page,
  name = 'Test Sender',
  email = 'sender-' + randomUUID() + '@example.invalid',
) {
  const password = 'Local-' + randomUUID();
  await page.goto('/login?mode=signup');
  await page.getByLabel('Full name').fill(name);
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
async function fillRecipient(
  browser: Browser,
  url: string,
  name: string,
  {
    draw = false,
    reference = false,
    screenshot,
  }: { draw?: boolean; reference?: boolean; screenshot?: string } = {},
) {
  const context = await browser.newContext(),
    p = await context.newPage();
  await p.goto(url);
  await expect(p.getByRole('heading', { name: 'Your fields' })).toBeVisible();
  const total = reference ? 2 : 1;
  const confirm = p.getByRole('button', { name: 'Confirm and sign' });
  await expect(p.getByText('0 of ' + total + ' required fields complete')).toBeVisible();
  await p.getByRole('checkbox', { name: /I consent/ }).check();
  await p.getByRole('checkbox', { name: /I have reviewed/ }).check();
  await expect(confirm).toBeDisabled();
  await p.getByRole('checkbox', { name: /I have reviewed/ }).uncheck();
  await p.getByRole('button', { name: /Go to Signature on page/ }).click();
  await expect(p.getByPlaceholder('Type your full name')).toBeFocused();
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
    await expect(p.locator('.sign-field.filled polyline').first()).toBeAttached();
  } else {
    await p.getByPlaceholder('Type your full name').fill('   ');
    await expect(p.getByText('0 of ' + total + ' required fields complete')).toBeVisible();
    await p.getByPlaceholder('Type your full name').fill(name);
  }
  if (reference) {
    await expect(p.getByText('1 of 2 required fields complete')).toBeVisible();
    if (screenshot) await p.screenshot({ path: screenshot });
    await p.getByRole('button', { name: 'Go to Project reference on page 2' }).click();
    const input = p.getByRole('textbox', { name: /Project reference/ });
    await expect(input).toBeFocused();
    await expect(p.getByText('Page 2 of 2', { exact: true })).toBeVisible();
    await input.fill('Studio 17');
    await input.clear();
    await expect(p.getByText('1 of 2 required fields complete')).toBeVisible();
    await input.fill('Studio 17');
  }
  await p.getByRole('button', { name: 'Review and sign', exact: true }).click();
  await expect(p.getByRole('checkbox', { name: /I consent/ })).toBeFocused();
  await expect(confirm).toBeDisabled();
  await p.getByRole('checkbox', { name: /I consent/ }).check();
  await p.getByRole('checkbox', { name: /I have reviewed/ }).check();
  await p.getByRole('button', { name: 'Confirm and sign' }).click();
  await expect(
    p.getByRole('heading', { name: /Your signature is recorded|Your copy is ready/ }),
  ).toBeVisible();
  return { p, context };
}
test('one home screen fits desktop and mobile and opens both account dialogs', async ({
  page,
}, info) => {
  const alias = await page.request.get('/sign?view=receipt', {
    headers: { Host: 'www.lumodossier.com' },
    maxRedirects: 0,
  });
  expect(alias.status()).toBe(308);
  expect(alias.headers().location).toBe('https://lumodossier.com/sign?view=receipt');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign. Send.Keep everythingmoving.');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Pause background motion' }).click();
  await expect(page.getByRole('button', { name: 'Play background motion' })).toBeVisible();
  const fits = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth <= root.clientWidth && root.scrollHeight <= root.clientHeight + 1;
    });
  expect(await fits()).toBe(true);
  await page.screenshot({ path: info.outputPath('landing-desktop.png') });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 667, height: 375 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(fits).toBe(true);
    await expect(page.getByRole('link', { name: 'Create account', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.screenshot({ path: info.outputPath('landing-mobile.png') });
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Create an account' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/\?account=signup$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page).toHaveURL(/\/\?account=signin$/);
  await page.screenshot({ path: info.outputPath('mobile-sign-in.png') });
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:3029/');
});
test('a workspace owner manages an email-matched invitation and member access from one home page', async ({
  page,
  browser,
}, info) => {
  const owner = await account(page, 'Jordan Ellis', 'jordan.ellis@example.invalid');
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name: 'Create workspace' })
    .click();
  await page.getByLabel('Workspace name').fill('Studio team');
  await page.locator('form').getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Your document shelf is empty')).toBeVisible();
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  const email = 'case.reader@example.invalid',
    password = 'Reader-' + randomUUID();
  await page.getByLabel('Teammate email').fill(email);
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const url = await page.getByLabel('Private team invitation').inputValue();
  await page.getByRole('button', { name: 'Hide invitation link' }).click();
  const other = await browser.newContext(),
    reader = await other.newPage();
  try {
    await reader.goto(url);
    await reader.getByRole('button', { name: 'Create an account' }).click();
    await reader.getByLabel('Full name').fill('Case Reader');
    await reader.getByLabel('Email address').fill(email);
    await reader.getByLabel('Password', { exact: true }).fill(password);
    await reader.getByRole('button', { name: 'Create account', exact: true }).click();
    await reader.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(reader.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    await expect(reader.getByText('Case Reader', { exact: true })).toBeVisible();
    await expect(reader.getByLabel('Teammate email')).toHaveCount(0);
    await reader.getByRole('button', { name: 'All documents', exact: true }).click();
    await expect(reader.getByText('Your document shelf is empty')).toBeVisible();
    await expect(reader.getByRole('button', { name: 'New request' })).toHaveCount(0);
    await page.reload();
    await page.getByLabel('Role for ' + email).selectOption('member');
    await expect(page.getByRole('status')).toHaveText('Workspace role updated.');
    await reader.reload();
    await expect(reader.getByRole('button', { name: 'New request' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('workspace-team.png') });
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm removal' }).click();
    await expect(page.getByRole('status')).toHaveText('Workspace access removed.');
    await reader.reload();
    await expect(reader.getByText('This workspace is unavailable to your account.')).toBeVisible();
  } finally {
    await other.close();
  }
  await page.getByRole('button', { name: 'Your account' }).click();
  await page.getByLabel('Current password', { exact: true }).fill('incorrect-password');
  const changed = 'Updated-' + randomUUID();
  await page.getByLabel('New password', { exact: true }).fill(changed);
  await page.getByLabel('Confirm new password', { exact: true }).fill(changed);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.locator('form').getByRole('alert')).toHaveText(
    'Your current password could not be verified.',
  );
  await page.getByLabel('Current password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('status')).toHaveText('Your password was updated.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email address').fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(changed);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Your account' })).toBeVisible();
  const otherTab = await page.context().newPage();
  await otherTab.goto('/dashboard');
  await expect(otherTab.getByRole('button', { name: 'Your account' })).toBeVisible();
  await otherTab.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('lumodossier:last-activity:'));
    if (!key) throw Error('Missing session activity timestamp.');
    localStorage.setItem(key, String(Date.now() - 31 * 60_000));
  });
  await expect(page).toHaveURL(/account=signin/);
  await expect(page.getByText('Your session ended after 30 minutes of inactivity.')).toBeVisible();
  await otherTab.close();
});
test('a disposable sender resets a password from a real Supabase recovery email captured on loopback', async ({
  page,
}) => {
  test.skip(!process.env.LUMO_GOTRUE_BINARY, 'Requires a real local Supabase Auth binary.');
  const user = await account(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  const mailbox = await recoveryMailbox(Number(process.env.LUMO_TEST_SMTP_PORT), user.email);
  try {
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email address').fill(user.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('check its inbox');
    await page.goto(recoveryLink(await mailbox.mail));
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    const password = 'Recovered-' + randomUUID();
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByLabel('Confirm new password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('status')).toContainText('Your password was updated.');
    await page.getByRole('link', { name: 'Open your workspace' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Your account' })).toBeVisible();
  } finally {
    await mailbox.close();
  }
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
  await page.getByLabel('Field type').selectOption('text');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('Label', { exact: true }).fill('Project reference');
  await page.getByLabel('Field type').selectOption('signature');
  await page.getByLabel('Assign to').selectOption({ label: 'Lin Vale' });
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipient progress' })).toBeVisible();
  await expect(page.locator('.track-person').first()).toContainText('Email not sent');
  const first = await fillRecipient(browser, await share(page, 'Ada Hart'), 'Ada Hart', {
    reference: true,
    screenshot: info.outputPath('guided-signing.png'),
  });
  await expect(page.locator('.status')).toHaveText('Partially signed');
  const second = await fillRecipient(browser, await share(page, 'Lin Vale'), 'Lin Vale', { draw: true });
  await expect(second.p.getByRole('heading', { name: 'Your copy is ready.' })).toBeVisible();
  await expect(page.locator('.status')).toHaveText('Completed');
  await page.screenshot({ path: info.outputPath('completed-dashboard.png') });
  const copyEvent = second.p.waitForEvent('download');
  await second.p.getByRole('button', { name: 'Download signed PDF' }).click();
  const bytes = await readFile((await (await copyEvent).path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(second.p.getByText('Signature recorded', { exact: true })).toBeVisible();
  for (const room of [second.p, page]) {
    await room.getByText('Verify a signed copy', { exact: true }).click();
    const picker = room.getByLabel('Choose a signed PDF');
    await picker.setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(room.getByText(/^Exact match\./)).toBeVisible();
    const modified = Buffer.from(bytes);
    modified[modified.length - 1] ^= 1;
    await picker.setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: modified });
    await expect(room.getByText(/^Different file\./)).toBeVisible();
  }
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

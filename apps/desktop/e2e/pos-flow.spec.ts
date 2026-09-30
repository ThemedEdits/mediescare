import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * The first real path through the product, in the packaged app and through its real window:
 * setup -> recovery key -> sign in -> create item -> receive stock -> open shift -> sell by
 * scanner and by keyboard -> stock and sales reflect it. All names and numbers are invented.
 */
const exe =
  process.env.MEDIESCARE_EXE ??
  join(__dirname, '..', '..', '..', 'release', 'win-unpacked', 'Mediescare.exe');
const PASSWORD = 'e2e-Password-Strong-77';
const BARCODE = '8961001234567';

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'mediescare-e2e-'));
  mkdirSync(userData, { recursive: true });
  // Skip the first-run wizard window: pick "Single PC" on a free port.
  writeFileSync(
    join(userData, 'config.json'),
    JSON.stringify({ mode: 'single', port: 3450 + Math.floor(Math.random() * 40) }),
  );
  const env = { ...process.env, MEDIESCARE_USER_DATA: userData } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: exe, env });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

const total = (p: Page) => p.getByTestId('grand-total');

test('set up, stock an item, and sell it through the real POS', async () => {
  // --- first-run setup ---
  await page.waitForURL(/\/setup/, { timeout: 90_000 });
  await page.getByLabel('Organisation name').fill('E2E Pharmacy Group');
  await page.getByLabel('Branch code').fill('E2E01');
  await page.getByLabel('Branch name').fill('E2E Branch');
  await page.getByLabel('Your full name').fill('E2E Owner');
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password (10+ characters)').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create and continue' }).click();

  const key = page.getByTestId('recovery-key');
  await expect(key).toBeVisible();
  await expect(key).toHaveText(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  const continueButton = page.getByRole('button', { name: 'Continue to sign in' });
  await expect(continueButton).toBeDisabled(); // cannot continue before confirming the key was saved
  await page.getByLabel('I have saved this recovery key in a safe place.').check();
  await continueButton.click();

  // --- sign in ---
  await page.waitForURL(/\/login/);
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByText('Sync queue')).toBeVisible();

  // --- create an item ---
  await page.getByRole('link', { name: 'Items' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Name', { exact: true }).fill('E2E Paracetamol 500mg');
  await page.getByLabel('Generic name').fill('Paracetamol');
  await page.getByLabel('Barcodes (comma separated)').fill(BARCODE);
  await page.getByLabel('Selling price').fill('25');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('cell', { name: /E2E Paracetamol 500mg/ })).toBeVisible();

  // --- receive stock: 50 strips (500 tablets) ---
  await page.getByRole('link', { name: 'Stock' }).click();
  await page.getByRole('button', { name: 'Add stock' }).click();
  await page.getByRole('button', { name: '+', exact: true }).first().click(); // quick-add supplier
  await page.getByLabel('Supplier name').fill('E2E Distributor');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Supplier', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Add item').fill('E2E Para');
  await page.getByRole('button', { name: /E2E Paracetamol 500mg/ }).click();
  await page.getByLabel('Quantity', { exact: true }).fill('50');
  await page.getByLabel('Batch number').fill('E2E-B1');
  await page.getByLabel('Expiry date').fill('2029-12-31');
  await page.getByLabel('Price per unit').fill('18');
  await expect(page.getByTestId('grn-total')).toHaveText('PKR 900.00');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status')).toContainText('Stock received: E2E01-GRN-000001');
  await expect(page.getByRole('row', { name: /E2E Paracetamol 500mg/ })).toContainText('500');

  // --- open shift ---
  await page.getByRole('link', { name: 'POS' }).click();
  await expect(page.getByRole('heading', { name: 'Open your shift' })).toBeVisible();
  await page.getByLabel('Opening cash (PKR)').fill('5000');
  await page.getByRole('button', { name: 'Open shift' }).click();
  const search = page.getByLabel('Search item or scan barcode');
  await expect(search).toBeFocused();

  // --- sale 1: barcode scan (digits + Enter), exact cash with F9, save with F10 ---
  await search.fill(BARCODE);
  await search.press('Enter');
  await expect(page.getByRole('row', { name: /E2E Paracetamol 500mg/ })).toBeVisible();
  await expect(total(page)).toHaveText('25.00');
  await page.keyboard.press('F9');
  await expect(page.getByTestId('due')).toHaveText('0.00');
  await page.keyboard.press('F10');
  await expect(page.getByRole('dialog', { name: /Saved E2E01-INV-000001/ })).toBeVisible();
  await page.getByRole('button', { name: 'New sale' }).click();

  // --- sale 2: typed search, two strips by keyboard, more cash given, change shown ---
  await expect(search).toBeFocused();
  await search.fill('para');
  await expect(page.getByRole('option').first()).toContainText('E2E Paracetamol 500mg');
  await search.press('Enter');
  await page.keyboard.press('Control+ArrowUp'); // quantity 1 -> 2
  await expect(total(page)).toHaveText('50.00');
  await page.getByRole('button', { name: '+ Add payment' }).click();
  await page.getByLabel('Amount received').fill('100');
  await expect(page.getByTestId('change')).toHaveText('50.00');
  await page.keyboard.press('F10');
  const saved = page.getByRole('dialog', { name: /Saved E2E01-INV-000002/ });
  await expect(saved).toBeVisible();
  await expect(saved.getByTestId('change-due')).toHaveText('50.00');
  await saved.getByRole('button', { name: 'New sale' }).click();

  // --- results: sales list and stock reflect both sales (500 - 10 - 20 = 470 tablets) ---
  await page.getByRole('link', { name: 'Sales' }).click();
  await expect(page.getByRole('row', { name: /E2E01-INV-000001/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E01-INV-000002/ })).toBeVisible();
  await page.getByRole('link', { name: 'Stock' }).click();
  await expect(page.getByRole('row', { name: /E2E Paracetamol 500mg/ })).toContainText('470');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('PKR 75.00')).toBeVisible(); // sales today: 25 + 50
});

// #446: the app's dropdowns are design-system comboboxes (a button opening a
// listbox), not native <select>s, so a journey picks a value by clicking the
// field and then the option — selectOption has nothing to talk to any more.
import type { Locator, Page } from '@playwright/test';

/** Open a dropdown (by its accessible name, or any locator that resolves to
 * the combobox button) and choose the option whose accessible name matches. */
export async function pickOption(page: Page, field: string | Locator, option: string | RegExp): Promise<void> {
  const combobox = typeof field === 'string' ? page.getByRole('combobox', { name: field, exact: true }) : field;
  await combobox.click();
  await page.getByRole('option', { name: option }).click();
}

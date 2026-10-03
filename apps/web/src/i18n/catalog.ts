import en from './en.json';
import ur from './ur.json';
import enPos from './screens/pos.en.json';
import urPos from './screens/pos.ur.json';
import enSalesItems from './screens/salesItems.en.json';
import urSalesItems from './screens/salesItems.ur.json';
import enStock from './screens/stock.en.json';
import urStock from './screens/stock.ur.json';
import enPurchasing from './screens/purchasing.en.json';
import urPurchasing from './screens/purchasing.ur.json';
import enTransfers from './screens/transfers.en.json';
import urTransfers from './screens/transfers.ur.json';
import enReports from './screens/reports.en.json';
import urReports from './screens/reports.ur.json';
import enUsersRoles from './screens/usersRoles.en.json';
import urUsersRoles from './screens/usersRoles.ur.json';
import enSystem from './screens/system.en.json';
import urSystem from './screens/system.ur.json';
import enAccounts from './screens/accounts.en.json';
import urAccounts from './screens/accounts.ur.json';
import { flatten, type FlatMessages, type Messages } from './core';

/** Every message file of a language; the top-level namespaces of the files must not overlap. */
export const EN_FILES: Messages[] = [
  en,
  enPos,
  enSalesItems,
  enStock,
  enPurchasing,
  enTransfers,
  enReports,
  enUsersRoles,
  enSystem,
  enAccounts,
] as Messages[];

export const UR_FILES: Messages[] = [
  ur,
  urPos,
  urSalesItems,
  urStock,
  urPurchasing,
  urTransfers,
  urReports,
  urUsersRoles,
  urSystem,
  urAccounts,
] as Messages[];

export function flattenAll(files: Messages[]): FlatMessages {
  return Object.assign({}, ...files.map((f) => flatten(f)));
}

export const flatEn = flattenAll(EN_FILES);
export const flatUr = flattenAll(UR_FILES);

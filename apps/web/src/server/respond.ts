import { hiddenFields, stripFields } from '@mediescare/core';
import { json, type AuthedRequest } from './guard';

/**
 * JSON response with field-level rules applied: cost and profit fields are removed from the body for
 * users without view_cost / view_profit (permissions-matrix.md §4). Done on the server, so a cashier's
 * browser never receives them, whatever the UI hides.
 */
export function jsonFor(auth: AuthedRequest, body: unknown, status = 200) {
  return json(stripFields(body, hiddenFields(auth.access)), status);
}

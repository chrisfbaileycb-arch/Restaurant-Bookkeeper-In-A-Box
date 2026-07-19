/**
 * Daily compliance sweep — refreshes deadlines and estimated amounts for
 * EVERY location in EVERY organization (the scheduler has no user context).
 */
import { refreshAllLocations } from 'lib/compliance.js';

export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const result = await refreshAllLocations(new Date());
  return res.json(result);
}

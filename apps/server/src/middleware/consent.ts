/**
 * Consent gate (BRD NFR-8, DPDP Act, 2023). A teacher who withdrew her consent (or never gave the current one) is not
 * sent to any outside service: no lecture build, no reading of her notes, no checks of her edits, no class memory,
 * no source lookups. She can still open, download and delete what she has. Editors and admins have no consent step.
 */
import type { RequestHandler } from 'express';
import type pg from 'pg';
import { CONSENT_VERSION } from '@nyaai/shared';
import { AppError } from '../errors.ts';

export async function hasConsent(c: pg.PoolClient): Promise<boolean> {
  return (await c.query('select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null limit 1', [CONSENT_VERSION])).rowCount === 1;
}

export const consentMessage = 'You withdrew your consent, so NYAAI cannot send your work to the services it uses. Agree again to continue.';

export const requireConsent: RequestHandler = async (req, _res, next) => {
  if (req.identity?.role !== 'teacher') return next();
  if (!(await req.db!(hasConsent))) throw new AppError('CONSENT_REQUIRED', consentMessage);
  next();
};

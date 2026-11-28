/** GET /me: who she is, where setup stands, budget left this month, feature flags (LLD §4.2, §11.5). */
import express from 'express';
import { Me } from '@nyaai/shared';
import type { Config } from '../config.ts';
import { CSRF_COOKIE, csrfValid, issueCsrf } from '../auth/csrf.ts';
import { loadMe } from '../services/me/index.ts';

export function meRouter(config: Config) {
  const r = express.Router();
  r.get('/me', async (req, res) => {
    const me = await req.db!((c) => loadMe(c, config.FEATURE_FLAGS));
    // Make sure the page holds a CSRF token for this user before it sends any change.
    if (!csrfValid(req.cookies?.[CSRF_COOKIE] as string | undefined, me.user.id, config.CSRF_SECRET)) {
      issueCsrf(res, me.user.id, config.CSRF_SECRET, config.NODE_ENV === 'production');
    }
    res.json(Me.parse(me));
  });
  return r;
}

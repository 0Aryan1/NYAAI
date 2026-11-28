/**
 * Setup and consent routes (F1, ACC-2 to ACC-6). The steps and their rules live in services/setup.
 *   GET   /consents/current   the services her work is sent to, and whether she has agreed
 *   POST  /consents           she agrees (step 1)
 *   POST  /consents/withdraw  she withdraws; her data stays
 *   PATCH /setup/profile      step 2 · PATCH /setup/style  step 4 · PATCH /setup/progress  skip a step not built yet
 *   POST  /setup/finish       all required answers given
 */
import express from 'express';
import {
  CONSENT_VERSION,
  ConsentRequest,
  ConsentStatus,
  PROCESSORS,
  ProfileRequest,
  ProgressRequest,
  StyleRequest,
} from '@nyaai/shared';
import {
  advanceTo,
  finishSetup,
  giveConsent,
  hasConsent,
  saveProfile,
  saveStyle,
  withdrawConsent,
} from '../services/setup/index.ts';

export function setupRouter() {
  const r = express.Router();

  r.get('/consents/current', async (req, res) => {
    const accepted = await req.db!(hasConsent);
    res.json(ConsentStatus.parse({ version: CONSENT_VERSION, processors: PROCESSORS, accepted }));
  });

  r.post('/consents', async (req, res) => {
    const body = ConsentRequest.parse(req.body);
    await req.db!((c) => giveConsent(c, body.version));
    res.status(204).end();
  });

  r.post('/consents/withdraw', async (req, res) => {
    await req.db!(withdrawConsent);
    res.status(204).end();
  });

  r.patch('/setup/profile', async (req, res) => {
    const body = ProfileRequest.parse(req.body);
    await req.db!((c) => saveProfile(c, body));
    res.status(204).end();
  });

  r.patch('/setup/style', async (req, res) => {
    const style = StyleRequest.parse(req.body);
    await req.db!((c) => saveStyle(c, style));
    res.status(204).end();
  });

  r.patch('/setup/progress', async (req, res) => {
    const { step } = ProgressRequest.parse(req.body);
    await req.db!((c) => advanceTo(c, step, true));
    res.status(204).end();
  });

  r.post('/setup/finish', async (req, res) => {
    await req.db!(finishSetup);
    res.status(204).end();
  });

  return r;
}

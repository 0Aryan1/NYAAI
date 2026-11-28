/** GET /home: her courses, each with its next untaught lecture (HOME-3). The app never picks one (HOME-4). */
import express from 'express';
import { HomeResponse } from '@nyaai/shared';
import { homeCourses } from '../services/course/plan.ts';

export function homeRouter() {
  const r = express.Router();
  r.get('/home', async (req, res) => {
    res.json(HomeResponse.parse(await req.db!(homeCourses)));
  });
  return r;
}

/** GET /home: her courses, each with its next untaught lecture (HOME-3). The app never picks one (HOME-4). */
import express from 'express';
import { HomeResponse } from '@nyaai/shared';

export function homeRouter() {
  const r = express.Router();
  r.get('/home', async (req, res) => {
    const rows = await req.db!(async (c) =>
      (
        await c.query<{ id: string; name: string; next_unit: { id: string; position: number; title: string } | null }>(
          `select c.id, c.name,
                  (select json_build_object('id', u.id, 'position', u.position, 'title', u.title)
                     from course_units u
                    where u.course_id = c.id and u.status = 'planned'
                    order by u.position limit 1) as next_unit
             from courses c
            where c.archived_at is null
            order by c.created_at`,
        )
      ).rows,
    );
    res.json(HomeResponse.parse({ courses: rows.map((r) => ({ id: r.id, name: r.name, nextUnit: r.next_unit })) }));
  });
  return r;
}

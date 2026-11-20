-- DRAFT concept list for the Day 2 test topic (frustration of contract). Written by the build team, NOT by the
-- library editor: every leading-case link is left unconfirmed (confirmed_at null), so search treats only key
-- sections as concept candidates, and the topic map will show the cases grey until an expert confirms them
-- (HLD 4.1 EXP-1, D17). Idempotent; re-run after new sources are loaded to pick up their links.

insert into legal_concepts (id, college_id, name, aliases, subject)
values
  ('00000000-0000-4000-8000-0000000c0001', global_college(), 'Frustration of contract',
   array['doctrine of frustration', 'frustration', 'supervening impossibility', 'impossibility of performance',
         'agreement to do impossible act', 'section 56', 'force majeure'], 'Contract'),
  ('00000000-0000-4000-8000-0000000c0002', global_college(), 'Damages (contract)',
   array['damages', 'compensation for breach', 'remoteness of damage', 'section 73', 'liquidated damages'], 'Contract'),
  ('00000000-0000-4000-8000-0000000c0003', global_college(), 'Damages (tort)',
   array['damages', 'compensation in tort', 'remoteness in tort', 'exemplary damages'], 'Torts')
on conflict (id) do update set aliases = excluded.aliases, name = excluded.name, subject = excluded.subject, updated_at = now();

-- Key sections, linked to the section chunk itself.
insert into concept_links (concept_id, source_id, chunk_id, kind)
select v.concept_id::uuid, c.source_id, c.id, 'key_section'
  from (values ('00000000-0000-4000-8000-0000000c0001', '56'), ('00000000-0000-4000-8000-0000000c0001', '32'),
               ('00000000-0000-4000-8000-0000000c0001', '65'), ('00000000-0000-4000-8000-0000000c0002', '73'),
               ('00000000-0000-4000-8000-0000000c0002', '74')) as v(concept_id, section)
  join chunks c on c.act_name = 'Indian Contract Act' and c.section = v.section and c.parent_id is null
  join sources s on s.id = c.source_id and s.origin = 'india_code'
on conflict do nothing;

-- Leading cases: linked, NOT confirmed.
insert into concept_links (concept_id, source_id, kind)
select '00000000-0000-4000-8000-0000000c0001'::uuid, s.id, 'leading_case'
  from sources s
 where s.type = 'judgment'
   and (s.title ilike 'Satyabrata Ghose%' or s.title ilike '%Naihati Jute Mills%' or s.title ilike '%Alopi Parshad%'
        or s.title ilike 'Boothalinga Agencies%' or s.title ilike 'Energy Watchdog%')
on conflict do nothing;

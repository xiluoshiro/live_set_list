-- Preserve named empty other-member categories while representing no other-member data as SQL NULL.
UPDATE public.live_setlist
SET other_member = (
    SELECT jsonb_object_agg(
        entry.key,
        CASE WHEN entry.value = '[]'::jsonb THEN 'null'::jsonb ELSE entry.value END
    )
    FROM jsonb_each(
        CASE WHEN jsonb_typeof(other_member) = 'object' THEN other_member ELSE '{}'::jsonb END
    ) AS entry
)
WHERE jsonb_typeof(other_member) = 'object'
  AND EXISTS (
      SELECT 1
      FROM jsonb_each(
          CASE WHEN jsonb_typeof(other_member) = 'object' THEN other_member ELSE '{}'::jsonb END
      ) AS entry
      WHERE entry.value = '[]'::jsonb
  );

UPDATE public.live_setlist
SET other_member = NULL
WHERE other_member IN ('{}'::jsonb, '[]'::jsonb);

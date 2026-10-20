-- Prepared for the user to run in production. NOT executed by the agent.
-- BEGIN below opens the required PL/pgSQL body; it is not a transaction BEGIN.
DO $dec_friendly$
DECLARE
  inserted_count integer;
BEGIN
  IF (SELECT count(*) FROM schedule_events) <> 14 THEN
    RAISE EXCEPTION 'Expected exactly 14 schedule_events rows before insertion';
  END IF;
  IF EXISTS (SELECT 1 FROM schedule_events WHERE slug = 'friendly-dec-2026') THEN
    RAISE EXCEPTION 'friendly-dec-2026 already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM schedule_events
    WHERE sort_order = 35 AND slug <> 'friendly-dec-2026'
  ) THEN
    RAISE EXCEPTION 'Another schedule event already uses sort_order 35';
  END IF;

  INSERT INTO schedule_events (
    slug, name, kind, status, start_date, end_date,
    date_label, sort_order, description
  ) VALUES (
    'friendly-dec-2026', 'December Friendly', 'friendly', 'confirmed',
    '2026-12-13', '2026-12-14', 'Dec 13, 2026', 35,
    'A one-off friendly against Jamaica on Sunday, December 13, at Inter Miami CF Stadium in Fort Lauderdale, Florida. The match falls outside a FIFA international window. Kickoff time and broadcast details have not been announced.'
  );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> 1 THEN
    RAISE EXCEPTION 'Expected INSERT 1, got %', inserted_count;
  END IF;
  IF (SELECT count(*) FROM schedule_events) <> 15 THEN
    RAISE EXCEPTION 'Expected exactly 15 schedule_events rows after insertion';
  END IF;
END;
$dec_friendly$;

SELECT slug, sort_order, start_date, end_date, date_label
FROM schedule_events
ORDER BY sort_order;

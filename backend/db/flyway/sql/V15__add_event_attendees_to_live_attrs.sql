ALTER TABLE live_attrs
    ADD COLUMN event_attendees jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE live_attrs
    ADD CONSTRAINT live_attrs_event_attendees_object
    CHECK (jsonb_typeof(event_attendees) = 'object');

ALTER TABLE live_attrs
    ADD CONSTRAINT live_attrs_event_attendees_event_only
    CHECK (live_type = 'event' OR event_attendees = '{}'::jsonb);

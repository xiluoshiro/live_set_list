-- 02: retire erroneous geography revision metadata and COMMIT. Run after 01.
-- Pure SQL, repeatable. Only the reviewed venues and their venue-source Live metadata are touched.
-- Revision 2 is an obsolete geography counter; revision 3 additionally requires the old bad audit
-- before restoring its verification timestamp. Name versions and schedule facts stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE public.venue_list, public.live_attrs, public.audit_logs,
    public.geo_localities, public.venue_name_versions, public.venue_map_links,
    public.live_schedule_history IN SHARE ROW EXCLUSIVE MODE;

-- Reviewed targets: stable ID and coordinates identify the venue across environments.
CREATE TEMP TABLE _venue_targets (
    id integer PRIMARY KEY, latitude numeric, longitude numeric, timezone_id text
) ON COMMIT DROP;
INSERT INTO _venue_targets VALUES
    (1, 35.894889, 139.630831, 'Asia/Tokyo'),
    (2, 35.170862, 136.911267, 'Asia/Tokyo'),
    (3, 35.64343, 139.7944, 'Asia/Tokyo'),
    (4, 35.48026, 138.75971, 'Asia/Tokyo'),
    (5, 31.186911, 121.447017, 'Asia/Shanghai'),
    (6, 35.66514, 139.5244, 'Asia/Tokyo'),
    (7, 31.29325, 121.44874, 'Asia/Shanghai'),
    (8, 35.445975, 139.647154, 'Asia/Tokyo'),
    (9, 34.66201, 135.43486, 'Asia/Tokyo'),
    (10, 31.192892, 121.300132, 'Asia/Shanghai'),
    (11, 35.57479, 140.124264, 'Asia/Tokyo'),
    (12, 35.69336, 139.74987, 'Asia/Tokyo'),
    (13, 35.51227, 139.62019, 'Asia/Tokyo'),
    (14, 35.46471, 139.63072, 'Asia/Tokyo'),
    (15, 35.6254, 139.7756, 'Asia/Tokyo'),
    (16, 34.68939, 135.48627, 'Asia/Tokyo'),
    (17, 35.67667, 139.76444, 'Asia/Tokyo'),
    (18, 35.45975, 139.62591, 'Asia/Tokyo'),
    (19, 31.159567, 121.472869, 'Asia/Shanghai'),
    (20, 31.19168, 121.29752, 'Asia/Shanghai'),
    (21, 35.704805, 139.411841, 'Asia/Tokyo'),
    (22, 35.68384, 139.9897, 'Asia/Tokyo'),
    (23, 34.66395, 135.21015, 'Asia/Tokyo'),
    (24, 35.63773, 139.79204, 'Asia/Tokyo'),
    (25, 31.191291, 121.489391, 'Asia/Shanghai'),
    (26, 33.6007, 130.3786, 'Asia/Tokyo'),
    (27, 34.6559, 135.505, 'Asia/Tokyo'),
    (28, 35.163362, 136.884742, 'Asia/Tokyo'),
    (29, 35.5494, 139.7798, 'Asia/Tokyo'),
    (30, 35.659268, 139.671558, 'Asia/Tokyo'),
    (31, 35.634, 139.788, 'Asia/Tokyo'),
    (33, 35.62656, 139.78265, 'Asia/Tokyo'),
    (34, 35.45582, 139.62843, 'Asia/Tokyo'),
    (35, 35.648333, 140.034722, 'Asia/Tokyo'),
    (36, 35.7033, 139.7546, 'Asia/Tokyo'),
    (37, 34.6847, 135.5337, 'Asia/Tokyo'),
    (38, 34.69226, 135.19584, 'Asia/Tokyo'),
    (39, 34.04302, -118.26687, 'America/Los_Angeles'),
    (40, 35.694596, 139.702177, 'Asia/Tokyo'),
    (41, 25.076, 121.535, 'Asia/Taipei'),
    (42, 35.630161, 139.793739, 'Asia/Tokyo'),
    (43, 34.69172, 135.53069, 'Asia/Tokyo'),
    (44, 25.05968, 121.44957, 'Asia/Taipei'),
    (45, 37.59255, 127.0249, 'Asia/Seoul'),
    (46, 1.30692, 103.788394, 'Asia/Singapore'),
    (47, 34.665566, 135.39762, 'Asia/Tokyo'),
    (48, 35.64823, 140.0347, 'Asia/Tokyo'),
    (49, 34.6898, 135.50031, 'Asia/Tokyo'),
    (50, 35.05, 136.846916, 'Asia/Tokyo'),
    (51, 35.688741, 139.76233, 'Asia/Tokyo'),
    (52, 35.715561, 139.782013, 'Asia/Tokyo'),
    (53, 35.9069, 139.6237, 'Asia/Tokyo'),
    (54, 35.647112, 139.702325, 'Asia/Tokyo'),
    (55, 35.73131, 139.71554, 'Asia/Tokyo'),
    (56, 35.702144, 139.740455, 'Asia/Tokyo'),
    (57, 35.67098, 139.750627, 'Asia/Tokyo'),
    (58, 36.254864, 138.485756, 'Asia/Tokyo'),
    (59, 35.658715, 139.695526, 'Asia/Tokyo'),
    (60, 36.4025, 140.5943, 'Asia/Tokyo'),
    (61, 35.638599, 139.827756, 'Asia/Tokyo'),
    (62, 43.04935, 141.35317, 'Asia/Tokyo'),
    (63, 14.62071, 121.0534, 'Asia/Manila'),
    (64, 25.0032, 121.2004, 'Asia/Taipei'),
    (65, 34.701767, 135.502308, 'Asia/Tokyo'),
    (66, 35.16371, 136.908338, 'Asia/Tokyo'),
    (67, 35.658715, 139.695526, 'Asia/Tokyo'),
    (68, 35.64968, 139.78831, 'Asia/Tokyo'),
    (69, 35.797194, 139.506833, 'Asia/Tokyo'),
    (70, 35.6641, 139.69853, 'Asia/Tokyo'),
    (71, 35.465421, 139.625109, 'Asia/Tokyo'),
    (72, 34.6725, 135.4987, 'Asia/Tokyo'),
    (73, 35.69558, 139.70077, 'Asia/Tokyo'),
    (74, 35.660766, 139.697432, 'Asia/Tokyo'),
    (75, 35.69829, 139.77101, 'Asia/Tokyo'),
    (76, 35.661249, 139.737251, 'Asia/Tokyo'),
    (77, 35.463221, 139.618737, 'Asia/Tokyo'),
    (78, 35.672361, 139.754028, 'Asia/Tokyo'),
    (79, 35.7315, 139.715, 'Asia/Tokyo'),
    (80, 34.689681, 135.530106, 'Asia/Tokyo'),
    (81, 43.06218, 141.35554, 'Asia/Tokyo'),
    (82, 33.60387, 130.40232, 'Asia/Tokyo'),
    (83, 35.6303, 139.7894, 'Asia/Tokyo'),
    (84, 35.281363, 139.662998, 'Asia/Tokyo'),
    (85, 34.69353, 135.50401, 'Asia/Tokyo'),
    (86, 35.684194, 139.699406, 'Asia/Tokyo'),
    (87, 35.70757, 139.66469, 'Asia/Tokyo'),
    (88, 35.48165, 138.77538, 'Asia/Tokyo'),
    (89, 35.69992, 139.77096, 'Asia/Tokyo'),
    (90, 35.7685, 139.4205, 'Asia/Tokyo'),
    (91, 35.65968, 139.73011, 'Asia/Tokyo'),
    (92, 35.69144, 139.752799, 'Asia/Tokyo'),
    (93, 35.132081, 136.89805, 'Asia/Tokyo'),
    (94, 35.695366, 139.702633, 'Asia/Tokyo'),
    (95, 35.4599, 139.63538, 'Asia/Tokyo'),
    (96, 34.683692, 135.185164, 'Asia/Tokyo'),
    (97, 35.638722, 139.789222, 'Asia/Tokyo'),
    (98, 35.63646, 139.7901, 'Asia/Tokyo'),
    (99, 35.692472, 139.703329, 'Asia/Tokyo'),
    (100, 35.69833, 139.771651, 'Asia/Tokyo'),
    (101, 35.627775, 139.735481, 'Asia/Tokyo'),
    (102, 1.334033, 103.958931, 'Asia/Singapore'),
    (103, 35.184437, 136.901332, 'Asia/Tokyo'),
    (104, 35.729097, 139.719089, 'Asia/Tokyo'),
    (105, 35.66121, 139.72727, 'Asia/Tokyo'),
    (106, 33.76474, -118.18923, 'America/Los_Angeles'),
    (107, 1.2936, 103.855, 'Asia/Singapore'),
    (108, 34.63725, 135.41993, 'Asia/Tokyo'),
    (109, 25.0565, 121.61809, 'Asia/Taipei'),
    (110, 25.041991, 121.507583, 'Asia/Taipei'),
    (111, 33.085936, 129.789883, 'Asia/Tokyo'),
    (112, 37.56638, 127.00739, 'Asia/Seoul'),
    (113, 35.66189, 139.701095, 'Asia/Tokyo'),
    (114, 35.67252, 139.735274, 'Asia/Tokyo'),
    (115, 35.72975, 139.7138, 'Asia/Tokyo'),
    (116, 31.181207, 121.490475, 'Asia/Shanghai'),
    (117, 35.7685, 139.4205, 'Asia/Tokyo'),
    (118, 35.70551, 139.75197, 'Asia/Tokyo'),
    (119, 35.645239, 140.030922, 'Asia/Tokyo'),
    (120, 35.52962, 139.70893, 'Asia/Tokyo'),
    (121, 25.033765, 121.56238, 'Asia/Taipei'),
    (122, 34.989255, 137.006893, 'Asia/Tokyo'),
    (123, 35.48507, 138.77862, 'Asia/Tokyo'),
    (125, 33.80057, -117.92072, 'America/Los_Angeles'),
    (126, 35.69703, 139.793457, 'Asia/Tokyo'),
    (127, 35.770033, 139.660993, 'Asia/Tokyo'),
    (128, 35.665668, 139.760057, 'Asia/Tokyo'),
    (129, 35.457833, 139.636667, 'Asia/Tokyo'),
    (130, 35.632606, 139.889169, 'Asia/Tokyo'),
    (131, 35.72912, 139.71914, 'Asia/Tokyo'),
    (132, 35.688077, 139.6984, 'Asia/Tokyo'),
    (133, 33.89112, 130.88873, 'Asia/Tokyo'),
    (134, 35.01003, 138.494747, 'Asia/Tokyo'),
    (135, 35.625831, 139.782219, 'Asia/Tokyo'),
    (136, 34.74552, 137.96841, 'Asia/Tokyo'),
    (137, 35.6235, 139.751267, 'Asia/Tokyo'),
    (139, 34.70405, 135.19833, 'Asia/Tokyo'),
    (140, 34.392083, 132.451028, 'Asia/Tokyo'),
    (141, 32.800961, 130.704458, 'Asia/Tokyo'),
    (142, 35.165558, 136.905747, 'Asia/Tokyo'),
    (143, 43.061413, 141.353256, 'Asia/Tokyo'),
    (144, 36.067576, 139.522618, 'Asia/Tokyo'),
    (145, 37.598611, 127.052732, 'Asia/Seoul'),
    (146, 25.03458, 121.3835, 'Asia/Taipei'),
    (147, 22.32144, 113.94325, 'Asia/Hong_Kong'),
    (148, 34.810122, 135.5276, 'Asia/Tokyo'),
    (149, 35.695889, 139.700389, 'Asia/Tokyo'),
    (150, 35.07425, 135.93502, 'Asia/Tokyo'),
    (151, 35.45833, 139.63639, 'Asia/Tokyo'),
    (152, 35.65915, 139.70397, 'Asia/Tokyo'),
    (153, 35.65848, 139.69532, 'Asia/Tokyo'),
    (154, 35.687847, 139.762453, 'Asia/Tokyo'),
    (155, 37.66606, 126.741905, 'Asia/Seoul'),
    (156, 38.25772, 140.89407, 'Asia/Tokyo');
DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1 FROM _venue_targets t LEFT JOIN public.venue_list v ON v.id=t.id
        WHERE v.id IS NULL OR v.venue_kind <> 'physical' OR v.merged_into_venue_id IS NOT NULL
           OR v.latitude IS DISTINCT FROM t.latitude OR v.longitude IS DISTINCT FROM t.longitude
           OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=t.timezone_id)
    ) THEN
        RAISE EXCEPTION 'Reviewed Venue IDs/coordinates/kinds or IANA values do not match target data';
    END IF;
END
$guard$;
CREATE TEMP TABLE _before_venues ON COMMIT DROP AS SELECT * FROM public.venue_list;
CREATE TEMP TABLE _before_lives ON COMMIT DROP AS SELECT * FROM public.live_attrs;
CREATE TEMP TABLE _before_geo_localities ON COMMIT DROP AS SELECT * FROM public.geo_localities;
CREATE TEMP TABLE _before_venue_name_versions ON COMMIT DROP AS SELECT * FROM public.venue_name_versions;
CREATE TEMP TABLE _before_venue_map_links ON COMMIT DROP AS SELECT * FROM public.venue_map_links;
CREATE TEMP TABLE _before_live_schedule_history ON COMMIT DROP AS SELECT * FROM public.live_schedule_history;

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.venue_list v JOIN _venue_targets t USING(id)
               WHERE v.timezone_id IS DISTINCT FROM t.timezone_id OR v.location_revision NOT IN (1,2,3))
       OR NOT EXISTS (SELECT 1 FROM public.venue_list WHERE id=32 AND venue_kind='undisclosed'
                     AND location_revision IN (1,2)) THEN
        RAISE EXCEPTION 'Expected completed IANA fill and supported obsolete revision metadata';
    END IF;
END
$guard$;
CREATE TEMP TABLE _revision_targets ON COMMIT DROP AS
SELECT v.id,v.location_verified_at AS restored_verified_at
FROM public.venue_list v WHERE v.id IN (SELECT id FROM _venue_targets) OR v.id=32;
-- Only the old erroneous 2 -> 3 backfill changed verification time. Use that database's audit.
DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.venue_list v JOIN _revision_targets t USING(id)
        WHERE v.location_revision=3 AND (
            SELECT count(*) FROM public.audit_logs a
            WHERE a.resource_type='venue' AND a.resource_id=v.id::text
              AND a.action='venue_location_update'
              AND a.payload_json->>'source'='venue_own_timezone_backfill_20260918'
              AND a.payload_json->'before'->>'location_revision'='2'
              AND a.payload_json->'after'=to_jsonb(v)
              AND a.payload_json->'before' ? 'location_verified_at'
        ) <> 1
    ) THEN
        RAISE EXCEPTION 'Revision 3 lacks unique matching bad-backfill audit; cannot restore timestamp';
    END IF;
END
$guard$;
UPDATE _revision_targets t
SET restored_verified_at=(a.payload_json->'before'->>'location_verified_at')::timestamptz
FROM public.venue_list v, public.audit_logs a
WHERE t.id=v.id AND v.location_revision=3
  AND a.resource_type='venue' AND a.resource_id=v.id::text
  AND a.action='venue_location_update'
  AND a.payload_json->>'source'='venue_own_timezone_backfill_20260918'
  AND a.payload_json->'before'->>'location_revision'='2'
  AND a.payload_json->'after'=to_jsonb(v);
CREATE TEMP TABLE _changed_venues ON COMMIT DROP AS
WITH changed AS (
    UPDATE public.venue_list v SET location_revision=1,location_verified_at=t.restored_verified_at
    FROM _revision_targets t WHERE v.id=t.id AND v.location_revision<>1
    RETURNING v.id
) SELECT * FROM changed;
CREATE TEMP TABLE _changed_lives ON COMMIT DROP AS
WITH changed AS (
    UPDATE public.live_attrs l SET timezone_source_revision=NULL
    WHERE l.venue_id IN (SELECT id FROM _revision_targets)
      AND l.timezone_source='venue' AND l.timezone_source_revision IS NOT NULL
    RETURNING l.id
) SELECT * FROM changed;
INSERT INTO public.audit_logs(user_id,action,resource_type,resource_id,payload_json)
SELECT NULL,'venue_revision_correction','venue',v.id::text,
       jsonb_build_object('source','retire_geography_revisions_20260918',
                          'before',to_jsonb(b),'after',to_jsonb(v))
FROM public.venue_list v JOIN _changed_venues c USING(id) JOIN _before_venues b USING(id);
INSERT INTO public.audit_logs(user_id,action,resource_type,resource_id,payload_json)
SELECT NULL,'live_timezone_revision_correction','live',l.id::text,
       jsonb_build_object('source','retire_geography_revisions_20260918',
                          'before_timezone_source_revision',b.timezone_source_revision,
                          'after_timezone_source_revision',l.timezone_source_revision,
                          'schedule_facts_unchanged',true)
FROM public.live_attrs l JOIN _changed_lives c USING(id) JOIN _before_lives b USING(id);
DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.venue_list v FULL JOIN _before_venues b USING(id)
        LEFT JOIN _revision_targets t ON t.id=v.id
        WHERE v.id IS NULL OR b.id IS NULL
           OR (t.id IS NULL AND to_jsonb(v) IS DISTINCT FROM to_jsonb(b))
           OR (t.id IS NOT NULL AND (v.location_revision<>1
               OR v.location_verified_at IS DISTINCT FROM t.restored_verified_at
               OR (to_jsonb(v)-ARRAY['location_revision','location_verified_at'])
                   IS DISTINCT FROM (to_jsonb(b)-ARRAY['location_revision','location_verified_at'])))
    ) THEN
        RAISE EXCEPTION 'Unexpected Venue fact change';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.live_attrs l FULL JOIN _before_lives b USING(id)
        LEFT JOIN _changed_lives c ON c.id=l.id
        WHERE l.id IS NULL OR b.id IS NULL
           OR (c.id IS NULL AND to_jsonb(l) IS DISTINCT FROM to_jsonb(b))
           OR (c.id IS NOT NULL AND (l.timezone_source_revision IS NOT NULL
               OR (to_jsonb(l)-'timezone_source_revision') IS DISTINCT FROM (to_jsonb(b)-'timezone_source_revision')))
    ) THEN
        RAISE EXCEPTION 'Live schedule or timezone facts changed';
    END IF;
    IF EXISTS ((SELECT * FROM public.geo_localities EXCEPT ALL SELECT * FROM _before_geo_localities)
                  UNION ALL (SELECT * FROM _before_geo_localities EXCEPT ALL SELECT * FROM public.geo_localities)) THEN
        RAISE EXCEPTION 'Unexpected change to geo_localities';
    END IF;
    IF EXISTS ((SELECT * FROM public.venue_name_versions EXCEPT ALL SELECT * FROM _before_venue_name_versions)
                  UNION ALL (SELECT * FROM _before_venue_name_versions EXCEPT ALL SELECT * FROM public.venue_name_versions)) THEN
        RAISE EXCEPTION 'Unexpected change to venue_name_versions';
    END IF;
    IF EXISTS ((SELECT * FROM public.venue_map_links EXCEPT ALL SELECT * FROM _before_venue_map_links)
                  UNION ALL (SELECT * FROM _before_venue_map_links EXCEPT ALL SELECT * FROM public.venue_map_links)) THEN
        RAISE EXCEPTION 'Unexpected change to venue_map_links';
    END IF;
    IF EXISTS ((SELECT * FROM public.live_schedule_history EXCEPT ALL SELECT * FROM _before_live_schedule_history)
                  UNION ALL (SELECT * FROM _before_live_schedule_history EXCEPT ALL SELECT * FROM public.live_schedule_history)) THEN
        RAISE EXCEPTION 'Unexpected change to live_schedule_history';
    END IF;
END
$guard$;
SELECT (SELECT count(*) FROM _changed_venues) AS venue_metadata_corrected,
       (SELECT count(*) FROM _changed_lives) AS live_metadata_corrected;
COMMIT;

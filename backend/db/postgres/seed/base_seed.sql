BEGIN;

-- Base seed for live_statistic_test.
-- Safe to rerun after Flyway migrate because it truncates business tables first.
TRUNCATE TABLE
    public.audit_logs,
    public.auth_sessions,
    public.user_live_favorites,
    public.app_users,
    public.live_setlist_band_performance_members,
    public.live_setlist_band_performances,
    public.live_band_lineup_contexts,
    public.band_lineup_version_members,
    public.band_lineup_versions,
    public.band_name_versions,
    public.venue_name_versions,
    public.tour_lives,
    public.tour_bands,
    public.tour_attrs,
    public.live_setlist,
    public.live_attrs,
    public.song_list,
    public.band_attrs,
    public.venue_list
RESTART IDENTITY CASCADE;

INSERT INTO public.venue_list (id, venue)
VALUES
    (1, 'Shibuya WWW X'),
    (2, 'Zepp Shinjuku'),
    (24, '東京ガーデンシアター');

INSERT INTO public.venue_name_versions (venue_id, venue_name, valid_from, valid_to)
SELECT id, venue, NULL, NULL
FROM public.venue_list
ORDER BY id;

INSERT INTO public.band_attrs (id, band_abbr, band_name)
VALUES
    (0, '', 'Other bands'),
    (1, 'ppp', 'Poppin''Party'),
    (2, 'rsl', 'Roselia'),
    (3, 'mygo', 'MyGO!!!!!');

INSERT INTO public.song_list (id, song_name, band_id, is_cover)
VALUES
    (1, 'Yes! BanG_Dream!', 1, false),
    (2, 'BLACK SHOUT', 2, false),
    (3, '春日影', 3, false),
    (4, 'STAR BEAT!〜ホシノコドウ〜', 1, false),
    (29, 'ぽっぴん''どりーむ！', 1, false),
    (30, 'Time Lapse', 1, false),
    (70, 'FIRE BIRD', 2, false),
    (100, 'What''s the POPIPA!?', 1, false),
    (102, 'キズナミュージック♪', 1, false),
    (106, 'TARINAI', 1, false),
    (107, 'Moonlight Walk', 1, false),
    (109, 'Hello! Wink!', 1, false),
    (188, 'DOKI DOKI SCARY', 1, false),
    (199, '開けたら Dream!', 1, false),
    (200, '前へススメ！', 1, false),
    (201, '切ない Sandglass', 1, false),
    (202, 'Drive Your Heart', 1, false);

INSERT INTO public.live_attrs (
    id,
    live_date,
    live_title,
    is_internal,
    url,
    opening_time,
    start_time,
    venue_id,
    venue_name_version_id,
    live_type,
    default_band_ids,
    event_status
)
VALUES
    (
        1,
        DATE '2026-03-28',
        'BanG Dream! Unit Live',
        false,
        'https://example.com/lives/1',
        TIME WITH TIME ZONE '16:30:00+09',
        TIME WITH TIME ZONE '17:30:00+09',
        1,
        (SELECT id FROM public.venue_name_versions WHERE venue_id = 1),
        'multi_act',
        ARRAY[3],
        'scheduled'
    ),
    (
        2,
        DATE '2026-04-05',
        'Crossover Special Stage',
        false,
        'https://example.com/lives/2',
        TIME WITH TIME ZONE '15:00:00+09',
        TIME WITH TIME ZONE '16:00:00+09',
        2,
        (SELECT id FROM public.venue_name_versions WHERE venue_id = 2),
        'festival',
        ARRAY[2],
        'scheduled'
    ),
    (
        38,
        DATE '2026-01-03',
        'Poppin''Party New Year LIVE「Happy BanG Year!!」',
        true,
        'https://bang-dream.com/events/ppp_live2026/',
        TIME WITH TIME ZONE '17:00:00+09',
        TIME WITH TIME ZONE '18:00:00+09',
        24,
        (SELECT id FROM public.venue_name_versions WHERE venue_id = 24),
        'oneman',
        ARRAY[2],
        'scheduled'
    ),
    (
        41,
        DATE '2026-05-30',
        'Console Draft Live',
        false,
        'https://example.com/lives/console-draft',
        TIME WITH TIME ZONE '17:00:00+09',
        TIME WITH TIME ZONE '18:00:00+09',
        1,
        (SELECT id FROM public.venue_name_versions WHERE venue_id = 1),
        'other',
        ARRAY[3],
        'scheduled'
    );

INSERT INTO public.tour_attrs (id, tour_title)
VALUES (1, 'BanG Dream! Spring Tour 2026');

INSERT INTO public.tour_bands (tour_id, band_id, display_order)
VALUES
    (1, 1, 1),
    (1, 2, 2);

INSERT INTO public.tour_lives (tour_id, live_id, stop_order, stop_label)
VALUES
    (1, 1, 1, 'Tokyo Opening'),
    (1, 2, 2, 'Tokyo Finale');

INSERT INTO public.live_setlist (
    live_id,
    song_id,
    absolute_order,
    segment_type,
    sub_order,
    is_short,
    other_member,
    comment
)
VALUES
    (
        1,
        1,
        1,
        'main',
        1,
        false,
        $${
          "嘉宾": ["CHU2"]
        }$$::jsonb,
        'opening song'
    ),
    (
        1,
        2,
        2,
        'main',
        2,
        true,
        NULL,
        'short version'
    ),
    (
        2,
        3,
        1,
        'main',
        1,
        false,
        $${
          "支援": "Keyboard"
        }$$::jsonb,
        'guest support'
    ),
    (
        2,
        4,
        2,
        'encore',
        1,
        false,
        $${
          "嘉宾": ["Tomori", "Anon"]
        }$$::jsonb,
        'encore'
    );

-- Real production sample for console/live detail testing.
-- Production song_id 159 has the same song_name as seed song_id 1, so setlist rows are mapped to song_id 1.
-- Production band_id 4 is Roselia; this seed reuses existing band_id 2 to avoid duplicate band_name aggregation.
INSERT INTO public.live_setlist (
    id,
    live_id,
    song_id,
    absolute_order,
    segment_type,
    sub_order,
    is_short,
    other_member,
    comment
)
VALUES
    (
        'd8869004-5c3b-4818-babb-0778828607b0'::uuid,
        38,
        1,
        1,
        'M',
        1,
        false,
        NULL,
        NULL
    ),
    (
        '72cd5601-6949-4e7b-8a89-01a3d7b72f09'::uuid,
        38,
        100,
        2,
        'M',
        2,
        false,
        NULL,
        NULL
    ),
    (
        'fd82e2be-99cb-4ca3-bce8-7bac87c061ac'::uuid,
        38,
        199,
        3,
        'M',
        3,
        false,
        NULL,
        NULL
    ),
    (
        '77822770-51da-4db2-a751-0766ead40580'::uuid,
        38,
        109,
        4,
        'M',
        4,
        false,
        NULL,
        NULL
    ),
    (
        'a9e0b3d3-e118-4128-9c8e-ef07b93b6d0e'::uuid,
        38,
        188,
        5,
        'M',
        5,
        false,
        NULL,
        NULL
    ),
    (
        'fdab0d6f-1546-47f0-af9c-62bb8d5e6268'::uuid,
        38,
        200,
        6,
        'M',
        6,
        false,
        NULL,
        NULL
    ),
    (
        '31258084-72cb-4a88-bb79-fb21265fd5a0'::uuid,
        38,
        201,
        7,
        'M',
        7,
        false,
        NULL,
        NULL
    ),
    (
        'b52286f6-f356-48e9-8e5c-9c4c9f13f884'::uuid,
        38,
        202,
        8,
        'M',
        8,
        false,
        NULL,
        NULL
    ),
    (
        'a37b76c9-125a-42c0-83e4-c16215d08936'::uuid,
        38,
        30,
        9,
        'M',
        9,
        false,
        NULL,
        NULL
    ),
    (
        'f6c61a6d-5b17-4a12-acf2-79f5b3fde21c'::uuid,
        38,
        107,
        10,
        'M',
        10,
        false,
        NULL,
        NULL
    ),
    (
        'd19dcb99-7f8e-4456-94a1-85d643a62916'::uuid,
        38,
        102,
        11,
        'M',
        11,
        false,
        NULL,
        NULL
    ),
    (
        '93cce017-1ed2-428d-a02c-f82f5cdfa0c7'::uuid,
        38,
        29,
        12,
        'M',
        12,
        false,
        NULL,
        NULL
    ),
    (
        '3086ff71-375b-4172-a9dc-5aacafa7cd95'::uuid,
        38,
        1,
        13,
        'EN',
        1,
        false,
        NULL,
        NULL
    ),
    (
        '03f5dd53-031f-4d23-81b6-e5c79202f1b5'::uuid,
        38,
        70,
        14,
        'EN',
        2,
        true,
        NULL,
        NULL
    ),
    (
        '7874d6e3-ad92-4a86-b703-dada28b2af47'::uuid,
        38,
        106,
        15,
        'EN',
        3,
        false,
        NULL,
        NULL
    ),
    (
        'b8a3d5f1-2c4e-4a7b-9d1e-3f8c6a0b5d2e'::uuid,
        38,
        30,
        16,
        'OP',
        1,
        false,
        NULL,
        NULL
    ),
    (
        'c9b4e6f2-3d5f-4b8c-0e2f-4a9d7b1c6e3f'::uuid,
        38,
        102,
        17,
        'WEN',
        1,
        false,
        NULL,
        NULL
    );

-- Every real Band has one open name/lineup version. The legacy member columns
-- are intentionally not used by the seed.
INSERT INTO public.band_name_versions (band_id, band_name, band_abbr, valid_from, valid_to, note)
SELECT id, band_name, NULLIF(band_abbr, ''), NULL, NULL, 'base seed current name'
FROM public.band_attrs
WHERE id > 0
ORDER BY id;

INSERT INTO public.band_lineup_versions (
    band_id, version_no, version_label, valid_from, valid_to, predecessor_id, change_type, note
)
SELECT id, 1, band_name || ' V1', NULL, NULL, NULL, 'initial', 'base seed current lineup'
FROM public.band_attrs
WHERE id > 0
ORDER BY id;

INSERT INTO public.band_lineup_version_members (lineup_version_id, member_name, display_order)
SELECT lineup.id, member.member_name, member.display_order
FROM public.band_lineup_versions lineup
JOIN (
    VALUES
        (1, 'Kasumi', 1),
        (1, 'Tae', 2),
        (1, 'Rimi', 3),
        (1, 'Saaya', 4),
        (1, 'Arisa', 5),
        (2, 'Yukina', 1),
        (2, 'Sayo', 2),
        (2, 'Lisa', 3),
        (2, 'Ako', 4),
        (2, 'Rinko', 5),
        (3, 'Tomori', 1),
        (3, 'Anon', 2),
        (3, 'Raana', 3),
        (3, 'Soyo', 4),
        (3, 'Taki', 5)
) member(band_id, member_name, display_order)
    ON member.band_id = lineup.band_id;

WITH effective_pairs AS (
    SELECT *
    FROM (
        VALUES
            (1, 1),
            (1, 2),
            (2, 1),
            (2, 3),
            (38, 1),
            (41, 3)
    ) pair(live_id, band_id)
)
INSERT INTO public.live_band_lineup_contexts (
    live_id, band_id, band_name_version_id, base_lineup_version_id, next_lineup_version_id, note
)
SELECT pairs.live_id, pairs.band_id, name_version.id, lineup.id, NULL, 'base seed current context'
FROM effective_pairs pairs
JOIN public.band_name_versions name_version ON name_version.band_id = pairs.band_id
JOIN public.band_lineup_versions lineup ON lineup.band_id = pairs.band_id;

INSERT INTO public.live_setlist_band_performances (
    setlist_id, live_id, band_id, lineup_usage, handover_baseline
)
SELECT
    setlist.id,
    setlist.live_id,
    CASE
        WHEN setlist.live_id = 1 AND setlist.absolute_order = 1 THEN 1
        WHEN setlist.live_id = 1 AND setlist.absolute_order = 2 THEN 2
        WHEN setlist.live_id = 2 AND setlist.absolute_order = 1 THEN 3
        WHEN setlist.live_id = 2 AND setlist.absolute_order = 2 THEN 1
        WHEN setlist.live_id = 38 THEN 1
    END,
    'base',
    NULL
FROM public.live_setlist setlist
WHERE setlist.live_id IN (1, 2, 38);

INSERT INTO public.live_setlist_band_performance_members (
    setlist_id, band_id, member_name, display_order, appearance_role
)
SELECT
    setlist.id,
    performance.band_id,
    member.member_name,
    member.display_order::integer,
    CASE
        WHEN member.member_name = ANY(
            CASE performance.band_id
                WHEN 1 THEN ARRAY['Kasumi', 'Tae', 'Rimi', 'Saaya', 'Arisa']
                WHEN 2 THEN ARRAY['Yukina', 'Sayo', 'Lisa', 'Ako', 'Rinko']
                WHEN 3 THEN ARRAY['Tomori', 'Anon', 'Raana', 'Soyo', 'Taki']
            END
        ) THEN NULL
        ELSE 'guest'
    END
FROM public.live_setlist setlist
JOIN public.live_setlist_band_performances performance
    ON performance.setlist_id = setlist.id
CROSS JOIN LATERAL unnest(
    CASE
        WHEN setlist.live_id = 1 AND setlist.absolute_order = 1
            THEN ARRAY['Kasumi', 'Tae', 'Rimi', 'Saaya', 'Arisa']
        WHEN setlist.live_id = 1 AND setlist.absolute_order = 2
            THEN ARRAY['Yukina', 'Sayo', 'Lisa', 'Ako']
        WHEN setlist.live_id = 2 AND setlist.absolute_order = 1
            THEN ARRAY['Tomori', 'Anon', 'Raana']
        WHEN setlist.live_id = 2 AND setlist.absolute_order = 2
            THEN ARRAY['Kasumi', 'Tae', 'Saaya', 'Arisa']
        WHEN setlist.live_id = 38 AND setlist.absolute_order = 17
            THEN ARRAY['愛美', '伊藤彩沙']
        WHEN setlist.live_id = 38
            THEN ARRAY['愛美', '大塚紗英', '西本りみ', '大橋彩香', '伊藤彩沙']
    END
) WITH ORDINALITY member(member_name, display_order);

SELECT setval('public.live_attrs_id_seq', (SELECT MAX(id) FROM public.live_attrs), true);
SELECT setval('public.song_list_id_seq', (SELECT MAX(id) FROM public.song_list), true);
SELECT setval('public.venue_list_id_seq', (SELECT MAX(id) FROM public.venue_list), true);
SELECT setval('public.venue_name_versions_id_seq', (SELECT MAX(id) FROM public.venue_name_versions), true);
SELECT setval('public.tour_attrs_id_seq', (SELECT MAX(id) FROM public.tour_attrs), true);
SELECT setval('public.band_name_versions_id_seq', (SELECT MAX(id) FROM public.band_name_versions), true);
SELECT setval('public.band_lineup_versions_id_seq', (SELECT MAX(id) FROM public.band_lineup_versions), true);

COMMIT;

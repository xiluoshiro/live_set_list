BEGIN;

-- Base seed for live_statistic_test.
-- Safe to rerun after Flyway migrate because it truncates business tables first.
TRUNCATE TABLE
    public.audit_logs,
    public.auth_sessions,
    public.user_live_favorites,
    public.app_users,
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

INSERT INTO public.band_attrs (id, band_abbr, band_name, band_members)
VALUES
    (1, 'ppp', 'Poppin''Party', ARRAY['Kasumi', 'Tae', 'Rimi', 'Saaya', 'Arisa']),
    (2, 'rsl', 'Roselia', ARRAY['Yukina', 'Sayo', 'Lisa', 'Ako', 'Rinko']),
    (3, 'mygo', 'MyGO!!!!!', ARRAY['Tomori', 'Anon', 'Raana', 'Soyo', 'Taki']);

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
    venue_id
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
        1
    ),
    (
        2,
        DATE '2026-04-05',
        'Crossover Special Stage',
        false,
        'https://example.com/lives/2',
        TIME WITH TIME ZONE '15:00:00+09',
        TIME WITH TIME ZONE '16:00:00+09',
        2
    ),
    (
        38,
        DATE '2026-01-03',
        'Poppin''Party New Year LIVE「Happy BanG Year!!」',
        true,
        'https://bang-dream.com/events/ppp_live2026/',
        TIME WITH TIME ZONE '17:00:00+09',
        TIME WITH TIME ZONE '18:00:00+09',
        24
    );

INSERT INTO public.live_setlist (
    live_id,
    song_id,
    absolute_order,
    segment_type,
    sub_order,
    is_short,
    band_member,
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
          "Poppin'Party": ["Kasumi", "Tae", "Rimi", "Saaya", "Arisa"]
        }$$::jsonb,
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
        $${
          "Roselia": ["Yukina", "Sayo", "Lisa", "Ako"]
        }$$::jsonb,
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
          "MyGO!!!!!": ["Tomori", "Anon", "Raana"],
          "Special Guest Band": ["Vocal"]
        }$$::jsonb,
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
          "Poppin'Party": ["Kasumi", "Tae", "Saaya", "Arisa"]
        }$$::jsonb,
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
    band_member,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
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
        $${
          "Poppin'Party": ["愛美", "大塚紗英", "西本りみ", "大橋彩香", "伊藤彩沙"]
        }$$::jsonb,
        NULL,
        NULL
    );

SELECT setval('public.live_attrs_id_seq', (SELECT MAX(id) FROM public.live_attrs), true);
SELECT setval('public.song_list_id_seq', (SELECT MAX(id) FROM public.song_list), true);
SELECT setval('public.venue_list_id_seq', (SELECT MAX(id) FROM public.venue_list), true);

COMMIT;

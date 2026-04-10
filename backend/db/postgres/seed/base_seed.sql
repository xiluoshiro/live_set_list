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
    (2, 'Zepp Shinjuku');

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
    (4, 'STAR BEAT!〜ホシノコドウ〜', 1, false);

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

SELECT setval('public.live_attrs_id_seq', (SELECT MAX(id) FROM public.live_attrs), true);
SELECT setval('public.song_list_id_seq', (SELECT MAX(id) FROM public.song_list), true);
SELECT setval('public.venue_list_id_seq', (SELECT MAX(id) FROM public.venue_list), true);

COMMIT;

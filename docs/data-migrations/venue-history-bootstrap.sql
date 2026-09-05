-- Venue 历史名称与重复项一次性整理（本地生产库）
-- 审查日期：2026-09-05
--
-- 前提：目标库为 live_statistic，且 Flyway V28 已成功执行。
-- 本文件不在 Flyway 目录中；执行前先备份本地主库。
-- 日期范围采用 [valid_from, valid_to)。
--
-- 处理内容：
--   1. 为 venue 6、36、90、117 补齐会影响现有 Live 的历史名称；
--   2. 将 Live 405 从歧义项 124 改绑到 101，然后物理删除 124；
--   3. 修正 32/138 的 Venue 类型。
--
-- 核对来源：
--   京王アリーナTOKYO（2025-05-01）
--     https://keio-arena.tokyo/renewal.html
--   Kanadevia Hall（2025-04-01）
--     https://www.tokyo-dome.jp/english/company-news/2025/25-c0116e/
--   ベルーナドーム（2022-03-01）
--     https://www.belluna.co.jp/news/newsrelease/2022/20220117.html
--   2018 年メットライフドーム／ドーム前広場表记
--     https://bang-dream.com/news/264/
--   品川ステラボール两场 Live
--     https://bang-dream.com/discographies/4046/
--     https://bang-dream.com/events/vier/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- 只保留必要的防误操作检查。脚本完整执行后可以安全重跑。
DO $preflight$
BEGIN
    IF current_database() <> 'live_statistic' THEN
        RAISE EXCEPTION 'wrong database: expected live_statistic, got %', current_database();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.flyway_schema_history
        WHERE version = '28' AND success
    ) THEN
        RAISE EXCEPTION 'Flyway V28 has not been applied successfully';
    END IF;

    IF (SELECT count(*) FROM public.venue_list
        WHERE id IN (6, 32, 36, 90, 101, 117, 138)) <> 7 THEN
        RAISE EXCEPTION 'one or more target venues are missing';
    END IF;

    IF EXISTS (SELECT 1 FROM public.venue_list
               WHERE id IN (6, 32, 36, 90, 101, 117, 138)
                 AND merged_into_venue_id IS NOT NULL) THEN
        RAISE EXCEPTION 'a target venue has already been merged';
    END IF;

    IF EXISTS (SELECT 1 FROM public.venue_list WHERE id = 124)
       AND (
           NOT EXISTS (SELECT 1 FROM public.venue_list
                       WHERE id = 124 AND venue = '品川ステラボール')
           OR EXISTS (SELECT 1 FROM public.live_attrs
                      WHERE venue_id = 124 AND id <> 405)
           OR EXISTS (SELECT 1 FROM public.live_schedule_history
                      WHERE previous_venue_id = 124)
           OR EXISTS (SELECT 1 FROM public.venue_list
                      WHERE merged_into_venue_id = 124)
       ) THEN
        RAISE EXCEPTION 'venue 124 differs from the reviewed duplicate-only state';
    END IF;
END
$preflight$;

-- 真实更名：保留一个开放的当前版本，并补入旧版本。
INSERT INTO public.venue_name_versions (venue_id, venue_name, valid_from, valid_to)
SELECT 6, '武蔵野の森総合スポーツプラザ', NULL, DATE '2025-05-01'
WHERE NOT EXISTS (
    SELECT 1 FROM public.venue_name_versions
    WHERE venue_id = 6 AND venue_name = '武蔵野の森総合スポーツプラザ'
      AND valid_from IS NULL AND valid_to = DATE '2025-05-01'
);
UPDATE public.venue_name_versions
SET venue_name = '京王アリーナTOKYO', valid_from = DATE '2025-05-01'
WHERE venue_id = 6 AND valid_to IS NULL;
UPDATE public.venue_list SET venue = '京王アリーナTOKYO' WHERE id = 6;

INSERT INTO public.venue_name_versions (venue_id, venue_name, valid_from, valid_to)
SELECT 36, 'TOKYO DOME CITY HALL', NULL, DATE '2025-04-01'
WHERE NOT EXISTS (
    SELECT 1 FROM public.venue_name_versions
    WHERE venue_id = 36 AND venue_name = 'TOKYO DOME CITY HALL'
      AND valid_from IS NULL AND valid_to = DATE '2025-04-01'
);
UPDATE public.venue_name_versions
SET venue_name = 'Kanadevia Hall', valid_from = DATE '2025-04-01'
WHERE venue_id = 36 AND valid_to IS NULL;
UPDATE public.venue_list SET venue = 'Kanadevia Hall' WHERE id = 36;

INSERT INTO public.venue_name_versions (venue_id, venue_name, valid_from, valid_to)
SELECT 90, 'メットライフドーム', NULL, DATE '2022-03-01'
WHERE NOT EXISTS (
    SELECT 1 FROM public.venue_name_versions
    WHERE venue_id = 90 AND venue_name = 'メットライフドーム'
      AND valid_from IS NULL AND valid_to = DATE '2022-03-01'
);
UPDATE public.venue_name_versions
SET venue_name = 'ベルーナドーム', valid_from = DATE '2022-03-01'
WHERE venue_id = 90 AND valid_to IS NULL;

INSERT INTO public.venue_name_versions (venue_id, venue_name, valid_from, valid_to)
SELECT 117, 'メットライフドーム前広場', NULL, DATE '2022-03-01'
WHERE NOT EXISTS (
    SELECT 1 FROM public.venue_name_versions
    WHERE venue_id = 117 AND venue_name = 'メットライフドーム前広場'
      AND valid_from IS NULL AND valid_to = DATE '2022-03-01'
);
UPDATE public.venue_name_versions
SET venue_name = 'ベルーナドーム前広場', valid_from = DATE '2022-03-01'
WHERE venue_id = 117 AND valid_to IS NULL;

-- 按 Live 日期绑定名称版本；显式列 ID，防止误改未来新增的数据。
UPDATE public.live_attrs
SET venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 6 AND venue_name = '武蔵野の森総合スポーツプラザ'
      AND valid_to = DATE '2025-05-01'
)
WHERE venue_id = 6 AND id IN (13, 14, 170, 171, 474, 475);

UPDATE public.live_attrs
SET venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 36 AND venue_name = 'TOKYO DOME CITY HALL'
      AND valid_to = DATE '2025-04-01'
)
WHERE venue_id = 36 AND id IN (142, 145, 192, 236, 261, 317, 319, 467, 468);

UPDATE public.live_attrs
SET venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 90 AND venue_name = 'メットライフドーム'
      AND valid_to = DATE '2022-03-01'
)
WHERE venue_id = 90 AND id IN (419, 420);

UPDATE public.live_attrs
SET venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 117 AND venue_name = 'メットライフドーム前広場'
      AND valid_to = DATE '2022-03-01'
)
WHERE venue_id = 117 AND id = 387;

UPDATE public.live_schedule_history
SET previous_venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 6 AND venue_name = '武蔵野の森総合スポーツプラザ'
      AND valid_to = DATE '2025-05-01'
)
WHERE previous_venue_id = 6 AND id = 4;

UPDATE public.live_schedule_history
SET previous_venue_name_version_id = (
    SELECT id FROM public.venue_name_versions
    WHERE venue_id = 90 AND venue_name = 'メットライフドーム'
      AND valid_to = DATE '2022-03-01'
)
WHERE previous_venue_id = 90 AND id IN (2, 3);

-- 101/124 是同一场地：统一展示名、改绑唯一引用，然后删除歧义项 124。
UPDATE public.venue_list SET venue = '品川ステラボール' WHERE id = 101;
UPDATE public.venue_name_versions
SET venue_name = '品川ステラボール'
WHERE venue_id = 101 AND valid_to IS NULL;

UPDATE public.live_attrs
SET venue_id = 101,
    venue_name_version_id = (
        SELECT id FROM public.venue_name_versions
        WHERE venue_id = 101 AND valid_to IS NULL
    )
WHERE id = 405 AND venue_id = 124;

DO $before_delete$
BEGIN
    IF EXISTS (SELECT 1 FROM public.live_attrs WHERE venue_id = 124)
       OR EXISTS (SELECT 1 FROM public.live_schedule_history WHERE previous_venue_id = 124)
       OR EXISTS (SELECT 1 FROM public.venue_list WHERE merged_into_venue_id = 124) THEN
        RAISE EXCEPTION 'venue 124 still has references and cannot be deleted';
    END IF;
END
$before_delete$;

DELETE FROM public.venue_name_versions WHERE venue_id = 124;
DELETE FROM public.venue_list WHERE id = 124;

UPDATE public.venue_list SET venue_kind = 'undisclosed' WHERE id = 32;
UPDATE public.venue_list SET venue_kind = 'online' WHERE id = 138;

INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, payload_json)
SELECT NULL, 'venue_data_migration', 'venue', '2015-present-audit-v1',
       jsonb_build_object(
           'historical_venue_ids', jsonb_build_array(6, 36, 90, 117),
           'deleted_venue_id', 124,
           'rebound_live_id', 405,
           'venue_kind_updates', jsonb_build_object('32', 'undisclosed', '138', 'online')
       )
WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action = 'venue_data_migration'
      AND resource_type = 'venue'
      AND resource_id = '2015-present-audit-v1'
);

-- 终态断言：任一条件不符都会回滚整个事务。
DO $verify$
BEGIN
    IF EXISTS (SELECT 1 FROM public.venue_list WHERE id = 124)
       OR EXISTS (SELECT 1 FROM public.venue_name_versions WHERE venue_id = 124)
       OR EXISTS (SELECT 1 FROM public.live_attrs WHERE venue_id = 124)
       OR EXISTS (SELECT 1 FROM public.live_schedule_history WHERE previous_venue_id = 124) THEN
        RAISE EXCEPTION 'venue 124 was not removed completely';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                (13, 6, '武蔵野の森総合スポーツプラザ'),
                (14, 6, '武蔵野の森総合スポーツプラザ'),
                (170, 6, '武蔵野の森総合スポーツプラザ'),
                (171, 6, '武蔵野の森総合スポーツプラザ'),
                (474, 6, '武蔵野の森総合スポーツプラザ'),
                (475, 6, '武蔵野の森総合スポーツプラザ'),
                (142, 36, 'TOKYO DOME CITY HALL'),
                (145, 36, 'TOKYO DOME CITY HALL'),
                (192, 36, 'TOKYO DOME CITY HALL'),
                (236, 36, 'TOKYO DOME CITY HALL'),
                (261, 36, 'TOKYO DOME CITY HALL'),
                (317, 36, 'TOKYO DOME CITY HALL'),
                (319, 36, 'TOKYO DOME CITY HALL'),
                (467, 36, 'TOKYO DOME CITY HALL'),
                (468, 36, 'TOKYO DOME CITY HALL'),
                (419, 90, 'メットライフドーム'),
                (420, 90, 'メットライフドーム'),
                (387, 117, 'メットライフドーム前広場'),
                (307, 101, '品川ステラボール'),
                (405, 101, '品川ステラボール')
        ) AS expected(live_id, venue_id, venue_name)
        LEFT JOIN public.live_attrs live ON live.id = expected.live_id
        LEFT JOIN public.venue_name_versions version
          ON version.id = live.venue_name_version_id AND version.venue_id = live.venue_id
        WHERE live.id IS NULL
           OR live.venue_id <> expected.venue_id
           OR version.venue_name IS DISTINCT FROM expected.venue_name
    ) THEN
        RAISE EXCEPTION 'one or more Live rows use the wrong Venue name version';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                (2, 90, 'メットライフドーム'),
                (3, 90, 'メットライフドーム'),
                (4, 6, '武蔵野の森総合スポーツプラザ')
        ) AS expected(history_id, venue_id, venue_name)
        LEFT JOIN public.live_schedule_history history ON history.id = expected.history_id
        LEFT JOIN public.venue_name_versions version
          ON version.id = history.previous_venue_name_version_id
         AND version.venue_id = history.previous_venue_id
        WHERE history.id IS NULL
           OR history.previous_venue_id <> expected.venue_id
           OR version.venue_name IS DISTINCT FROM expected.venue_name
    ) THEN
        RAISE EXCEPTION 'one or more schedule-history rows use the wrong Venue name version';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.live_attrs live
        LEFT JOIN public.venue_name_versions version ON version.id = live.venue_name_version_id
        WHERE (live.venue_id IS NULL) <> (live.venue_name_version_id IS NULL)
           OR (live.venue_id IS NOT NULL AND version.venue_id IS DISTINCT FROM live.venue_id)
    ) OR EXISTS (
        SELECT 1
        FROM public.live_schedule_history history
        LEFT JOIN public.venue_name_versions version
          ON version.id = history.previous_venue_name_version_id
        WHERE (history.previous_venue_id IS NULL)
                  <> (history.previous_venue_name_version_id IS NULL)
           OR (history.previous_venue_id IS NOT NULL
               AND version.venue_id IS DISTINCT FROM history.previous_venue_id)
    ) THEN
        RAISE EXCEPTION 'a Venue/name-version pair is inconsistent';
    END IF;

    IF EXISTS (
        SELECT venue_id FROM public.venue_name_versions
        GROUP BY venue_id
        HAVING count(*) FILTER (WHERE valid_to IS NULL) <> 1
    ) OR EXISTS (
        SELECT 1
        FROM public.venue_list venue
        JOIN public.venue_name_versions version
          ON version.venue_id = venue.id AND version.valid_to IS NULL
        WHERE venue.venue IS DISTINCT FROM version.venue_name
    ) THEN
        RAISE EXCEPTION 'current Venue name versions are invalid';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.venue_list WHERE id = 32 AND venue_kind = 'undisclosed')
       OR NOT EXISTS (SELECT 1 FROM public.venue_list WHERE id = 138 AND venue_kind = 'online') THEN
        RAISE EXCEPTION 'non-physical Venue kinds are invalid';
    END IF;
END
$verify$;

COMMIT;

-- 执行后人工核对摘要：应返回 9 行，venue 124 不应出现。
SELECT
    venue.id AS venue_id,
    venue.venue AS current_name,
    venue.venue_kind,
    version.id AS version_id,
    version.venue_name,
    version.valid_from,
    version.valid_to,
    (SELECT count(*) FROM public.live_attrs live
     WHERE live.venue_name_version_id = version.id) AS live_count,
    (SELECT count(*) FROM public.live_schedule_history history
     WHERE history.previous_venue_name_version_id = version.id) AS schedule_history_count
FROM public.venue_list venue
JOIN public.venue_name_versions version ON version.venue_id = venue.id
WHERE venue.id IN (6, 36, 90, 101, 117)
ORDER BY venue.id, version.valid_from NULLS FIRST, version.id;

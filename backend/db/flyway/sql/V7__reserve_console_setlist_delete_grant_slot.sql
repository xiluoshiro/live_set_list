-- 保留 V7 版本号，避免已执行过旧 V7 的环境在 Flyway validate 时出现缺失迁移。
-- 当前 console setlist 接口已调整为 append-only，不再需要额外授予 DELETE 权限。

DO $$
BEGIN
    NULL;
END $$;

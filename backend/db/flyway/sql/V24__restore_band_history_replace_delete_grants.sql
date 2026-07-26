-- 恢复/同步会以 --no-privileges 导入 dump；完整集合替换所需的窄范围 DELETE
-- 必须由 migration 与恢复权限重放共同收口，不能只依赖 V21 首次建表时的 ACL。
GRANT DELETE ON TABLE
    public.band_lineup_version_members,
    public.live_band_lineup_contexts,
    public.live_setlist_band_performances,
    public.live_setlist_band_performance_members
TO live_project_super_ro;

-- 完整集合替换需要窄范围 DELETE；恢复/同步后的权限收口也必须保留这些授权。
GRANT DELETE ON TABLE
    public.tour_bands,
    public.tour_lives,
    public.performance_group_lives,
    public.live_setlist
TO live_project_super_ro;

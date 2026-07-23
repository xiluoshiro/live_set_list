-- Setlist 管理以完整目标集合替换行，需要删除目标 Live 的旧行。
GRANT DELETE ON TABLE public.live_setlist TO live_project_super_ro;

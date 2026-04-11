-- 收藏相关写操作改为使用最小权限的前端用户写账号。
-- super_ro 继续保留给更高权限的控制台写接口。

REVOKE DELETE ON TABLE public.user_live_favorites FROM live_project_super_ro;

GRANT USAGE ON SCHEMA public TO live_project_user_rw;
GRANT SELECT ON TABLE public.live_attrs TO live_project_user_rw;
GRANT INSERT, DELETE ON TABLE public.user_live_favorites TO live_project_user_rw;
GRANT INSERT ON TABLE public.audit_logs TO live_project_user_rw;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.user_live_favorites_id_seq TO live_project_user_rw;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_logs_id_seq TO live_project_user_rw;

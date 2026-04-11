import { useEffect, useState } from "react";

type LoginDialogProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (params: { username: string; password: string }) => Promise<void> | void;
};

export function LoginDialog({ open, loading, error, onClose, onSubmit }: LoginDialogProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal login-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>登录</h2>
          <div className="modal-actions">
            <button
              type="button"
              className="modal-action-btn close"
              title="关闭"
              aria-label="关闭"
              onClick={onClose}
            >
              <span className="modal-action-glyph close">✕</span>
            </button>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSubmit({ username, password });
          }}
        >
          <label className="login-field">
            <span>用户名</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={loading}
              required
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <div className="login-actions">
            <button type="button" className="secondary-btn" onClick={onClose} disabled={loading}>
              取消
            </button>
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? "登录中..." : "登录"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

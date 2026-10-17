import React, { useState } from 'react';
import adminApi from '../services/adminApi';
import './AdminLogin.css';

const AdminLogin = ({ isOpen, onClose, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!username.trim()) {
      setErrorMessage('Vui lòng nhập tên đăng nhập.');
      return;
    }
    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      const result = await adminApi.login(username, password);
      // Kết quả trả về gồm user và csrf_token
      if (onLoginSuccess) {
        onLoginSuccess(result.user);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Đăng nhập thất bại. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-overlay" onClick={onClose}>
      <div className="admin-login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-login-header">
          <div className="admin-login-header-text">
            <h3>🔐 Đăng nhập Quản trị MSVT</h3>
            <p>Hệ thống WebGIS Quản lý Mã số Vùng trồng Nghệ An</p>
          </div>
          <button
            type="button"
            className="admin-login-close-btn"
            onClick={onClose}
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-body">
          {errorMessage && (
            <div className="admin-login-error">
              <span>⚠️</span>
              <div>{errorMessage}</div>
            </div>
          )}

          <div className="admin-login-field">
            <label className="admin-login-label">Tên đăng nhập</label>
            <div className="admin-login-input-wrap">
              <input
                type="text"
                className="admin-login-input"
                placeholder="Nhập username (admin / viewer)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <div className="admin-login-field">
            <label className="admin-login-label">Mật khẩu</label>
            <div className="admin-login-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="admin-login-input"
                placeholder="Nhập mật khẩu..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="admin-login-toggle-pw"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="admin-login-submit-btn"
            disabled={loading}
          >
            {loading ? 'Đang xác thực...' : 'Đăng nhập ngay'}
          </button>

          <div className="admin-login-note">
            🛡️ Bảo mật: Phiên xác thực qua Cookie HttpOnly và Argon2id. Tuyệt đối không lưu mật khẩu hoặc JWT trong trình duyệt.
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;

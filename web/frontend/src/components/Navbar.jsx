import React, { useState, useEffect } from 'react';
import './Navbar.css';

/**
 * Navbar - Thanh điều hướng chuyên dụng Hệ thống WebGIS Quản lý Mã số Vùng trồng (MSVT)
 * Hỗ trợ tối ưu Responsive:
 * - Desktop: Thanh ngang đầy đủ, chuẩn WebGIS
 * - Mobile & Tablet: Hamburger menu, Drawer trượt mượt mà, mục chạm >= 44px
 */
const Navbar = ({
  // Điều khiển chế độ xem & Lớp MSVT
  onResetMapView = () => {},
  showMsvtLayer = true,
  setShowMsvtLayer = () => {},
  showMsvtPanel = false,
  setShowMsvtPanel = () => {},
  msvtStats = { total: 42 },
  onOpenStats = () => {},

  // Phân quyền & Quản trị
  currentUser = null,
  onOpenLogin = () => {},
  onOpenAdminDashboard = () => {},
  onLogout = () => {}
}) => {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Đóng mobile menu khi nhấn phím Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    if (mobileMenuOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Đóng mobile menu khi chuyển hướng hoặc resize lên màn hình lớn
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 860) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleAction = (callback) => {
    setMobileMenuOpen(false);
    if (callback) callback();
  };

  return (
    <header className="navbar-container">
      {/* 1. Logo & Tên hệ thống bên trái */}
      <div className="navbar-brand-section">
        <div 
          className="navbar-brand-logo" 
          onClick={onResetMapView}
          role="button"
          tabIndex={0}
          title="Về bản đồ toàn cảnh"
        >
          <span className="navbar-logo-icon">🌱</span>
          <span className="navbar-logo-text-desktop">WEBGIS VÙNG TRỒNG</span>
          <span className="navbar-logo-text-mobile">WEBGIS MSVT</span>
        </div>
        <span className="navbar-brand-badge">Nghệ An</span>
      </div>

      {/* 2. Nhóm các nút chức năng Desktop */}
      <nav className="navbar-nav-section">
        {/* Nút Bản đồ: đưa về chế độ xem bản đồ toàn cảnh */}
        <button
          type="button"
          className="navbar-nav-btn navbar-nav-btn-map"
          onClick={onResetMapView}
          title="Trở về chế độ xem bản đồ toàn cảnh vùng trồng"
        >
          <span>🗺️</span>
          <span>Bản đồ</span>
        </button>

        {/* Nút Bật/Tắt Lớp Vùng trồng MSVT */}
        <button
          type="button"
          className={`navbar-nav-btn navbar-nav-btn-msvt ${!showMsvtLayer ? 'inactive' : ''}`}
          onClick={() => setShowMsvtLayer(prev => !prev)}
          title="Bật hoặc tắt hiển thị lớp đối tượng không gian MSVT trên bản đồ"
        >
          <span>🌿</span>
          <span>{showMsvtLayer ? 'Vùng trồng MSVT' : 'Tắt MSVT'}</span>
          <span className="navbar-badge-count">
            {msvtStats?.total || 42}
          </span>
        </button>

        {/* Nút Tra cứu & Bộ lọc */}
        <button
          type="button"
          className={`navbar-nav-btn navbar-nav-btn-lookup ${showMsvtPanel ? 'active' : ''}`}
          onClick={() => setShowMsvtPanel(prev => !prev)}
          title="Mở Bảng điều khiển tra cứu tọa độ GPS và bộ lọc vùng trồng"
        >
          <span>🔎</span>
          <span>Tra cứu & Bộ lọc</span>
        </button>

        {/* Nút Thống kê tổng hợp */}
        <button
          type="button"
          className="navbar-nav-btn navbar-nav-btn-stats"
          onClick={onOpenStats}
          title="Xem báo cáo thống kê tổng hợp số lượng, diện tích và sản lượng MSVT"
        >
          <span>📊</span>
          <span>Thống kê</span>
        </button>

        {/* Nút Quản lý MSVT: CHỈ HIỂN THỊ KHI TÀI KHOẢN CÓ QUYỀN ADMIN */}
        {isAdmin && (
          <button
            type="button"
            className="navbar-nav-btn navbar-nav-btn-admin"
            onClick={onOpenAdminDashboard}
            title="Mở Trung tâm Quản trị thêm, sửa, xóa mềm vùng trồng MSVT"
          >
            <span>⚙️</span>
            <span>Quản lý MSVT</span>
          </button>
        )}
      </nav>

      {/* 3. Tài khoản & Đăng nhập / Đăng xuất Desktop */}
      <div className="navbar-user-section">
        {currentUser ? (
          <>
            <div className="navbar-user-badge">
              <span>👤</span>
              <span className="navbar-username">{currentUser.username}</span>
              <span className={`navbar-role-pill ${currentUser.role === 'admin' ? 'admin' : 'viewer'}`}>
                {currentUser.role === 'admin' ? 'Admin' : 'Viewer'}
              </span>
            </div>
            <button
              type="button"
              className="navbar-btn-logout"
              onClick={onLogout}
              title="Đăng xuất phiên làm việc hiện tại"
            >
              Đăng xuất
            </button>
          </>
        ) : (
          <button
            type="button"
            className="navbar-btn-login"
            onClick={onOpenLogin}
            title="Đăng nhập tài khoản Quản trị viên MSVT"
          >
            <span>🔐</span>
            <span>Đăng nhập Admin</span>
          </button>
        )}
      </div>

      {/* 4. Nút Hamburger Menu trên Mobile / Tablet */}
      <button
        type="button"
        className={`navbar-hamburger-btn ${mobileMenuOpen ? 'active' : ''}`}
        onClick={() => setMobileMenuOpen(prev => !prev)}
        aria-label={mobileMenuOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}
        aria-expanded={mobileMenuOpen}
      >
        <span className="hamburger-bar"></span>
        <span className="hamburger-bar"></span>
        <span className="hamburger-bar"></span>
      </button>

      {/* 5. Mobile Drawer Menu & Backdrop */}
      {mobileMenuOpen && (
        <>
          <div 
            className="navbar-mobile-backdrop" 
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="navbar-mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu điều hướng">
            {/* Header Mobile Drawer */}
            <div className="navbar-mobile-header">
              <div className="navbar-mobile-title">
                <span>🌱</span>
                <span>WebGIS MSVT</span>
                <span className="navbar-brand-badge">Nghệ An</span>
              </div>
              <button
                type="button"
                className="navbar-mobile-close-btn"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Đóng menu"
              >
                ✕
              </button>
            </div>

            {/* Thông tin tài khoản trên Mobile */}
            <div className="navbar-mobile-account-section">
              {currentUser ? (
                <div className="navbar-mobile-account-card">
                  <div className="navbar-mobile-account-info">
                    <span className="navbar-mobile-account-icon">👤</span>
                    <div>
                      <div className="navbar-mobile-username">{currentUser.username}</div>
                      <div className="navbar-mobile-role">
                        Vai trò: <strong style={{ color: currentUser.role === 'admin' ? '#15803d' : '#0284c7' }}>
                          {currentUser.role === 'admin' ? 'Quản trị viên (Admin)' : 'Người xem (Viewer)'}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="navbar-mobile-btn-logout"
                    onClick={() => handleAction(onLogout)}
                  >
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="navbar-mobile-btn-login"
                  onClick={() => handleAction(onOpenLogin)}
                >
                  <span>🔐</span>
                  <span>Đăng nhập Quản trị viên</span>
                </button>
              )}
            </div>

            {/* Danh sách chức năng điều hướng Mobile */}
            <div className="navbar-mobile-links">
              <button
                type="button"
                className="navbar-mobile-item"
                onClick={() => handleAction(onResetMapView)}
              >
                <span className="navbar-mobile-item-icon">🗺️</span>
                <span className="navbar-mobile-item-text">Bản đồ toàn cảnh MSVT</span>
              </button>

              <button
                type="button"
                className={`navbar-mobile-item ${showMsvtLayer ? 'active-layer' : ''}`}
                onClick={() => handleAction(() => setShowMsvtLayer(prev => !prev))}
              >
                <span className="navbar-mobile-item-icon">🌿</span>
                <span className="navbar-mobile-item-text">
                  {showMsvtLayer ? 'Lớp Vùng trồng MSVT' : 'Lớp Vùng trồng (Đang tắt)'}
                </span>
                <span className="navbar-mobile-badge">
                  {msvtStats?.total || 42} vùng
                </span>
              </button>

              <button
                type="button"
                className={`navbar-mobile-item ${showMsvtPanel ? 'active-panel' : ''}`}
                onClick={() => handleAction(() => setShowMsvtPanel(prev => !prev))}
              >
                <span className="navbar-mobile-item-icon">🔎</span>
                <span className="navbar-mobile-item-text">Tra cứu GPS & Bộ lọc</span>
                <span className="navbar-mobile-badge" style={{ backgroundColor: showMsvtPanel ? '#dcfce7' : '#f1f5f9', color: showMsvtPanel ? '#15803d' : '#64748b' }}>
                  {showMsvtPanel ? 'Đang mở' : 'Mở bảng'}
                </span>
              </button>

              <button
                type="button"
                className="navbar-mobile-item"
                onClick={() => handleAction(onOpenStats)}
              >
                <span className="navbar-mobile-item-icon">📊</span>
                <span className="navbar-mobile-item-text">Báo cáo Thống kê tổng hợp</span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  className="navbar-mobile-item navbar-mobile-item-admin"
                  onClick={() => handleAction(onOpenAdminDashboard)}
                >
                  <span className="navbar-mobile-item-icon">⚙️</span>
                  <span className="navbar-mobile-item-text">Trung tâm Quản trị MSVT</span>
                  <span className="navbar-mobile-badge-admin">Admin</span>
                </button>
              )}
            </div>

            {/* Footer Mobile Drawer */}
            <div className="navbar-mobile-footer">
              <div>Sở Nông nghiệp & PTNT Nghệ An</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                Hệ thống WebGIS Quản lý Mã số Vùng trồng
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
};

export default Navbar;

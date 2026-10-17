import React from 'react';
import './Navbar.css';

/**
 * Navbar - Thanh điều hướng chuyên dụng Hệ thống WebGIS Quản lý Mã số Vùng trồng (MSVT)
 * Bố cục chuẩn:
 * [🌱 WEBGIS VÙNG TRỒNG] [🗺️ Bản đồ] [🌿 Vùng trồng MSVT] [🔎 Tra cứu & Bộ lọc] [📊 Thống kê] [⚙️ Quản lý MSVT] [👤 Đăng nhập/Đăng xuất]
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

  return (
    <header className="navbar-container">
      {/* 1. Logo & Tên hệ thống bên trái */}
      <div className="navbar-brand-section">
        <div className="navbar-brand-logo">
          <span>🌱</span>
          <span>WEBGIS VÙNG TRỒNG</span>
        </div>
        <span className="navbar-brand-badge">Nghệ An</span>
      </div>

      {/* 2. Nhóm các nút chức năng WebGIS MSVT */}
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
          <span style={{
            fontSize: '11px',
            opacity: 0.9,
            backgroundColor: showMsvtLayer ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.08)',
            padding: '1px 6px',
            borderRadius: '10px'
          }}>
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

      {/* 3. Tài khoản & Đăng nhập / Đăng xuất bên phải */}
      <div className="navbar-user-section">
        {currentUser ? (
          <>
            <div className="navbar-user-badge">
              <span>👤</span>
              <span>{currentUser.username}</span>
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
    </header>
  );
};

export default Navbar;

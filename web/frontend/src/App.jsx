import React, { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import Navbar from './components/Navbar';
import MsvtSidebar from './components/MsvtSidebar';
import MsvtStatsModal from './components/MsvtStatsModal';
import AdminLogin from './components/AdminLogin';
import MsvtAdminDashboard from './components/MsvtAdminDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import adminApi from './services/adminApi';
import msvtApi from './services/msvtApi';
import './App.css';

/**
 * App - Giao diện chính Hệ thống WebGIS Quản lý Mã số Vùng trồng (MSVT)
 */
function App() {
  // 1. Trạng thái hiển thị Lớp Bản đồ & Bảng điều khiển MSVT
  const [showMsvtLayer, setShowMsvtLayer] = useState(true);
  const [showMsvtPanel, setShowMsvtPanel] = useState(false);
  const [selectedMsvtRegion, setSelectedMsvtRegion] = useState(null);
  const [focusFeature, setFocusFeature] = useState(null);
  const [msvtFilters, setMsvtFilters] = useState({ msvt: '', loaiCay: '', thiTruong: '' });
  const [msvtStats, setMsvtStats] = useState({ total: 42, pointCount: 17, polyCount: 25 });
  const [clickedCoord, setClickedCoord] = useState(null);
  const [msvtActiveTab, setMsvtActiveTab] = useState('detail'); // 'detail' | 'lookup' | 'filter'
  const [resetViewTrigger, setResetViewTrigger] = useState(0);

  // 2. Trạng thái Modal Thống kê tổng hợp
  const [showStatsModal, setShowStatsModal] = useState(false);

  // 3. Trạng thái Xác thực & Quản trị viên (Admin / Viewer)
  const [currentUser, setCurrentUser] = useState(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [msvtRefreshTrigger, setMsvtRefreshTrigger] = useState(0);

  // Tự động kiểm tra phiên làm việc qua Cookie HttpOnly khi mở ứng dụng
  useEffect(() => {
    adminApi.getMe()
      .then((user) => {
        if (user && user.is_active) {
          setCurrentUser(user);
        }
      })
      .catch((err) => {
        console.warn('[App] Không thể kiểm tra phiên đăng nhập:', err);
      });
  }, []);

  // Đăng xuất tài khoản
  const handleLogout = async () => {
    try {
      await adminApi.logout();
    } catch (err) {
      console.warn('[App] Lỗi khi đăng xuất:', err);
    } finally {
      setCurrentUser(null);
      setShowAdminDashboard(false);
    }
  };

  // Làm mới bản đồ và thống kê khi có thay đổi từ trang quản trị
  const handleMsvtDataModified = () => {
    setMsvtRefreshTrigger(prev => prev + 1);
    msvtApi.getStatistics().then(stats => {
      if (stats) {
        setMsvtStats({
          total: stats.total_regions,
          pointCount: stats.geometry_stats?.point_count || 0,
          polyCount: stats.geometry_stats?.multipolygon_count || 0
        });
      }
    }).catch(() => {});
  };

  // Chọn vùng trồng từ bản đồ hoặc bảng: mở chi tiết trong Sidebar
  const handleSelectMsvtRegion = (properties, feature) => {
    const enrichedProperties = {
      ...properties,
      geometry: feature?.geometry || properties.geometry
    };
    setSelectedMsvtRegion(enrichedProperties);
    setShowMsvtPanel(true);
    setMsvtActiveTab('detail');
    if (feature) {
      setFocusFeature(feature);
    }
  };

  // Phóng đến vùng trồng từ danh sách
  const handleFlyToRegion = (region) => {
    setSelectedMsvtRegion(region);
    setShowMsvtPanel(true);
    setMsvtActiveTab('detail');
    if (region.geometry) {
      setFocusFeature({ geometry: region.geometry, properties: region });
    } else if (region.id) {
      msvtApi.getGeoJSON().then((data) => {
        const found = data?.features?.find((f) => f.properties?.id === region.id);
        if (found && found.geometry) {
          setFocusFeature(found);
        }
      }).catch(() => {});
    }
  };

  // Tra cứu nhanh từ điểm nhấp trên bản đồ
  const handleQuickLookupCoord = (coord) => {
    setClickedCoord(coord);
    setShowMsvtPanel(true);
    setMsvtActiveTab('lookup');
  };

  // Phóng đến tọa độ GPS cụ thể (cho clickedCoord hoặc tọa độ nhập thủ công)
  const handleFlyToCoord = (coord) => {
    if (coord && coord.lat && coord.lng) {
      setFocusFeature({
        geometry: {
          type: 'Point',
          coordinates: [Number(coord.lng), Number(coord.lat)]
        },
        properties: { id: `gps_${Date.now()}` }
      });
    }
  };

  // Thay đổi bộ lọc vùng trồng
  const handleMsvtFilterChange = (key, value) => {
    setMsvtFilters(prev => ({ ...prev, [key]: value }));
  };

  // Đặt lại bộ lọc vùng trồng
  const handleResetMsvtFilters = () => {
    setMsvtFilters({ msvt: '', loaiCay: '', thiTruong: '' });
  };

  // Xóa vùng đang chọn
  const handleClearMsvtSelection = () => {
    setSelectedMsvtRegion(null);
    setFocusFeature(null);
  };

  // Đưa về chế độ xem bản đồ toàn cảnh
  const handleResetMapView = () => {
    setResetViewTrigger(prev => prev + 1);
    setShowMsvtPanel(false);
  };

  return (
    <div className="app-container">
      {/* Thanh điều hướng WebGIS MSVT */}
      <Navbar 
        onResetMapView={handleResetMapView}
        showMsvtLayer={showMsvtLayer}
        setShowMsvtLayer={setShowMsvtLayer}
        showMsvtPanel={showMsvtPanel}
        setShowMsvtPanel={setShowMsvtPanel}
        msvtStats={msvtStats}
        onOpenStats={() => setShowStatsModal(true)}
        currentUser={currentUser}
        onOpenLogin={() => setShowAdminLogin(true)}
        onOpenAdminDashboard={() => setShowAdminDashboard(true)}
        onLogout={handleLogout}
      />

      {/* Nội dung chính: Bản đồ chiếm toàn bộ màn hình, Sidebar chỉ mở khi cần */}
      <main className="main-content">
        <div className="map-section">
          <MapViewer 
            showMsvtLayer={showMsvtLayer}
            selectedMsvtRegion={selectedMsvtRegion}
            onSelectMsvtRegion={handleSelectMsvtRegion}
            msvtFilters={msvtFilters}
            onMsvtStatsUpdate={setMsvtStats}
            focusFeature={focusFeature}
            clickedCoord={clickedCoord}
            onMapClick={setClickedCoord}
            onQuickLookupCoord={handleQuickLookupCoord}
            onFlyToCoord={handleFlyToCoord}
            msvtRefreshTrigger={msvtRefreshTrigger}
            resetViewTrigger={resetViewTrigger}
            onResetView={handleResetMapView}
            showMsvtPanel={showMsvtPanel}
          />
        </div>

        {/* Sidebar chỉ xuất hiện khi người dùng mở Tra cứu, Bộ lọc hoặc Chi tiết */}
        {showMsvtPanel && (
          <>
            <div
              className="sidebar-backdrop"
              onClick={() => setShowMsvtPanel(false)}
              aria-hidden="true"
            />
            <aside className="sidebar-section" aria-label="Bảng điều khiển và tra cứu MSVT">
              <MsvtSidebar
                selectedRegion={selectedMsvtRegion}
                onClearSelection={handleClearMsvtSelection}
                onFlyToRegion={handleFlyToRegion}
                onFlyToCoord={handleFlyToCoord}
                filters={msvtFilters}
                onFilterChange={handleMsvtFilterChange}
                onResetFilters={handleResetMsvtFilters}
                clickedCoord={clickedCoord}
                stats={msvtStats}
                onClose={() => setShowMsvtPanel(false)}
                activeTab={msvtActiveTab}
                setActiveTab={setMsvtActiveTab}
              />
            </aside>
          </>
        )}
      </main>

      {/* Modal Báo cáo Thống kê tổng hợp */}
      <MsvtStatsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
      />

      {/* Modal Đăng nhập Admin / Viewer */}
      <AdminLogin
        isOpen={showAdminLogin}
        onClose={() => setShowAdminLogin(false)}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          if (user.role === 'admin') {
            setShowAdminDashboard(true);
          }
        }}
      />

      {/* Dashboard Quản trị MSVT (Chỉ hiển thị khi tài khoản có quyền Admin) */}
      <ErrorBoundary onReset={() => setShowAdminDashboard(false)}>
        <MsvtAdminDashboard
          isOpen={showAdminDashboard && currentUser?.role === 'admin'}
          onClose={() => setShowAdminDashboard(false)}
          currentUser={currentUser}
          onDataModified={handleMsvtDataModified}
          clickedCoord={clickedCoord}
        />
      </ErrorBoundary>
    </div>
  );
}

export default App;

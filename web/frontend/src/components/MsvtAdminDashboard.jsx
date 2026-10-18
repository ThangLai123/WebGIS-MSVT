import React, { useState, useEffect, useCallback } from 'react';
import adminApi from '../services/adminApi';
import msvtApi from '../services/msvtApi';
import MsvtAdminTable from './MsvtAdminTable';
import MsvtRegionForm from './MsvtRegionForm';
import MsvtDeleteDialog from './MsvtDeleteDialog';
import MsvtImportModal from './MsvtImportModal';
import ErrorBoundary from './ErrorBoundary';
import './MsvtAdminDashboard.css';

const MsvtAdminDashboard = ({
  isOpen,
  onClose,
  currentUser,
  onDataModified = () => {},
  clickedCoord = null
}) => {
  // Bảng dữ liệu & Phân trang
  const [regions, setRegions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Bộ lọc
  const [searchMsvt, setSearchMsvt] = useState('');
  const [filterLoaiCay, setFilterLoaiCay] = useState('');
  const [filterThiTruong, setFilterThiTruong] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Thống kê Dashboard
  const [dashboardStats, setDashboardStats] = useState({
    totalRegions: 0,
    totalAreaHa: 0,
    totalYieldTons: 0,
    pointCount: 0,
    polyCount: 0,
    noneGeomCount: 0
  });

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedForEdit, setSelectedForEdit] = useState(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedForDetail, setSelectedForDetail] = useState(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Thông báo Toast
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 4500);
  };

  const handleImportSuccess = (result) => {
    fetchAdminRegions(1, pageSize);
    fetchStats();
    onDataModified();
    showToast(
      `Nhập hoàn tất: thêm ${result.inserted_count} vùng trồng mới, bỏ qua ${result.skipped_count} bản ghi trùng.`
    );
  };

  // Tải dữ liệu danh sách quản trị
  const fetchAdminRegions = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const data = await adminApi.getAdminRegions({
        page: targetPage,
        pageSize: targetPageSize,
        msvt: searchMsvt,
        loaiCay: filterLoaiCay,
        thiTruong: filterThiTruong,
        includeDeleted
      });

      setRegions(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải danh sách vùng trồng.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchMsvt, filterLoaiCay, filterThiTruong, includeDeleted]);

  // Tải thống kê số liệu
  const fetchStats = useCallback(async () => {
    try {
      const stats = await msvtApi.getStatistics();
      if (stats) {
        setDashboardStats({
          totalRegions: stats.total_regions || 0,
          totalAreaHa: stats.total_area_ha || 0,
          totalYieldTons: stats.total_recorded_yield_tons || 0,
          pointCount: stats.geometry_stats?.point_count || 0,
          polyCount: stats.geometry_stats?.multipolygon_count || 0,
          noneGeomCount: stats.geometry_stats?.without_geometry_count || 0
        });
      }
    } catch (err) {
      console.warn('[MsvtAdminDashboard] Lỗi tải thống kê:', err);
    }
  }, []);

  // Tải dữ liệu ban đầu khi mở dashboard hoặc thay đổi bộ lọc
  useEffect(() => {
    if (isOpen) {
      fetchAdminRegions(1, pageSize);
      fetchStats();
    }
  }, [isOpen, searchMsvt, filterLoaiCay, filterThiTruong, includeDeleted, pageSize]);

  if (!isOpen) return null;

  // Handlers thao tác
  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchAdminRegions(newPage, pageSize);
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize);
    setPage(1);
    fetchAdminRegions(1, newSize);
  };

  const handleResetFilters = () => {
    setSearchMsvt('');
    setFilterLoaiCay('');
    setFilterThiTruong('');
    setIncludeDeleted(false);
  };

  const handleCreateNew = () => {
    setSelectedForEdit(null);
    setIsFormOpen(true);
  };

  const handleEdit = async (region) => {
    try {
      const fullDetail = await adminApi.getAdminRegionDetail(region.id);
      setSelectedForEdit(fullDetail || region);
    } catch (err) {
      console.warn('[Dashboard] Không thể tải chi tiết hình học vùng trồng:', err);
      setSelectedForEdit(region);
    }
    setIsFormOpen(true);
  };

  const handleDelete = (region) => {
    setSelectedForDelete(region);
    setIsDeleteOpen(true);
  };

  const handleViewDetail = (region) => {
    setSelectedForDetail(region);
    setIsDetailOpen(true);
  };

  const handleFormSuccess = (savedRegion) => {
    showToast(selectedForEdit ? `Đã cập nhật vùng trồng #${savedRegion.id} thành công!` : `Đã thêm mới vùng trồng #${savedRegion.id} thành công!`);
    fetchAdminRegions(page, pageSize);
    fetchStats();
    onDataModified();
  };

  const handleDeleteSuccess = (deletedRegion) => {
    showToast(`Đã xóa mềm vùng trồng ${deletedRegion.msvt_moi || deletedRegion.msvt_cu || '#' + deletedRegion.id} thành công!`);
    fetchAdminRegions(page, pageSize);
    fetchStats();
    onDataModified();
  };

  return (
    <div className="msvt-dashboard-overlay" onClick={onClose}>
      <div className="msvt-dashboard-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="msvt-dashboard-header">
          <div className="msvt-dashboard-title-area">
            <h2 className="msvt-dashboard-title">🌱 Trung Tâm Quản Trị Vùng Trồng MSVT</h2>
            <span className="msvt-dashboard-badge">
              Quản trị viên: {currentUser?.username || 'admin'}
            </span>
          </div>

          <div className="msvt-dashboard-header-actions">
            <button
              type="button"
              className="msvt-dash-btn-add"
              onClick={handleCreateNew}
              title="Thêm mới một mã số vùng trồng"
            >
              ➕ Thêm vùng trồng
            </button>
            <button
              type="button"
              className="msvt-dash-btn-import"
              onClick={() => setIsImportOpen(true)}
              title="Nhập nhanh danh sách vùng trồng hàng loạt từ tệp Excel"
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13.5px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.2s'
              }}
            >
              📤 Nhập nhanh từ Excel
            </button>
            <button
              type="button"
              className="msvt-dash-btn-refresh"
              onClick={() => {
                fetchAdminRegions(page, pageSize);
                fetchStats();
              }}
              title="Làm mới bảng dữ liệu"
            >
              🔄 Tải lại
            </button>
            <button
              type="button"
              className="msvt-dash-btn-close"
              onClick={onClose}
              title="Đóng trang quản trị"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Khung thân Dashboard cuộn mượt mà trên Mobile & cố định trên Desktop */}
        <div className="msvt-dashboard-body">
          {/* Thông báo Toast */}
          {toastMessage && (
            <div className="msvt-dashboard-toast">
              <span>✅</span>
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Stats Cards */}
          <div className="msvt-dashboard-stats-grid">
            <div className="msvt-stat-card green">
              <span className="msvt-stat-label">Tổng vùng trồng hoạt động</span>
              <span className="msvt-stat-value">{dashboardStats.totalRegions}</span>
              <span className="msvt-stat-sub">Đang hiển thị trên bản đồ WebGIS</span>
            </div>

            <div className="msvt-stat-card blue">
              <span className="msvt-stat-label">Tổng diện tích canh tác</span>
              <span className="msvt-stat-value">
                {Number(dashboardStats.totalAreaHa).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ha
              </span>
              <span className="msvt-stat-sub">Diện tích hợp pháp được cấp mã</span>
            </div>

            <div className="msvt-stat-card amber">
              <span className="msvt-stat-label">Tổng sản lượng ghi nhận</span>
              <span className="msvt-stat-value">
                {Number(dashboardStats.totalYieldTons).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tấn
              </span>
              <span className="msvt-stat-sub">Lưu trữ từ CSDL nguồn</span>
            </div>

            <div className="msvt-stat-card purple">
              <span className="msvt-stat-label">Đối tượng không gian GIS</span>
              <span className="msvt-stat-value">
                {dashboardStats.polyCount + dashboardStats.pointCount} <small style={{ fontSize: '13px', fontWeight: 500 }}>/ {dashboardStats.totalRegions}</small>
              </span>
              <span className="msvt-stat-sub">
                🟩 {dashboardStats.polyCount} đa giác • 🔵 {dashboardStats.pointCount} điểm mốc
              </span>
            </div>
          </div>

          {/* Toolbar: Tìm kiếm & Lọc (Responsive Mobile) */}
          <div className="msvt-dashboard-toolbar">
            <div className="msvt-toolbar-search-row">
              <input
                type="text"
                className="msvt-toolbar-input msvt-toolbar-search-input"
                placeholder="🔍 Tìm mã MSVT, tổ chức, người đại diện..."
                value={searchMsvt}
                onChange={(e) => setSearchMsvt(e.target.value)}
              />
              <button
                type="button"
                className={`msvt-toolbar-mobile-filter-btn ${Boolean(filterLoaiCay || filterThiTruong || includeDeleted) ? 'has-filter' : ''}`}
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                title="Mở bộ lọc nâng cao"
              >
                <span>⚙️ Lọc</span>
                {Boolean(filterLoaiCay || filterThiTruong || includeDeleted) && <span className="msvt-filter-dot">●</span>}
              </button>
            </div>

            <div className={`msvt-toolbar-extra-filters ${showMobileFilters ? 'is-open' : ''}`}>
              <input
                type="text"
                className="msvt-toolbar-input msvt-toolbar-filter-input"
                placeholder="🌾 Lọc cây trồng (Lúa, Cam...)"
                value={filterLoaiCay}
                onChange={(e) => setFilterLoaiCay(e.target.value)}
              />

              <input
                type="text"
                className="msvt-toolbar-input msvt-toolbar-filter-input"
                placeholder="🌐 Lọc thị trường..."
                value={filterThiTruong}
                onChange={(e) => setFilterThiTruong(e.target.value)}
              />

              <button
                type="button"
                className="msvt-toolbar-btn-reset"
                onClick={handleResetFilters}
                title="Xóa toàn bộ bộ lọc"
              >
                Đặt lại
              </button>

              <label className="msvt-toolbar-checkbox">
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />
                <span>Xem cả bản ghi đã xóa mềm</span>
              </label>
            </div>
          </div>

          {/* Thanh tổng kết số lượng & bộ lọc đang kích hoạt */}
          <div className="msvt-dashboard-summary-bar">
            <span>📋 Danh sách: <strong>{total}</strong> vùng trồng</span>
            {searchMsvt && <span className="msvt-summary-tag">🔍 "{searchMsvt}"</span>}
            {filterLoaiCay && <span className="msvt-summary-tag">🌾 "{filterLoaiCay}"</span>}
            {filterThiTruong && <span className="msvt-summary-tag">🌐 "{filterThiTruong}"</span>}
            {includeDeleted && <span className="msvt-summary-tag" style={{ color: '#b91c1c' }}>⚠️ Gồm đã xóa mềm</span>}
          </div>

          {/* Lỗi nếu có */}
          {errorMessage && (
            <div style={{
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '10px 24px',
              fontSize: '13px',
              borderBottom: '1px solid #fecaca'
            }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {/* Content Bảng dữ liệu / Card List */}
          <div className="msvt-dashboard-content">
            <MsvtAdminTable
              regions={regions}
              loading={loading}
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              onViewDetail={handleViewDetail}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      {/* Modal Thêm / Sửa */}
      {isFormOpen && (
        <ErrorBoundary onReset={() => setIsFormOpen(false)}>
          <MsvtRegionForm
            isOpen={isFormOpen}
            region={selectedForEdit}
            clickedCoord={clickedCoord}
            onClose={() => setIsFormOpen(false)}
            onSuccess={handleFormSuccess}
          />
        </ErrorBoundary>
      )}

      {/* Modal Xác nhận Xóa mềm */}
      {isDeleteOpen && (
        <MsvtDeleteDialog
          isOpen={isDeleteOpen}
          region={selectedForDelete}
          onClose={() => setIsDeleteOpen(false)}
          onSuccess={handleDeleteSuccess}
        />
      )}

      {/* Modal Xem chi tiết bản ghi */}
      {isDetailOpen && selectedForDetail && (
        <div className="msvt-detail-modal-overlay" onClick={() => setIsDetailOpen(false)}>
          <div className="msvt-detail-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="msvt-detail-modal-header">
              <h3 className="msvt-detail-modal-title">
                📋 Chi tiết Vùng trồng #{selectedForDetail.id}
              </h3>
              <button
                type="button"
                className="msvt-detail-modal-close-btn"
                onClick={() => setIsDetailOpen(false)}
                title="Đóng cửa sổ chi tiết"
              >
                ✕
              </button>
            </div>

            <div className="msvt-detail-modal-body">
              <div className="msvt-detail-grid">
                <div><strong>Mã MSVT mới:</strong> <span className="msvt-detail-code">{selectedForDetail.msvt_moi || 'Chưa có'}</span></div>
                <div><strong>Mã MSVT cũ:</strong> {selectedForDetail.msvt_cu || 'Chưa có'}</div>
                <div><strong>Tổ chức / Cá nhân:</strong> <strong>{selectedForDetail.to_chuc_ca_nhan || 'N/A'}</strong></div>
                <div><strong>Người đại diện:</strong> {selectedForDetail.nguoi_dai_dien || 'N/A'}</div>
                <div><strong>Số điện thoại:</strong> {selectedForDetail.so_dien_thoai || 'Chưa có'}</div>
                <div><strong>Email:</strong> {selectedForDetail.email || 'Chưa có'}</div>
                <div><strong>Cây trồng:</strong> <span className="msvt-detail-highlight">{selectedForDetail.loai_cay_trong || 'N/A'}</span></div>
                <div><strong>Thị trường:</strong> {selectedForDetail.thi_truong || 'N/A'}</div>
                <div><strong>Diện tích:</strong> <strong>{selectedForDetail.dien_tich_ha !== null && selectedForDetail.dien_tich_ha !== undefined ? Number(selectedForDetail.dien_tich_ha).toLocaleString('vi-VN') + ' ha' : 'N/A'}</strong></div>
                <div><strong>Tổng sản lượng:</strong> {selectedForDetail.tong_san_luong_tan !== null && selectedForDetail.tong_san_luong_tan !== undefined ? Number(selectedForDetail.tong_san_luong_tan).toLocaleString('vi-VN') + ' tấn' : 'N/A'}</div>
                <div><strong>Năng suất:</strong> {selectedForDetail.san_luong_tan_ha !== null && selectedForDetail.san_luong_tan_ha !== undefined ? `${selectedForDetail.san_luong_tan_ha} tấn/ha` : 'Chưa xác minh'}</div>
                <div><strong>Số hộ tham gia:</strong> {selectedForDetail.so_ho_tham_gia ?? 'N/A'}</div>
              </div>

              <div className="msvt-detail-extra">
                <div><strong>Địa chỉ:</strong> {selectedForDetail.dia_chi_msvt || 'Chưa có'}</div>
                <div><strong>Quy trình kỹ thuật:</strong> {selectedForDetail.quy_trinh || 'Chưa có'}</div>
                <div><strong>Tọa độ gốc:</strong> <span className="msvt-detail-coord">{selectedForDetail.toa_do_goc || 'Chưa có'}</span></div>
                <div><strong>Kiểu đối tượng GIS:</strong> {selectedForDetail.geometry_type || 'Chưa có hình học'}</div>
              </div>

              {selectedForDetail.is_deleted && (
                <div className="msvt-detail-deleted-banner">
                  <strong>⚠️ BẢN GHI ĐÃ XÓA MỀM</strong>
                  <div>Thời điểm xóa: {selectedForDetail.deleted_at ? new Date(selectedForDetail.deleted_at).toLocaleString('vi-VN') : 'N/A'}</div>
                  <div>ID Quản trị viên xóa: #{selectedForDetail.deleted_by || 'N/A'}</div>
                </div>
              )}
            </div>

            <div className="msvt-detail-modal-footer">
              <button
                type="button"
                className="msvt-detail-btn-close"
                onClick={() => setIsDetailOpen(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nhập nhanh Vùng trồng từ Excel */}
      {isImportOpen && (
        <MsvtImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
};

export default MsvtAdminDashboard;

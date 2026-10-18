import React from 'react';
import './MsvtAdminTable.css';

const MsvtAdminTable = ({
  regions = [],
  loading = false,
  page = 1,
  totalPages = 1,
  total = 0,
  pageSize = 20,
  onPageChange = () => {},
  onPageSizeChange = () => {},
  onViewDetail = () => {},
  onEdit = () => {},
  onDelete = () => {}
}) => {
  // Render badge kiểu hình học GIS
  const renderGeomBadge = (geomType) => {
    if (geomType === 'MULTIPOLYGON') {
      return (
        <span className="msvt-mcard-badge badge-poly">
          🟩 Đa giác
        </span>
      );
    }
    if (geomType === 'POINT') {
      return (
        <span className="msvt-mcard-badge badge-point">
          🔵 Điểm mốc
        </span>
      );
    }
    return (
      <span className="msvt-mcard-badge badge-nogeom">
        ⚪ Chưa có GIS
      </span>
    );
  };

  return (
    <div className="msvt-table-wrapper">
      {/* -------------------------------------------------------------
          1. GIAO DIỆN BẢNG DÀNH CHO DESKTOP / LAPTOP (>= 769px)
          ------------------------------------------------------------- */}
      <div className="msvt-desktop-table-container">
        <table className="msvt-desktop-table">
          <thead>
            <tr>
              <th style={{ width: '45px' }}>ID</th>
              <th style={{ minWidth: '170px' }}>Mã MSVT</th>
              <th style={{ minWidth: '180px' }}>Tổ chức / Cá nhân</th>
              <th style={{ minWidth: '120px' }}>Cây trồng</th>
              <th style={{ width: '95px', textAlign: 'right' }}>Diện tích (ha)</th>
              <th style={{ width: '105px', textAlign: 'right' }}>Sản lượng (tấn)</th>
              <th style={{ minWidth: '110px' }}>Thị trường</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Bản đồ GIS</th>
              <th style={{ width: '110px', textAlign: 'center' }}>Trạng thái</th>
              <th style={{ width: '130px', textAlign: 'center' }} className="col-actions-sticky">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="10" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  ⏳ Đang tải danh sách vùng trồng từ cơ sở dữ liệu...
                </td>
              </tr>
            ) : regions.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                  🔍 Không tìm thấy vùng trồng nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              regions.map((r) => {
                const isDeleted = Boolean(r.is_deleted);
                return (
                  <tr key={r.id} className={isDeleted ? 'is-deleted' : ''}>
                    {/* ID */}
                    <td style={{ fontWeight: 600, color: '#64748b' }}>#{r.id}</td>

                    {/* Mã MSVT */}
                    <td>
                      <div style={{ fontWeight: 700, color: '#15803d', wordBreak: 'break-all' }}>
                        {r.msvt_moi || 'Chưa có mã mới'}
                      </div>
                      {r.msvt_cu && (
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          Cũ: {r.msvt_cu}
                        </div>
                      )}
                    </td>

                    {/* Tổ chức / Đại diện */}
                    <td>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>
                        {r.to_chuc_ca_nhan || 'Chưa cập nhật'}
                      </div>
                      {r.nguoi_dai_dien && (
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          Đại diện: {r.nguoi_dai_dien}
                        </div>
                      )}
                    </td>

                    {/* Loại cây trồng */}
                    <td style={{ color: '#334155' }}>
                      {r.loai_cay_trong || '-'}
                    </td>

                    {/* Diện tích */}
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      {r.dien_tich_ha !== null && r.dien_tich_ha !== undefined
                        ? Number(r.dien_tich_ha).toLocaleString('vi-VN', { maximumFractionDigits: 4 })
                        : '-'}
                    </td>

                    {/* Tổng sản lượng */}
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      {r.tong_san_luong_tan !== null && r.tong_san_luong_tan !== undefined
                        ? Number(r.tong_san_luong_tan).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
                        : '-'}
                    </td>

                    {/* Thị trường */}
                    <td style={{ color: '#475569' }}>
                      {r.thi_truong || '-'}
                    </td>

                    {/* Bản đồ GIS */}
                    <td style={{ textAlign: 'center' }}>
                      {renderGeomBadge(r.geometry_type)}
                    </td>

                    {/* Trạng thái */}
                    <td style={{ textAlign: 'center' }}>
                      {isDeleted ? (
                        <span className="msvt-mcard-badge badge-deleted">
                          ❌ Đã xóa mềm
                        </span>
                      ) : (
                        <span className="msvt-mcard-badge badge-active">
                          ✅ Hoạt động
                        </span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td style={{ textAlign: 'center' }} className="col-actions-sticky">
                      <div className="msvt-table-actions-group">
                        <button
                          type="button"
                          className="msvt-admin-action-btn"
                          onClick={() => onViewDetail(r)}
                          title="Xem chi tiết đầy đủ"
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '6px 8px',
                            cursor: 'pointer',
                            fontSize: '13px'
                          }}
                        >
                          👁️
                        </button>

                        {!isDeleted && (
                          <button
                            type="button"
                            className="msvt-admin-action-btn"
                            onClick={() => onEdit(r)}
                            title="Chỉnh sửa thông tin vùng trồng"
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              borderRadius: '4px',
                              padding: '6px 8px',
                              cursor: 'pointer',
                              fontSize: '13px'
                            }}
                          >
                            ✏️
                          </button>
                        )}

                        {!isDeleted && (
                          <button
                            type="button"
                            className="msvt-admin-action-btn"
                            onClick={() => onDelete(r)}
                            title="Xóa mềm vùng trồng khỏi bản đồ"
                            style={{
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              padding: '6px 8px',
                              cursor: 'pointer',
                              fontSize: '13px'
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* -------------------------------------------------------------
          2. GIAO DIỆN CARD LIST DÀNH CHO MOBILE (< 769px)
          ------------------------------------------------------------- */}
      <div className="msvt-mobile-cards-view">
        {loading ? (
          <div className="msvt-mcard-state-box">
            <span className="msvt-mcard-state-icon">⏳</span>
            <strong>Đang tải danh sách vùng trồng...</strong>
            <span>Vui lòng chờ trong giây lát</span>
          </div>
        ) : regions.length === 0 ? (
          <div className="msvt-mcard-state-box">
            <span className="msvt-mcard-state-icon">🔍</span>
            <strong>Không tìm thấy vùng trồng nào</strong>
            <span>Hãy thử tìm kiếm với từ khóa khác hoặc bấm "Đặt lại" bộ lọc.</span>
          </div>
        ) : (
          regions.map((r) => {
            const isDeleted = Boolean(r.is_deleted);
            return (
              <div
                key={r.id}
                className={`msvt-mobile-card ${isDeleted ? 'is-deleted' : ''}`}
              >
                {/* Header Card */}
                <div className="msvt-mcard-header">
                  <div className="msvt-mcard-title-box">
                    <div className="msvt-mcard-id-row">
                      <span className="msvt-mcard-id">#{r.id}</span>
                      {r.msvt_cu && (
                        <span className="msvt-mcard-msvt-cu">
                          Mã cũ: <strong>{r.msvt_cu}</strong>
                        </span>
                      )}
                    </div>
                    <h4 className="msvt-mcard-msvt">
                      {r.msvt_moi || 'Chưa có mã mới'}
                    </h4>
                  </div>

                  <div className="msvt-mcard-badges">
                    {isDeleted ? (
                      <span className="msvt-mcard-badge badge-deleted">
                        ❌ Đã xóa mềm
                      </span>
                    ) : (
                      <span className="msvt-mcard-badge badge-active">
                        ✅ Hoạt động
                      </span>
                    )}
                    {renderGeomBadge(r.geometry_type)}
                  </div>
                </div>

                {/* Body Card */}
                <div className="msvt-mcard-body">
                  <div className="msvt-mcard-owner-box">
                    <span className="msvt-mcard-owner-icon">🏢</span>
                    <div className="msvt-mcard-owner-details">
                      <span className="msvt-mcard-owner-name">
                        {r.to_chuc_ca_nhan || 'Chưa cập nhật chủ thể'}
                      </span>
                      {r.nguoi_dai_dien && (
                        <span className="msvt-mcard-owner-rep">
                          Người đại diện: <strong>{r.nguoi_dai_dien}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="msvt-mcard-grid">
                    <div className="msvt-mcard-grid-item">
                      <span className="msvt-mcard-grid-lbl">🌾 Cây trồng:</span>
                      <span className="msvt-mcard-grid-val">{r.loai_cay_trong || '-'}</span>
                    </div>

                    <div className="msvt-mcard-grid-item">
                      <span className="msvt-mcard-grid-lbl">🌐 Thị trường:</span>
                      <span className="msvt-mcard-grid-val">{r.thi_truong || '-'}</span>
                    </div>

                    <div className="msvt-mcard-grid-item">
                      <span className="msvt-mcard-grid-lbl">📐 Diện tích:</span>
                      <span className="msvt-mcard-grid-val bold-green">
                        {r.dien_tich_ha !== null && r.dien_tich_ha !== undefined
                          ? `${Number(r.dien_tich_ha).toLocaleString('vi-VN', { maximumFractionDigits: 4 })} ha`
                          : '-'}
                      </span>
                    </div>

                    <div className="msvt-mcard-grid-item">
                      <span className="msvt-mcard-grid-lbl">⚖️ Sản lượng:</span>
                      <span className="msvt-mcard-grid-val">
                        {r.tong_san_luong_tan !== null && r.tong_san_luong_tan !== undefined
                          ? `${Number(r.tong_san_luong_tan).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tấn`
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Hàng 3 nút hành động chuẩn cảm ứng tối thiểu 44px */}
                <div className="msvt-mcard-actions">
                  <button
                    type="button"
                    className="msvt-mcard-btn btn-view"
                    onClick={() => onViewDetail(r)}
                    title="Xem chi tiết đầy đủ hồ sơ vùng trồng"
                    aria-label={`Xem chi tiết vùng trồng ${r.msvt_moi || r.id}`}
                  >
                    <span className="btn-icon">👁️</span>
                    <span className="btn-text">Xem chi tiết</span>
                  </button>

                  {!isDeleted && (
                    <button
                      type="button"
                      className="msvt-mcard-btn btn-edit"
                      onClick={() => onEdit(r)}
                      title="Chỉnh sửa thông tin vùng trồng"
                      aria-label={`Chỉnh sửa vùng trồng ${r.msvt_moi || r.id}`}
                    >
                      <span className="btn-icon">✏️</span>
                      <span className="btn-text">Chỉnh sửa</span>
                    </button>
                  )}

                  {!isDeleted && (
                    <button
                      type="button"
                      className="msvt-mcard-btn btn-delete"
                      onClick={() => onDelete(r)}
                      title="Xóa mềm vùng trồng khỏi bản đồ"
                      aria-label={`Xóa vùng trồng ${r.msvt_moi || r.id}`}
                    >
                      <span className="btn-icon">🗑️</span>
                      <span className="btn-text">Xóa</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* -------------------------------------------------------------
          3. THANH PHÂN TRANG (Responsive Desktop & Mobile)
          ------------------------------------------------------------- */}
      <div className="msvt-pagination-bar">
        <div className="msvt-pagination-info">
          <span>Tổng số: <strong>{total}</strong> vùng trồng</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Hiển thị:</span>
            <select
              className="msvt-pagination-pagesize-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              <option value="10">10 / trang</option>
              <option value="20">20 / trang</option>
              <option value="50">50 / trang</option>
            </select>
          </div>
        </div>

        <div className="msvt-pagination-buttons">
          <button
            type="button"
            className="msvt-page-btn"
            onClick={() => onPageChange(1)}
            disabled={page <= 1 || loading}
            title="Về trang đầu tiên"
          >
            « Đầu
          </button>
          <button
            type="button"
            className="msvt-page-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            title="Về trang trước"
          >
            ‹ Trước
          </button>
          <span className="msvt-page-indicator">
            Trang <strong>{page}</strong> / <strong>{totalPages || 1}</strong>
          </span>
          <button
            type="button"
            className="msvt-page-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            title="Sang trang sau"
          >
            Sau ›
          </button>
          <button
            type="button"
            className="msvt-page-btn"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages || loading}
            title="Đến trang cuối cùng"
          >
            Cuối »
          </button>
        </div>
      </div>
    </div>
  );
};

export default MsvtAdminTable;

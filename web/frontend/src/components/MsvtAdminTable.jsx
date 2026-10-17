import React from 'react';

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Container Bảng cuộn ngang / dọc */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', backgroundColor: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #cbd5e1', color: '#475569', position: 'sticky', top: 0, zIndex: 10 }}>
              <th style={{ padding: '10px 12px', width: '45px' }}>ID</th>
              <th style={{ padding: '10px 12px', minWidth: '170px' }}>Mã MSVT</th>
              <th style={{ padding: '10px 12px', minWidth: '180px' }}>Tổ chức / Cá nhân</th>
              <th style={{ padding: '10px 12px', minWidth: '120px' }}>Cây trồng</th>
              <th style={{ padding: '10px 12px', width: '95px', textAlign: 'right' }}>Diện tích (ha)</th>
              <th style={{ padding: '10px 12px', width: '105px', textAlign: 'right' }}>Sản lượng (tấn)</th>
              <th style={{ padding: '10px 12px', minWidth: '110px' }}>Thị trường</th>
              <th style={{ padding: '10px 12px', width: '120px', textAlign: 'center' }}>Bản đồ GIS</th>
              <th style={{ padding: '10px 12px', width: '110px', textAlign: 'center' }}>Trạng thái</th>
              <th style={{ padding: '10px 12px', width: '130px', textAlign: 'center', position: 'sticky', right: 0, backgroundColor: '#f8fafc' }}>Thao tác</th>
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
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isDeleted ? '#fff1f2' : 'transparent',
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (!isDeleted) e.currentTarget.style.backgroundColor = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isDeleted) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* ID */}
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: '#64748b' }}>#{r.id}</td>

                    {/* Mã MSVT */}
                    <td style={{ padding: '9px 12px' }}>
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
                    <td style={{ padding: '9px 12px' }}>
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
                    <td style={{ padding: '9px 12px', color: '#334155' }}>
                      {r.loai_cay_trong || '-'}
                    </td>

                    {/* Diện tích */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      {r.dien_tich_ha !== null && r.dien_tich_ha !== undefined
                        ? Number(r.dien_tich_ha).toLocaleString('vi-VN', { maximumFractionDigits: 4 })
                        : '-'}
                    </td>

                    {/* Tổng sản lượng */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      {r.tong_san_luong_tan !== null && r.tong_san_luong_tan !== undefined
                        ? Number(r.tong_san_luong_tan).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
                        : '-'}
                    </td>

                    {/* Thị trường */}
                    <td style={{ padding: '9px 12px', color: '#475569' }}>
                      {r.thi_truong || '-'}
                    </td>

                    {/* Bản đồ GIS */}
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      {r.geometry_type === 'MULTIPOLYGON' ? (
                        <span style={{
                          backgroundColor: '#dcfce7',
                          color: '#166534',
                          border: '1px solid #86efac',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          🟩 Đa giác
                        </span>
                      ) : r.geometry_type === 'POINT' ? (
                        <span style={{
                          backgroundColor: '#dbeafe',
                          color: '#1e40af',
                          border: '1px solid #93c5fd',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          🔵 Điểm mốc
                        </span>
                      ) : (
                        <span style={{
                          backgroundColor: '#f1f5f9',
                          color: '#94a3b8',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px'
                        }}>
                          ⚪ Chưa có
                        </span>
                      )}
                    </td>

                    {/* Trạng thái */}
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      {isDeleted ? (
                        <span style={{
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          border: '1px solid #fca5a5',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          ❌ Đã xóa mềm
                        </span>
                      ) : (
                        <span style={{
                          backgroundColor: '#dcfce7',
                          color: '#15803d',
                          border: '1px solid #86efac',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600
                        }}>
                          ✅ Hoạt động
                        </span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td style={{
                      padding: '9px 12px',
                      textAlign: 'center',
                      position: 'sticky',
                      right: 0,
                      backgroundColor: isDeleted ? '#fff1f2' : '#ffffff'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        {/* Nút Xem chi tiết */}
                        <button
                          type="button"
                          onClick={() => onViewDetail(r)}
                          title="Xem chi tiết đầy đủ"
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          👁️
                        </button>

                        {/* Nút Sửa (chỉ cho bản ghi đang hoạt động) */}
                        {!isDeleted && (
                          <button
                            type="button"
                            onClick={() => onEdit(r)}
                            title="Chỉnh sửa thông tin vùng trồng"
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              borderRadius: '4px',
                              padding: '4px 6px',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            ✏️
                          </button>
                        )}

                        {/* Nút Xóa mềm (chỉ cho bản ghi đang hoạt động) */}
                        {!isDeleted && (
                          <button
                            type="button"
                            onClick={() => onDelete(r)}
                            title="Xóa mềm vùng trồng khỏi bản đồ"
                            style={{
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              padding: '4px 6px',
                              cursor: 'pointer',
                              fontSize: '12px'
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

      {/* Thanh Phân trang & Tùy chọn số bản ghi */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 6px 4px 6px',
        fontSize: '12.5px',
        color: '#475569',
        flexWrap: 'wrap',
        gap: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Tổng số: <strong>{total}</strong> vùng trồng</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Hiển thị:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              style={{
                padding: '3px 8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                outline: 'none'
              }}
            >
              <option value="10">10 / trang</option>
              <option value="20">20 / trang</option>
              <option value="50">50 / trang</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={page <= 1 || loading}
            style={{
              padding: '4px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              opacity: page <= 1 ? 0.5 : 1
            }}
          >
            « Đầu
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            style={{
              padding: '4px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              opacity: page <= 1 ? 0.5 : 1
            }}
          >
            ‹ Trước
          </button>
          <span style={{ padding: '0 6px' }}>
            Trang <strong>{page}</strong> / <strong>{totalPages || 1}</strong>
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            style={{
              padding: '4px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages ? 0.5 : 1
            }}
          >
            Sau ›
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages || loading}
            style={{
              padding: '4px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              backgroundColor: '#fff',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              opacity: page >= totalPages ? 0.5 : 1
            }}
          >
            Cuối »
          </button>
        </div>
      </div>
    </div>
  );
};

export default MsvtAdminTable;

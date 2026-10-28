import React, { useState } from 'react';

/**
 * Component MsvtLegend - Chú giải bản đồ chuẩn hóa WebGIS MSVT:
 * 1. Chấm xanh lá: Vị trí vùng trồng MSVT (Marker đại diện)
 * 2. Chấm cam: Vùng đang hover hoặc được chọn
 * 3. Viền ranh giới: Polygon của vùng đang chọn
 * 4. Bảng phân rã số liệu thực tế (Tổng vùng CSDL, Có hình học, Point, MultiPolygon, Chưa có tọa độ, Đang lọc)
 * Hỗ trợ thu gọn / mở rộng linh hoạt, tối ưu trên Desktop và Mobile.
 */
const MsvtLegend = ({ stats = null }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Tính toán số liệu thực tế từ stats đồng bộ
  const withGeom = stats?.withGeometry ?? ((stats?.pointCount || 0) + (stats?.polyCount || 0));
  const totalInDb = stats?.totalRegions ?? (withGeom + (stats?.withoutGeometry || 0));
  const isFiltered = Boolean(stats?.isFiltered);
  const visibleCount = isFiltered ? (stats?.filteredTotal ?? withGeom) : withGeom;

  if (collapsed) {
    return (
      <div 
        className="map-legend-collapsible"
        style={{ minWidth: 'auto', cursor: 'pointer' }}
        onClick={() => setCollapsed(false)}
        title="Nhấp để mở rộng chú giải bản đồ"
      >
        <div className="map-legend-header" style={{ borderBottom: 'none' }}>
          <div className="map-legend-header-title">
            <span>🌿</span>
            <span>Chú giải ({visibleCount})</span>
          </div>
          <button 
            type="button" 
            className="map-legend-toggle-btn"
            aria-label="Mở rộng chú giải"
          >
            ▲
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="map-legend-collapsible">
      {/* Header Chú giải kèm nút thu gọn */}
      <div 
        className="map-legend-header"
        onClick={() => setCollapsed(true)}
        title="Nhấp để thu gọn chú giải"
      >
        <div className="map-legend-header-title">
          <span>🌿</span>
          <span>Chú giải bản đồ MSVT</span>
        </div>
        <button 
          type="button" 
          className="map-legend-toggle-btn"
          aria-label="Thu gọn chú giải"
        >
          ▼
        </button>
      </div>

      {/* Nội dung danh mục chú giải */}
      <div className="map-legend-body">
        {/* Chấm xanh lá: Vị trí vùng trồng */}
        <div className="map-legend-item">
          <span className="map-legend-dot-green"></span>
          <span style={{ fontWeight: 600 }}>
            {isFiltered 
              ? `Đang lọc: ${visibleCount} / ${withGeom} vùng` 
              : `Vị trí vùng trồng MSVT (${withGeom} vùng)`}
          </span>
        </div>

        {/* Chấm cam: Đang hover hoặc được chọn */}
        <div className="map-legend-item">
          <span className="map-legend-dot-orange"></span>
          <span>Vùng đang hover hoặc được chọn</span>
        </div>

        {/* Ranh giới: Polygon khi chọn */}
        <div className="map-legend-item">
          <span className="map-legend-poly-selected"></span>
          <span>Ranh giới thực tế (Polygon khi chọn)</span>
        </div>

        {/* Phân rã số liệu chi tiết theo quy chuẩn Mục 4 */}
        <div className="map-legend-breakdown">
          <button
            type="button"
            className="map-legend-breakdown-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowDetail(prev => !prev);
            }}
            title="Xem phân rã chi tiết số liệu"
          >
            <span>📊 Thống kê hình học</span>
            <span>{showDetail ? '▲ Thu gọn' : '▼ Chi tiết'}</span>
          </button>

          {showDetail && (
            <div className="map-legend-breakdown-content">
              <div className="map-legend-stat-row">
                <span>Tổng vùng trồng (CSDL):</span>
                <strong>{totalInDb}</strong>
              </div>
              <div className="map-legend-stat-row">
                <span>Vùng có hình học (Bản đồ):</span>
                <strong>{withGeom}</strong>
              </div>
              <div className="map-legend-stat-row sub">
                <span>• Điểm vị trí (Point):</span>
                <span>{isFiltered ? `${stats?.filteredPointCount || 0} / ${stats?.pointCount || 0}` : (stats?.pointCount || 0)}</span>
              </div>
              <div className="map-legend-stat-row sub">
                <span>• Ranh giới (Polygon):</span>
                <span>{isFiltered ? `${stats?.filteredPolyCount || 0} / ${stats?.polyCount || 0}` : (stats?.polyCount || 0)}</span>
              </div>
              <div className="map-legend-stat-row">
                <span>Chưa có hình học (lưu CSDL):</span>
                <span>{stats?.withoutGeometry || 0}</span>
              </div>
              {isFiltered && (
                <div className="map-legend-stat-row highlight">
                  <span>Đang hiển thị theo bộ lọc:</span>
                  <strong>{visibleCount} vùng</strong>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="map-legend-note">
          * Rê chuột để xem thông tin, nhấp chuột để phóng đến vùng trồng.
        </div>
      </div>
    </div>
  );
};

export default MsvtLegend;

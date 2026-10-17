import React, { useState } from 'react';

/**
 * Component MsvtLegend - Chú giải bản đồ tối giản WebGIS MSVT:
 * 1. Chấm xanh lá: Vị trí vùng trồng MSVT (Marker đại diện duy nhất)
 * 2. Chấm cam: Vùng đang hover hoặc được chọn
 * 3. Viền ranh giới: Polygon của vùng đang chọn
 * Có nút thu gọn / mở rộng linh hoạt, không che khuất bản đồ.
 */
const MsvtLegend = ({ stats = { total: 49, pointCount: 17, polyCount: 32 } }) => {
  const [collapsed, setCollapsed] = useState(false);

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
            <span>Chú giải</span>
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

      {/* Nội dung danh mục chú giải tối giản */}
      <div className="map-legend-body">
        {/* Chấm xanh lá: Vị trí vùng trồng */}
        <div className="map-legend-item">
          <span className="map-legend-dot-green"></span>
          <span>Vị trí vùng trồng MSVT ({stats.total || 42} vùng)</span>
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

        <div className="map-legend-note">
          * Rê chuột để xem thông tin, nhấp chuột để phóng đến vùng trồng.
        </div>
      </div>
    </div>
  );
};

export default MsvtLegend;


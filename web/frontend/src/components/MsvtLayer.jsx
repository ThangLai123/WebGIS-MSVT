import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import msvtApi from '../services/msvtApi';
import { getPointOnFeature } from '../utils/geoInteriorPoint';

/**
 * Hàm escape HTML an toàn chống XSS
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tạo nội dung HTML cho Tooltip / Info Card khi rê chuột vào Marker:
 * - 12 thông tin chuẩn mực nếu có trong CSDL
 * - TUYỆT ĐỐI KHÔNG hiển thị số điện thoại và email
 * - Rõ ràng, hiện đại, chiều rộng 260–320px
 */
function createTooltipHtml(properties, geomType) {
  const p = properties || {};
  const isPoly = geomType === 'Polygon' || geomType === 'MultiPolygon' || p.geom_type === 'MULTIPOLYGON' || p.geom_type === 'Polygon';
  const typeLabel = isPoly ? 'Polygon' : 'Point';
  const typeClass = isPoly ? 'poly' : 'point';

  const title = p.msvt_moi || p.msvt_cu || 'Chưa có mã MSVT';

  const rows = [];

  // 1. Mã MSVT mới
  if (p.msvt_moi) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Mã MSVT mới:</span>
        <span class="msvt-tooltip-val" style="color: #15803d; font-weight: 700;">${escapeHtml(p.msvt_moi)}</span>
      </div>
    `);
  }

  // 2. Mã MSVT cũ (nếu có)
  if (p.msvt_cu && p.msvt_cu !== p.msvt_moi) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Mã MSVT cũ:</span>
        <span class="msvt-tooltip-val">${escapeHtml(p.msvt_cu)}</span>
      </div>
    `);
  }

  // 3. Tên tổ chức / cá nhân
  if (p.to_chuc_ca_nhan) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Tổ chức / Cơ sở:</span>
        <span class="msvt-tooltip-val">${escapeHtml(p.to_chuc_ca_nhan)}</span>
      </div>
    `);
  }

  // 4. Người đại diện (nếu được công khai)
  if (p.nguoi_dai_dien) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Người đại diện:</span>
        <span class="msvt-tooltip-val">${escapeHtml(p.nguoi_dai_dien)}</span>
      </div>
    `);
  }

  // 5. Loại cây trồng
  if (p.loai_cay_trong) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Cây trồng:</span>
        <span class="msvt-tooltip-val" style="color: #047857; font-weight: 700;">🌱 ${escapeHtml(p.loai_cay_trong)}</span>
      </div>
    `);
  }

  // 6. Địa chỉ vùng trồng
  if (p.dia_chi_msvt) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Địa chỉ:</span>
        <span class="msvt-tooltip-val">${escapeHtml(p.dia_chi_msvt)}</span>
      </div>
    `);
  }

  // 7. Diện tích ha
  if (p.dien_tich_ha != null && p.dien_tich_ha !== '') {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Diện tích:</span>
        <span class="msvt-tooltip-val">${p.dien_tich_ha} ha</span>
      </div>
    `);
  }

  // 8. Tổng sản lượng theo hồ sơ (kèm ghi chú đơn vị nếu chưa xác minh)
  if (p.tong_san_luong_tan != null && p.tong_san_luong_tan !== '') {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Sản lượng:</span>
        <span class="msvt-tooltip-val">${p.tong_san_luong_tan} tấn <em style="font-size: 10px; color: #b45309; font-weight: normal;">(* đơn vị chưa xác minh)</em></span>
      </div>
    `);
  }

  // 9. Số hộ tham gia
  if (p.so_ho_tham_gia != null && p.so_ho_tham_gia !== '') {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Số hộ tham gia:</span>
        <span class="msvt-tooltip-val">${p.so_ho_tham_gia} hộ</span>
      </div>
    `);
  }

  // 10. Quy trình sản xuất
  if (p.quy_trinh) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Quy trình:</span>
        <span class="msvt-tooltip-val">${escapeHtml(p.quy_trinh)}</span>
      </div>
    `);
  }

  // 11. Thị trường
  if (p.thi_truong) {
    rows.push(`
      <div class="msvt-tooltip-row">
        <span class="msvt-tooltip-label">Thị trường:</span>
        <span class="msvt-tooltip-val" style="color: #1d4ed8; font-weight: 600;">${escapeHtml(p.thi_truong)}</span>
      </div>
    `);
  }

  // 12. Loại geometry
  rows.push(`
    <div class="msvt-tooltip-row">
      <span class="msvt-tooltip-label">Hình học:</span>
      <span class="msvt-tooltip-val">${isPoly ? 'Vùng ranh giới (Polygon)' : 'Điểm mốc (Point)'}</span>
    </div>
  `);

  return `
    <div class="msvt-tooltip-card">
      <div class="msvt-tooltip-header">
        <span class="msvt-tooltip-title">${escapeHtml(title)}</span>
        <span class="msvt-tooltip-badge ${typeClass}">${typeLabel}</span>
      </div>
      <div class="msvt-tooltip-body">
        ${rows.join('')}
      </div>
      <div class="msvt-tooltip-hint">
        <span>👉 Nhấp chuột để phóng đến vùng trồng</span>
      </div>
    </div>
  `;
}

/**
 * Component MsvtLayer - Hiển thị lớp đối tượng không gian Vùng trồng MSVT
 * Thiết kế tối giản theo hướng ONE MARKER PER MSVT:
 * 1. MỘT KIỂU MARKER DUY NHẤT:
 *    - Chấm tròn xanh lá (#16a34a), viền trắng mảnh, đường kính 14px.
 *    - Không hiển thị số cụm, không dùng hình thoi, không phân biệt Point và Polygon trên tổng quan.
 *    - Khi hover: đổi màu cam (#ea580c) và tăng kích thước nhẹ.
 *    - Khi selected: highlight vòng halo cam rõ ràng.
 * 2. ĐIỂM ĐẠI DIỆN NẰM TRONG HÌNH HỌC:
 *    - Point: Sử dụng trực tiếp tọa độ lưu trữ.
 *    - Polygon / MultiPolygon: Điểm đại diện PostGIS ST_PointOnSurface (hoặc thuật toán scanline interior point).
 *    - MultiPolygon chỉ tạo ĐÚNG 1 marker đại diện cho cả đối tượng.
 * 3. HOVER XEM THÔNG TIN:
 *    - Tooltip info card hiện đại (260-320px), nền trắng, shadow mềm, 12 thuộc tính (không lộ SĐT/email).
 *    - Độ trễ nhẹ 180ms để chống nhấp nháy; chỉ mở 1 tooltip tại một thời điểm.
 * 4. CLICK PHÓNG ĐẾN VÙNG & HIỂN THỊ RANH GIỚI POLYGON:
 *    - Đóng tooltip hover ngay lập tức.
 *    - Point: flyTo đến tọa độ (zoom 16).
 *    - Polygon/MultiPolygon: fitBounds theo ranh giới thật (padding [60,60], maxZoom 17) và HIỂN THỊ ranh giới Polygon thật.
 *    - Khi chuyển sang vùng khác hoặc bỏ chọn: ranh giới cũ tự động xóa, giao diện tổng quan tối giản.
 */
const MsvtLayer = ({
  visible = true,
  selectedRegionId = null,
  onSelectRegion = () => {},
  filters = { msvt: '', loaiCay: '', thiTruong: '' },
  onStatsUpdate = () => {},
  focusFeature = null,
  refreshTrigger = 0
}) => {
  const map = useMap();
  const parentGroupRef = useRef(null);
  const markersGroupRef = useRef(null);
  const boundaryGroupRef = useRef(null);

  const [geoJsonData, setGeoJsonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Quản lý debounce hover và tooltip mở duy nhất
  const hoverTimeoutRef = useRef(null);
  const activeTooltipMarkerRef = useRef(null);
  const lastFocusedIdRef = useRef(null);

  const onStatsUpdateRef = useRef(onStatsUpdate);
  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  // Khởi tạo LayerGroups gắn vào Leaflet Map 1 lần duy nhất
  useEffect(() => {
    const parentGroup = L.layerGroup();
    const markersGroup = L.layerGroup();
    const boundaryGroup = L.layerGroup();

    parentGroup.addLayer(boundaryGroup); // Ranh giới polygon vẽ dưới
    parentGroup.addLayer(markersGroup);  // Marker vẽ trên

    parentGroupRef.current = parentGroup;
    markersGroupRef.current = markersGroup;
    boundaryGroupRef.current = boundaryGroup;

    if (visible) {
      parentGroup.addTo(map);
    }

    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (markersGroupRef.current) markersGroupRef.current.clearLayers();
      if (boundaryGroupRef.current) boundaryGroupRef.current.clearLayers();
      if (parentGroupRef.current) {
        parentGroupRef.current.clearLayers();
        map.removeLayer(parentGroupRef.current);
      }
    };
  }, [map]);

  // Toggle hiển thị LayerGroup khi visible thay đổi
  useEffect(() => {
    if (!parentGroupRef.current) return;
    if (visible) {
      if (!map.hasLayer(parentGroupRef.current)) {
        parentGroupRef.current.addTo(map);
      }
    } else {
      if (map.hasLayer(parentGroupRef.current)) {
        map.removeLayer(parentGroupRef.current);
      }
    }
  }, [visible, map]);

  // Tải dữ liệu GeoJSON từ FastAPI DUY NHẤT 1 LẦN khi mount hoặc khi refreshTrigger thay đổi
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    msvtApi.getGeoJSON()
      .then((data) => {
        if (isCancelled) return;
        setGeoJsonData(data);
        setLoading(false);

        // Tính toán thống kê dữ liệu hình học thực tế (loại bỏ các bản ghi không có geometry)
        if (data && data.features && onStatsUpdateRef.current) {
          const pointCount = data.features.filter(f => f.geometry && f.geometry.type === 'Point').length;
          const polyCount = data.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')).length;
          onStatsUpdateRef.current({
            total: pointCount + polyCount,
            pointCount,
            polyCount
          });
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        setError(err.message || 'Không thể tải dữ liệu lớp vùng trồng MSVT.');
        setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [refreshTrigger]);

  // Hàm điều hướng phóng đến đối tượng (Point: flyTo z=16, Polygon: fitBounds maxZoom 17)
  const zoomToFeature = useCallback((feature) => {
    if (!feature || !feature.geometry || !map) return;
    const geom = feature.geometry;

    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
      const [lng, lat] = geom.coordinates;
      map.flyTo([lat, lng], 16, { animate: true, duration: 0.8 });
    } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      try {
        const geoLayer = L.geoJSON(feature);
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [60, 60],
            maxZoom: 17,
            animate: true,
            duration: 0.8
          });
        }
      } catch (e) {
        console.warn('[MsvtLayer] Không thể fitBounds:', e);
      }
    }
  }, [map]);

  // Chuẩn hóa bộ lọc chuỗi tìm kiếm
  const msvtFilter = (filters.msvt || '').trim().toLowerCase();
  const cropFilter = (filters.loaiCay || '').trim().toLowerCase();
  const marketFilter = (filters.thiTruong || '').trim().toLowerCase();

  // Danh sách các đối tượng hợp lệ sau bộ lọc
  const filteredFeatures = useMemo(() => {
    if (!geoJsonData || !geoJsonData.features) return [];

    return geoJsonData.features.filter((f) => {
      if (!f || !f.geometry || !f.geometry.type) return false;
      const p = f.properties || {};

      if (msvtFilter) {
        const msvtMoi = String(p.msvt_moi || '').toLowerCase();
        const msvtCu = String(p.msvt_cu || '').toLowerCase();
        if (!msvtMoi.includes(msvtFilter) && !msvtCu.includes(msvtFilter)) return false;
      }
      if (cropFilter) {
        const crop = String(p.loai_cay_trong || '').toLowerCase();
        if (!crop.includes(cropFilter)) return false;
      }
      if (marketFilter) {
        const market = String(p.thi_truong || '').toLowerCase();
        if (!market.includes(marketFilter)) return false;
      }
      return true;
    });
  }, [geoJsonData, msvtFilter, cropFilter, marketFilter]);

  // =========================================================================
  // VẼ MARKER ĐỒNG NHẤT (ONE MARKER PER MSVT)
  // =========================================================================
  useEffect(() => {
    if (!markersGroupRef.current) return;
    markersGroupRef.current.clearLayers();

    filteredFeatures.forEach((feature) => {
      const p = feature.properties || {};
      const regionId = p.id;
      const isSelected = selectedRegionId && regionId === selectedRegionId;

      // Xác định tọa độ điểm đại diện:
      // 1. Ưu tiên tọa độ ST_PointOnSurface được FastAPI trả về trong properties.representative_point
      // 2. Fallback: Thuật toán quét scanline interior point trong getPointOnFeature
      let repCoord = null;
      if (Array.isArray(p.representative_point) && p.representative_point.length >= 2) {
        repCoord = p.representative_point;
      } else {
        repCoord = getPointOnFeature(feature.geometry);
      }

      if (!repCoord || !Array.isArray(repCoord) || repCoord.length < 2) return;
      const [lng, lat] = repCoord;

      // 1 KIỂU MARKER DUY NHẤT: Tròn xanh lá, viền trắng mảnh, 14px
      const markerIcon = L.divIcon({
        className: `msvt-unified-marker ${isSelected ? 'selected' : ''}`,
        html: '<div class="msvt-marker-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      const marker = L.marker([lat, lng], {
        icon: markerIcon,
        zIndexOffset: isSelected ? 1000 : 300,
        riseOnHover: true
      });

      // Gắn Tooltip với 12 thông tin chi tiết
      marker.bindTooltip(createTooltipHtml(p, feature.geometry.type), {
        className: 'msvt-modern-tooltip',
        direction: 'auto',
        offset: [0, -10],
        opacity: 1
      });

      // Tắt mouseover mặc định của Leaflet để áp dụng debounce 180ms
      marker.off('mouseover', marker._openTooltip);

      // Sự kiện Hover chuột: Đổi màu cam (qua CSS), mở Tooltip có độ trễ 180ms
      marker.on('mouseover', () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }

        hoverTimeoutRef.current = setTimeout(() => {
          // Đảm bảo chỉ 1 tooltip duy nhất được mở tại 1 thời điểm
          if (activeTooltipMarkerRef.current && activeTooltipMarkerRef.current !== marker) {
            try {
              activeTooltipMarkerRef.current.closeTooltip();
            } catch {}
          }
          marker.openTooltip();
          activeTooltipMarkerRef.current = marker;
        }, 180);
      });

      // Sự kiện Rời chuột: Hủy hẹn giờ, đóng Tooltip
      marker.on('mouseout', () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        marker.closeTooltip();
        if (activeTooltipMarkerRef.current === marker) {
          activeTooltipMarkerRef.current = null;
        }
      });

      // Sự kiện Nhấp chuột: Đóng tooltip ngay, phóng đến vùng trồng và kích hoạt chọn
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);

        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        marker.closeTooltip();
        activeTooltipMarkerRef.current = null;

        // Đánh dấu để tránh zoom lặp khi component cha cập nhật state
        lastFocusedIdRef.current = regionId;

        // Phóng bản đồ tới đối tượng
        zoomToFeature(feature);

        // Kích hoạt callback chọn vùng trồng
        onSelectRegion(p, feature);
      });

      marker.addTo(markersGroupRef.current);
    });
  }, [filteredFeatures, selectedRegionId, onSelectRegion, zoomToFeature]);

  // =========================================================================
  // HIỂN THỊ RANH GIỚI POLYGON THỰC TẾ KHI ĐƯỢC CHỌN (SELECTED)
  // =========================================================================
  useEffect(() => {
    if (!boundaryGroupRef.current) return;
    boundaryGroupRef.current.clearLayers();

    if (!selectedRegionId || !geoJsonData || !geoJsonData.features) return;

    // Tìm đối tượng đang được chọn
    const selectedFeature = geoJsonData.features.find(
      (f) => f && f.properties && f.properties.id === selectedRegionId
    );

    if (!selectedFeature || !selectedFeature.geometry) return;
    const geomType = selectedFeature.geometry.type;

    // Chỉ hiển thị ranh giới thực tế nếu đối tượng là Polygon hoặc MultiPolygon
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const boundaryLayer = L.geoJSON(selectedFeature, {
        style: {
          color: '#15803d',     // Viền xanh lá đậm sắc nét
          weight: 2.8,
          opacity: 1,
          fillColor: '#22c55e', // Nền xanh lá chuẩn nông nghiệp
          fillOpacity: 0.25,    // Trong suốt 25%
          dashArray: ''
        }
      });

      // Cho phép click trực tiếp vào polygon đang highlight để giữ xem chi tiết
      boundaryLayer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectRegion(selectedFeature.properties, selectedFeature);
      });

      boundaryLayer.addTo(boundaryGroupRef.current);
    }
  }, [selectedRegionId, geoJsonData, onSelectRegion]);

  // =========================================================================
  // ĐIỀU HƯỚNG BẢN ĐỒ KHI CÓ FOCUSFEATURE TỪ NGOÀI (SIDEBAR / TRA CỨU)
  // =========================================================================
  useEffect(() => {
    if (!focusFeature || !focusFeature.geometry || !map) return;

    const fid = focusFeature.properties?.id;
    // Nếu vừa được zoom trực tiếp từ click marker, không gọi lại flyTo để tránh giật
    if (fid && fid === lastFocusedIdRef.current) return;
    lastFocusedIdRef.current = fid;

    zoomToFeature(focusFeature);
  }, [focusFeature, zoomToFeature, map]);

  if (!visible) return null;

  return (
    <>
      {loading && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: 55,
          zIndex: 1000,
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(4px)',
          border: '1px solid #86efac',
          padding: '6px 14px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#15803d',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🌱</span>
          <span>Đang tải dữ liệu Vùng trồng MSVT...</span>
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: 55,
          zIndex: 1000,
          backgroundColor: '#fee2e2',
          border: '1px solid #ef4444',
          color: '#b91c1c',
          padding: '6px 12px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span>⚠️ {error}</span>
        </div>
      )}
    </>
  );
};

export default MsvtLayer;


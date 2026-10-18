import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapViewer.css';
import MsvtLayer from './MsvtLayer';
import MsvtLegend from './MsvtLegend';
import { decimalToDms } from '../utils/geometryUtils';

/**
 * Bộ bắt sự kiện click tọa độ và zoom trên bản đồ
 */
const MapEventListener = ({ onMapClick, onZoomChange }) => {
  const map = useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6))
        });
      }
    },
    zoomend() {
      if (onZoomChange) {
        onZoomChange(map.getZoom());
      }
    }
  });
  return null;
};

/**
 * Bộ điều khiển góc nhìn và phóng toàn cảnh bản đồ
 */
const MapViewController = ({ resetTrigger, focusFeature, defaultCenter, defaultZoom }) => {
  const map = useMap();
  const lastFocusedIdRef = React.useRef(null);

  // Khi bấm nút "Bản đồ" hoặc "Toàn cảnh MSVT", đưa map về tọa độ trung tâm Nghệ An
  useEffect(() => {
    if (resetTrigger > 0) {
      lastFocusedIdRef.current = null;
      map.setView(defaultCenter, defaultZoom, { animate: true });
    }
  }, [resetTrigger, map, defaultCenter, defaultZoom]);

  // Khi có yêu cầu zoom đến một feature cụ thể từ danh sách tra cứu
  useEffect(() => {
    if (focusFeature && focusFeature.geometry) {
      const fid = focusFeature.properties?.id;
      if (fid && fid === lastFocusedIdRef.current) return;
      lastFocusedIdRef.current = fid;

      try {
        const geom = focusFeature.geometry;
        if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
          const [lng, lat] = geom.coordinates;
          map.flyTo([lat, lng], 16, { animate: true, duration: 0.8 });
        } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
          const geoLayer = L.geoJSON(focusFeature);
          const bounds = geoLayer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: true, duration: 0.8 });
          }
        }
      } catch {
        // Bỏ qua nếu hình học không hợp lệ
      }
    }
  }, [focusFeature, map]);

  return null;
};

/**
 * Tự động đồng bộ kích thước Leaflet khi Sidebar mở/đóng hoặc khung nhìn thay đổi
 */
const MapResizeHandler = ({ showMsvtPanel }) => {
  const map = useMap();

  useEffect(() => {
    // Phản hồi khi props showMsvtPanel thay đổi
    const timer = setTimeout(() => {
      try {
        map.invalidateSize({ pan: false });
      } catch {}
    }, 220);
    return () => clearTimeout(timer);
  }, [map, showMsvtPanel]);

  useEffect(() => {
    const container = map.getContainer();
    if (!container) return;

    // Sử dụng ResizeObserver để cập nhật kích thước bản đồ tức thì khi container co giãn
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        try {
          map.invalidateSize({ pan: false });
        } catch {}
      });
      resizeObserver.observe(container);
    }

    const handleResize = () => {
      try {
        map.invalidateSize({ pan: false });
      } catch {}
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [map]);

  return null;
};

/**
 * Component MapViewer - Bản đồ WebGIS chuyên trách hiển thị Vùng trồng MSVT
 */
const MapViewer = ({
  showMsvtLayer = true,
  selectedMsvtRegion = null,
  onSelectMsvtRegion = () => {},
  msvtFilters = { msvt: '', loaiCay: '', thiTruong: '' },
  onMsvtStatsUpdate = () => {},
  focusFeature = null,
  clickedCoord = null,
  onMapClick = () => {},
  onQuickLookupCoord = () => {},
  onFlyToCoord = () => {},
  msvtRefreshTrigger = 0,
  resetViewTrigger = 0,
  onResetView = () => {},
  showMsvtPanel = false
}) => {
  // Tọa độ trung tâm vùng trồng tỉnh Nghệ An (TX Thái Hòa và các huyện phụ cận)
  const centerNgheAn = [19.25, 105.42];
  const defaultZoomLevel = 10;

  // Theo dõi mức zoom hiện tại để cập nhật Chú giải thích ứng
  const [currentZoom, setCurrentZoom] = useState(defaultZoomLevel);
  const [stats, setStats] = useState({ pointCount: 17, polyCount: 25 });
  const [copiedCoord, setCopiedCoord] = useState(false);

  const handleCopyCoord = (coordText) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(coordText).then(() => {
        setCopiedCoord(true);
        setTimeout(() => setCopiedCoord(false), 2200);
      }).catch(() => {});
    }
  };

  const handleStatsUpdate = useCallback((newStats) => {
    if (newStats) {
      setStats((prev) => {
        if (prev.pointCount === newStats.pointCount && prev.polyCount === newStats.polyCount) {
          return prev;
        }
        return {
          pointCount: newStats.pointCount || 17,
          polyCount: newStats.polyCount || 25
        };
      });
    }
    if (onMsvtStatsUpdate) {
      onMsvtStatsUpdate(newStats);
    }
  }, [onMsvtStatsUpdate]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <MapContainer
        center={centerNgheAn}
        zoom={defaultZoomLevel}
        minZoom={6}
        maxZoom={20}
        style={{ height: '100%', width: '100%' }}
        preferCanvas={true}
        boxZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={20}
          maxNativeZoom={19}
        />

        {/* Lắng nghe click tọa độ và zoom */}
        <MapEventListener onMapClick={onMapClick} onZoomChange={setCurrentZoom} />

        {/* Tự động invalidateSize khi thay đổi kích thước */}
        <MapResizeHandler showMsvtPanel={showMsvtPanel} />

        {/* Điều khiển View / Zoom */}
        <MapViewController
          resetTrigger={resetViewTrigger}
          focusFeature={focusFeature}
          defaultCenter={centerNgheAn}
          defaultZoom={defaultZoomLevel}
        />

        {/* Lớp đối tượng không gian Vùng trồng MSVT */}
        <MsvtLayer
          visible={showMsvtLayer}
          selectedRegionId={selectedMsvtRegion?.id}
          onSelectRegion={onSelectMsvtRegion}
          filters={msvtFilters}
          onStatsUpdate={handleStatsUpdate}
          focusFeature={focusFeature}
          refreshTrigger={msvtRefreshTrigger}
        />

        {/* Marker hiển thị tọa độ người dùng vừa chọn/click (khác biệt với Marker MSVT xanh lá) */}
        {clickedCoord && clickedCoord.lat && clickedCoord.lng && (
          <Marker
            position={[clickedCoord.lat, clickedCoord.lng]}
            icon={L.divIcon({
              className: 'msvt-clicked-pin-marker',
              html: `
                <div class="msvt-clicked-pin-container">
                  <div class="msvt-clicked-pin-pulse"></div>
                  <div class="msvt-clicked-pin-icon">📍</div>
                </div>
              `,
              iconSize: [32, 32],
              iconAnchor: [16, 28],
              popupAnchor: [0, -28]
            })}
          >
            <Popup className="msvt-clicked-popup">
              <div className="msvt-clicked-popup-card">
                <div className="msvt-clicked-popup-header">
                  📍 TỌA ĐỘ VỪA CHỌN
                </div>
                <div className="msvt-clicked-popup-coords">
                  <div><strong>Vĩ độ:</strong> {clickedCoord.lat}</div>
                  <div><strong>Kinh độ:</strong> {clickedCoord.lng}</div>
                  <div className="msvt-clicked-popup-dms">
                    {decimalToDms(clickedCoord.lat, true)} &bull; {decimalToDms(clickedCoord.lng, false)}
                  </div>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <a
                    href={`https://www.google.com/maps?q=${clickedCoord.lat},${clickedCoord.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="map-coord-btn-gmaps"
                    style={{ justifyContent: 'center' }}
                  >
                    🗺️ Đối chiếu Google Maps
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Nút điều khiển nhanh: Toàn cảnh MSVT */}
      <div className="map-quick-controls">
        <button
          type="button"
          className="map-control-btn"
          onClick={onResetView}
          title="Phóng nhanh về toàn cảnh vùng trồng tỉnh Nghệ An"
        >
          <span>📍</span>
          <span>Toàn cảnh MSVT</span>
        </button>
      </div>

      {/* Chú giải Bản đồ Tối giản (Collapsible Minimalist Legend) */}
      <MsvtLegend stats={stats} />

      {/* Thanh hiển thị tọa độ click trên bản đồ */}
      {clickedCoord && (
        <div className="map-coord-bar">
          <div className="map-coord-info">
            <span className="map-coord-title">📍 TỌA ĐỘ VỪA CHỌN:</span>
            <span className="map-coord-val">
              {clickedCoord.lat}, {clickedCoord.lng}
            </span>
            <span className="map-coord-dms">
              ({decimalToDms(clickedCoord.lat, true)}, {decimalToDms(clickedCoord.lng, false)})
            </span>
          </div>

          <div className="map-coord-actions">
            <button
              type="button"
              className="map-coord-btn-copy"
              onClick={() => handleCopyCoord(`${clickedCoord.lat}, ${clickedCoord.lng}`)}
              title="Sao chép cặp tọa độ vào bộ nhớ tạm"
            >
              <span>{copiedCoord ? '✅ Đã sao chép' : '📋 Sao chép tọa độ'}</span>
            </button>

            <a
              href={`https://www.google.com/maps?q=${clickedCoord.lat},${clickedCoord.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="map-coord-btn-gmaps"
              title="Đối chiếu tọa độ GPS trên Google Maps"
            >
              <span>🗺️ Đối chiếu Google Maps</span>
            </a>

            <button
              type="button"
              className="map-coord-btn-locate"
              onClick={() => onFlyToCoord && onFlyToCoord(clickedCoord)}
              title="Phóng nhanh đến điểm GPS này"
            >
              <span>📍 Phóng đến điểm GPS</span>
            </button>

            <button
              type="button"
              className="map-coord-btn-lookup"
              onClick={() => onQuickLookupCoord && onQuickLookupCoord(clickedCoord)}
              title="Tra cứu vùng trồng bao phủ"
            >
              <span>🔎 Tra cứu</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapViewer;

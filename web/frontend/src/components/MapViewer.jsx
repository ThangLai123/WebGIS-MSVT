import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapViewer.css';
import MsvtLayer from './MsvtLayer';
import MsvtLegend from './MsvtLegend';

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
    // Gọi invalidateSize sau khi animation slide của sidebar hoàn thành
    const timer = setTimeout(() => {
      try {
        map.invalidateSize({ animate: false });
      } catch {}
    }, 250);
    return () => clearTimeout(timer);
  }, [map, showMsvtPanel]);

  useEffect(() => {
    const handleResize = () => {
      try {
        map.invalidateSize({ animate: false });
      } catch {}
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
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
        style={{ height: '100%', width: '100%' }}
        preferCanvas={true}
        boxZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
          <span>
            📍 <strong>Tọa độ vừa chọn:</strong> Lat: {clickedCoord.lat}, Lng: {clickedCoord.lng}
          </span>
          <button
            type="button"
            className="map-coord-btn-lookup"
            onClick={() => onQuickLookupCoord && onQuickLookupCoord(clickedCoord)}
          >
            Tra cứu vùng trồng
          </button>
        </div>
      )}
    </div>
  );
};

export default MapViewer;

import React, { useState, useEffect } from 'react';
import msvtApi from '../services/msvtApi';
import './MsvtStatsModal.css';

const MsvtStatsModal = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    msvtApi.getStatistics()
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Không thể tải dữ liệu thống kê từ FastAPI.');
        setLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const cropEntries = stats?.by_crop_type
    ? Object.entries(stats.by_crop_type).sort((a, b) => b[1] - a[1])
    : [];

  const marketEntries = stats?.by_market
    ? Object.entries(stats.by_market).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="msvt-stats-overlay" onClick={onClose}>
      <div className="msvt-stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="msvt-stats-header">
          <h3>
            <span>📊</span>
            <span>Báo Cáo Thống Kê Tổng Hợp Vùng Trồng MSVT</span>
          </h3>
          <button
            type="button"
            className="msvt-stats-close-btn"
            onClick={onClose}
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="msvt-stats-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              ⏳ Đang tổng hợp dữ liệu từ PostgreSQL/PostGIS...
            </div>
          ) : error ? (
            <div style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '14px', borderRadius: '8px', border: '1px solid #fecaca' }}>
              ⚠️ {error}
            </div>
          ) : stats ? (
            <>
              {/* 4 Thẻ số liệu chính */}
              <div className="msvt-stats-cards-row">
                <div className="msvt-stats-mini-card">
                  <span className="msvt-stats-card-label">Tổng vùng trồng</span>
                  <span className="msvt-stats-card-val">{stats.total_regions}</span>
                  <span className="msvt-stats-card-sub">Toàn tỉnh Nghệ An</span>
                </div>

                <div className="msvt-stats-mini-card blue">
                  <span className="msvt-stats-card-label">Diện tích canh tác</span>
                  <span className="msvt-stats-card-val">
                    {Number(stats.total_area_ha).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ha
                  </span>
                  <span className="msvt-stats-card-sub">Tổng diện tích cấp mã</span>
                </div>

                <div className="msvt-stats-mini-card amber">
                  <span className="msvt-stats-card-label">Tổng sản lượng</span>
                  <span className="msvt-stats-card-val">
                    {Number(stats.total_recorded_yield_tons).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tấn
                  </span>
                  <span className="msvt-stats-card-sub">Ghi nhận từ CSDL</span>
                </div>

                <div className="msvt-stats-mini-card purple">
                  <span className="msvt-stats-card-label">Đối tượng bản đồ</span>
                  <span className="msvt-stats-card-val">
                    {(stats.geometry_stats?.multipolygon_count || 0) + (stats.geometry_stats?.point_count || 0)}
                  </span>
                  <span className="msvt-stats-card-sub">
                    🟩 {stats.geometry_stats?.multipolygon_count} đa giác • 🔵 {stats.geometry_stats?.point_count} điểm
                  </span>
                </div>
              </div>

              {/* Bảng phân bổ cây trồng & Thị trường */}
              <div className="msvt-stats-grid-2">
                <div className="msvt-stats-section-box">
                  <h4 className="msvt-stats-box-title">
                    <span>🌾</span>
                    <span>Cơ cấu cây trồng ({cropEntries.length} loại)</span>
                  </h4>
                  <div className="msvt-stats-list">
                    {cropEntries.map(([crop, count]) => (
                      <div key={crop} className="msvt-stats-item">
                        <span className="msvt-stats-item-name">{crop}</span>
                        <span className="msvt-stats-item-count">{count} vùng</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="msvt-stats-section-box">
                  <h4 className="msvt-stats-box-title">
                    <span>🌐</span>
                    <span>Thị trường xuất khẩu & Tiêu thụ</span>
                  </h4>
                  <div className="msvt-stats-list">
                    {marketEntries.map(([market, count]) => (
                      <div key={market} className="msvt-stats-item">
                        <span className="msvt-stats-item-name">{market}</span>
                        <span className="msvt-stats-item-count" style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}>
                          {count} vùng
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', fontSize: '12px', color: '#64748b' }}>
                    <div><strong>Phân bố không gian PostGIS:</strong></div>
                    <div style={{ marginTop: '4px' }}>• Ranh giới đa giác (MultiPolygon): <strong>{stats.geometry_stats?.multipolygon_count}</strong> vùng</div>
                    <div>• Tọa độ điểm mốc (Point): <strong>{stats.geometry_stats?.point_count}</strong> vùng</div>
                    <div>• Chưa có tọa độ GIS: <strong>{stats.geometry_stats?.without_geometry_count}</strong> vùng</div>
                  </div>
                </div>
              </div>

              {/* Ghi chú chuẩn hóa */}
              <div className="msvt-stats-note-box">
                ℹ️ <strong>Nguồn dữ liệu:</strong> {stats.yield_unit_note || 'Dữ liệu được lưu trữ và truy vấn theo thời gian thực từ cơ sở dữ liệu PostgreSQL/PostGIS.'}
              </div>
            </>
          ) : null}
        </div>

        <div className="msvt-stats-footer">
          <button
            type="button"
            className="msvt-stats-btn-close"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default MsvtStatsModal;

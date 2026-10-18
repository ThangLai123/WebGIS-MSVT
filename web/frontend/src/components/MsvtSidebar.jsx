import React, { useState, useEffect } from 'react';
import msvtApi from '../services/msvtApi';
import { getRegionCoordinates, decimalToDms } from '../utils/geometryUtils';
import './MsvtSidebar.css';

/**
 * Component MsvtSidebar - Bảng thông tin, Tra cứu tọa độ và Bộ lọc Vùng trồng MSVT
 */
const MsvtSidebar = ({
  selectedRegion = null,
  onClearSelection = () => {},
  onFlyToRegion = () => {},
  onFlyToCoord = () => {},
  filters = { msvt: '', loaiCay: '', thiTruong: '' },
  onFilterChange = () => {},
  onResetFilters = () => {},
  clickedCoord = null,
  stats = { total: 42, pointCount: 17, polyCount: 25 },
  onClose = () => {},
  activeTab = 'detail',
  setActiveTab = () => {}
}) => {
  // Trạng thái sao chép tọa độ
  const [copiedCoord, setCopiedCoord] = useState(false);

  const handleCopyCoord = (coordText) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(coordText).then(() => {
        setCopiedCoord(true);
        setTimeout(() => setCopiedCoord(false), 2200);
      }).catch(() => {});
    }
  };

  // Trạng thái tra cứu tọa độ
  const [lookupLat, setLookupLat] = useState('');
  const [lookupLng, setLookupLng] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Khi click vào map, cho phép đồng bộ tọa độ vào form tra cứu nếu tab tra cứu đang mở
  const handleUseClickedCoord = () => {
    if (clickedCoord) {
      setLookupLat(String(clickedCoord.lat));
      setLookupLng(String(clickedCoord.lng));
      setLookupError(null);
    }
  };

  // Tự động chuyển về tab "detail" khi có một vùng được chọn
  useEffect(() => {
    if (selectedRegion) {
      setActiveTab('detail');
    }
  }, [selectedRegion, setActiveTab]);

  // Thực hiện tra cứu tọa độ qua FastAPI ST_Covers
  const handleExecuteLookup = async (e) => {
    if (e) e.preventDefault();

    if (!lookupLat || !lookupLng) {
      setLookupError('Vui lòng nhập đầy đủ Vĩ độ (Latitude) và Kinh độ (Longitude).');
      return;
    }

    const latVal = parseFloat(lookupLat);
    const lngVal = parseFloat(lookupLng);

    if (isNaN(latVal) || isNaN(lngVal)) {
      setLookupError('Tọa độ nhập vào không phải là số hợp lệ.');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setHasSearched(true);
    setLookupResults(null);

    try {
      const results = await msvtApi.lookupByCoordinates(latVal, lngVal);
      setLookupResults(results);
    } catch (err) {
      setLookupError(err.message || 'Lỗi khi gọi API tra cứu tọa độ.');
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="msvt-panel-container">
      {/* Header */}
      <div className="msvt-panel-header">
        <h3>
          <span>🌱</span>
          <span>Vùng trồng MSVT</span>
        </h3>
        <button 
          className="msvt-close-btn" 
          onClick={onClose} 
          title="Đóng bảng thông tin MSVT"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="msvt-tabs">
        <button 
          className={`msvt-tab-btn ${activeTab === 'detail' ? 'active' : ''}`}
          onClick={() => setActiveTab('detail')}
        >
          <span>📋</span> Chi tiết
        </button>
        <button 
          className={`msvt-tab-btn ${activeTab === 'lookup' ? 'active' : ''}`}
          onClick={() => setActiveTab('lookup')}
        >
          <span>🎯</span> Tra cứu GPS
        </button>
        <button 
          className={`msvt-tab-btn ${activeTab === 'filter' ? 'active' : ''}`}
          onClick={() => setActiveTab('filter')}
        >
          <span>🔎</span> Bộ lọc ({stats.total || 42})
        </button>
      </div>

      {/* Tab Content */}
      <div className="msvt-panel-body">
        {/* ================= TAB 1: CHI TIẾT VÙNG TRỒNG ================= */}
        {activeTab === 'detail' && (
          <>
            {selectedRegion ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Badge hình học & Cảnh báo */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {selectedRegion.geom_type === 'MULTIPOLYGON' || selectedRegion.geom_type === 'Polygon' ? (
                    <span className="msvt-badge msvt-badge-poly">
                      ⬟ Vùng ranh giới đa giác (Polygon)
                    </span>
                  ) : (
                    <span className="msvt-badge msvt-badge-point">
                      📍 Điểm mốc đại diện (Point)
                    </span>
                  )}

                  <button 
                    onClick={onClearSelection}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6b7280',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textDecoration: 'underline'
                    }}
                  >
                    Bỏ chọn
                  </button>
                </div>

                {/* Tiêu đề Mã MSVT */}
                <h4 className="msvt-detail-title">
                  {selectedRegion.msvt_moi || selectedRegion.msvt_cu || 'Chưa có mã MSVT'}
                </h4>

                {/* Cảnh báo polygon chưa xác minh thực địa nếu là Polygon */}
                {(selectedRegion.geom_type === 'MULTIPOLYGON' || selectedRegion.geom_type === 'Polygon') && (
                  <div className="msvt-alert msvt-alert-warning">
                    <strong>⚠️ Lưu ý kiểm chứng không gian:</strong>
                    <span>Ranh giới polygon chưa được xác minh thực địa. Cần đối chiếu thực tế trước khi áp dụng pháp lý.</span>
                  </div>
                )}

                {/* Danh sách thuộc tính vùng trồng */}
                <ul className="msvt-meta-list">
                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Mã MSVT mới:</span>
                    <span className="msvt-meta-value font-mono font-bold" style={{ color: '#15803d' }}>
                      {selectedRegion.msvt_moi || '(Trống)'}
                    </span>
                  </li>

                  {selectedRegion.msvt_cu && (
                    <li className="msvt-meta-item">
                      <span className="msvt-meta-label">Mã MSVT cũ:</span>
                      <span className="msvt-meta-value">{selectedRegion.msvt_cu}</span>
                    </li>
                  )}

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Tổ chức / Cá nhân:</span>
                    <span className="msvt-meta-value font-semibold">
                      {selectedRegion.to_chuc_ca_nhan || 'Chưa cập nhật'}
                    </span>
                  </li>

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Người đại diện:</span>
                    <span className="msvt-meta-value">
                      {selectedRegion.nguoi_dai_dien || 'Chưa cập nhật'}
                    </span>
                  </li>

                  {/* LƯU Ý BẢO MẬT: TUYỆT ĐỐI KHÔNG HIỂN THỊ SỐ ĐIỆN THOẠI VÀ EMAIL */}

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Loại cây trồng:</span>
                    <span className="msvt-meta-value font-bold" style={{ color: '#047857' }}>
                      {selectedRegion.loai_cay_trong || 'Chưa xác định'}
                    </span>
                  </li>

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Diện tích công bố:</span>
                    <span className="msvt-meta-value">
                      {selectedRegion.dien_tich_ha != null ? `${selectedRegion.dien_tich_ha} ha` : 'Chưa có số liệu'}
                    </span>
                  </li>

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Sản lượng ghi nhận:</span>
                    <span className="msvt-meta-value">
                      {selectedRegion.tong_san_luong_tan != null ? `${selectedRegion.tong_san_luong_tan} tấn` : 'Chưa có số liệu'}
                    </span>
                    {/* GHI CHÚ BẮT BUỘC THEO QUY CHUẨN DỮ LIỆU */}
                    <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px', fontStyle: 'italic' }}>
                      * Sản lượng lấy từ Excel, đơn vị chưa được xác minh.
                    </div>
                  </li>

                  {selectedRegion.so_ho_tham_gia != null && (
                    <li className="msvt-meta-item">
                      <span className="msvt-meta-label">Số hộ tham gia:</span>
                      <span className="msvt-meta-value">{selectedRegion.so_ho_tham_gia} hộ</span>
                    </li>
                  )}

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Địa chỉ vùng trồng:</span>
                    <span className="msvt-meta-value">
                      {selectedRegion.dia_chi_msvt || 'Chưa cập nhật'}
                    </span>
                  </li>

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Quy trình sản xuất:</span>
                    <span className="msvt-meta-value">
                      {selectedRegion.quy_trinh || 'Chưa cập nhật'}
                    </span>
                  </li>

                  <li className="msvt-meta-item">
                    <span className="msvt-meta-label">Thị trường xuất khẩu / tiêu thụ:</span>
                    <span className="msvt-meta-value font-semibold" style={{ color: '#1d4ed8' }}>
                      {selectedRegion.thi_truong || 'Chưa xác định'}
                    </span>
                  </li>
                </ul>

                {/* ========================================================
                    KHU VỰC XÁC MINH TỌA ĐỘ GPS CHÍNH XÁC (SECTION 10)
                    ======================================================== */}
                {(() => {
                  const coords = getRegionCoordinates(selectedRegion);
                  if (!coords) return null;
                  return (
                    <div className="msvt-gps-card">
                      <div className="msvt-gps-card-header">
                        <span className="msvt-gps-card-title">📍 TỌA ĐỘ GPS CHÍNH XÁC (WGS84)</span>
                        <span className="msvt-gps-type-tag">{coords.geomType}</span>
                      </div>

                      <div className="msvt-gps-grid">
                        <div className="msvt-gps-row">
                          <span className="msvt-gps-label">Vĩ độ (Lat):</span>
                          <div className="msvt-gps-values">
                            <span className="msvt-gps-dec">{coords.latDecimal}</span>
                            <span className="msvt-gps-dms">{coords.latDms}</span>
                          </div>
                        </div>

                        <div className="msvt-gps-row">
                          <span className="msvt-gps-label">Kinh độ (Lng):</span>
                          <div className="msvt-gps-values">
                            <span className="msvt-gps-dec">{coords.lngDecimal}</span>
                            <span className="msvt-gps-dms">{coords.lngDms}</span>
                          </div>
                        </div>

                        <div className="msvt-gps-row">
                          <span className="msvt-gps-label">Nguồn tọa độ:</span>
                          <span className="msvt-gps-source">{coords.source}</span>
                        </div>
                      </div>

                      <div className="msvt-gps-actions">
                        <button
                          type="button"
                          className="msvt-gps-btn btn-copy"
                          onClick={() => handleCopyCoord(`${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`)}
                          title="Sao chép cặp tọa độ Decimal vào bộ nhớ tạm"
                        >
                          <span>{copiedCoord ? '✅ Đã sao chép!' : '📋 Sao chép tọa độ'}</span>
                        </button>

                        <a
                          href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="msvt-gps-btn btn-gmaps"
                          title="Mở chính xác tọa độ GPS này trên Google Maps"
                        >
                          <span>🗺️ Đối chiếu Google Maps</span>
                        </a>

                        <button
                          type="button"
                          className="msvt-gps-btn btn-locate"
                          onClick={() => {
                            if (onFlyToCoord) {
                              onFlyToCoord({ lat: coords.lat, lng: coords.lng });
                            } else {
                              onFlyToRegion(selectedRegion);
                            }
                          }}
                          title="Phóng nhanh đến tọa độ này trên bản đồ WebGIS"
                        >
                          <span>📍 Phóng đến điểm GPS</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Nút điều hướng bản đồ */}
                <button 
                  className="msvt-action-btn msvt-action-btn-primary"
                  onClick={() => onFlyToRegion(selectedRegion)}
                >
                  <span>🔍</span> Phóng to đến vị trí trên bản đồ
                </button>
              </div>
            ) : (
              <div className="msvt-empty-state">
                <span style={{ fontSize: '36px' }}>🗺️</span>
                <p><strong>Chưa chọn vùng trồng nào</strong></p>
                <p>Nhấp chuột vào bất kỳ điểm mốc xanh lá trên bản đồ để xem chi tiết thông tin quản lý và hiển thị ranh giới thực tế.</p>
              </div>
            )}
          </>
        )}

        {/* ================= TAB 2: TRA CỨU TỌA ĐỘ GPS ================= */}
        {activeTab === 'lookup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="msvt-alert msvt-alert-info">
              <strong>🎯 Tra cứu không gian bằng tọa độ:</strong>
              <span>Kiểm tra xem một điểm GPS bất kỳ có thuộc phạm vi ranh giới đa giác vùng trồng nào hay không (hàm PostGIS <code>ST_Covers</code>).</span>
            </div>

            {/* Thông báo tọa độ vừa click trên bản đồ */}
            {clickedCoord && (
              <div className="msvt-gps-card" style={{ marginTop: 0, marginBottom: '4px' }}>
                <div className="msvt-gps-card-header">
                  <span className="msvt-gps-card-title">📍 TỌA ĐỘ VỪA CHỌN</span>
                  <span className="msvt-gps-type-tag" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                    Click Bản đồ
                  </span>
                </div>

                <div className="msvt-gps-grid">
                  <div className="msvt-gps-row">
                    <span className="msvt-gps-label">Vĩ độ (Lat):</span>
                    <div className="msvt-gps-values">
                      <span className="msvt-gps-dec">{clickedCoord.lat}</span>
                      <span className="msvt-gps-dms">{decimalToDms(clickedCoord.lat, true)}</span>
                    </div>
                  </div>

                  <div className="msvt-gps-row">
                    <span className="msvt-gps-label">Kinh độ (Lng):</span>
                    <div className="msvt-gps-values">
                      <span className="msvt-gps-dec">{clickedCoord.lng}</span>
                      <span className="msvt-gps-dms">{decimalToDms(clickedCoord.lng, false)}</span>
                    </div>
                  </div>

                  <div className="msvt-gps-row">
                    <span className="msvt-gps-label">Nguồn tọa độ:</span>
                    <span className="msvt-gps-source">Tọa độ tương tác chọn trên bản đồ</span>
                  </div>
                </div>

                <div className="msvt-gps-actions">
                  <button
                    type="button"
                    className="msvt-gps-btn btn-copy"
                    onClick={() => handleCopyCoord(`${clickedCoord.lat}, ${clickedCoord.lng}`)}
                    title="Sao chép cặp tọa độ vào bộ nhớ tạm"
                  >
                    <span>{copiedCoord ? '✅ Đã sao chép!' : '📋 Sao chép tọa độ'}</span>
                  </button>

                  <a
                    href={`https://www.google.com/maps?q=${clickedCoord.lat},${clickedCoord.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="msvt-gps-btn btn-gmaps"
                    title="Mở chính xác tọa độ GPS này trên Google Maps"
                  >
                    <span>🗺️ Đối chiếu Google Maps</span>
                  </a>

                  <button
                    type="button"
                    className="msvt-gps-btn btn-locate"
                    onClick={() => onFlyToCoord && onFlyToCoord(clickedCoord)}
                    title="Phóng nhanh đến tọa độ này trên bản đồ WebGIS"
                  >
                    <span>📍 Phóng đến điểm GPS</span>
                  </button>
                </div>

                <button
                  type="button"
                  className="msvt-action-btn msvt-action-btn-secondary"
                  style={{ marginTop: '8px', width: '100%', fontSize: '11.5px', padding: '6px' }}
                  onClick={handleUseClickedCoord}
                >
                  ⬇️ Điền tọa độ này vào ô tra cứu bên dưới
                </button>
              </div>
            )}

            {/* Form nhập tọa độ */}
            <form onSubmit={handleExecuteLookup} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div className="msvt-form-group">
                <label className="msvt-form-label">Vĩ độ (Latitude):</label>
                <input
                  type="number"
                  step="any"
                  placeholder="Ví dụ: 19.020..."
                  value={lookupLat}
                  onChange={(e) => setLookupLat(e.target.value)}
                  className="msvt-form-input"
                  required
                />
              </div>

              <div className="msvt-form-group">
                <label className="msvt-form-label">Kinh độ (Longitude):</label>
                <input
                  type="number"
                  step="any"
                  placeholder="Ví dụ: 105.556..."
                  value={lookupLng}
                  onChange={(e) => setLookupLng(e.target.value)}
                  className="msvt-form-input"
                  required
                />
              </div>

              {lookupError && (
                <div className="msvt-alert msvt-alert-danger">
                  <span>⚠️ {lookupError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={lookupLoading}
                className="msvt-action-btn msvt-action-btn-primary"
              >
                {lookupLoading ? '⏳ Đang tra cứu...' : '🔎 Tra cứu vùng trồng'}
              </button>
            </form>

            {/* Kết quả tra cứu */}
            {hasSearched && !lookupLoading && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {lookupResults && lookupResults.length > 0 ? (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#15803d' }}>
                      ✅ Tìm thấy {lookupResults.length} vùng trồng bao trùm điểm này:
                    </div>

                    {lookupResults.map((item) => (
                      <div 
                        key={item.id} 
                        className="msvt-result-item"
                        onClick={() => {
                          onFlyToRegion(item);
                        }}
                      >
                        <div style={{ fontWeight: 'bold', color: '#166534', fontSize: '13.5px' }}>
                          {item.msvt_moi || item.msvt_cu || 'Không có mã MSVT'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#4b5563' }}>
                          <div><strong>Cây trồng:</strong> {item.loai_cay_trong || 'Chưa rõ'}</div>
                          <div><strong>Tổ chức/Cá nhân:</strong> {item.to_chuc_ca_nhan || 'N/A'}</div>
                          <div><strong>Diện tích:</strong> {item.dien_tich_ha != null ? item.dien_tich_ha + ' ha' : 'N/A'}</div>
                        </div>
                        <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: '600' }}>
                          👉 Nhấn để xem chi tiết & điều hướng bản đồ
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="msvt-alert msvt-alert-warning" style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#b91c1c' }}>
                      ❌ Không tìm thấy vùng trồng nào
                    </div>
                    <p style={{ margin: '6px 0 0 0', fontSize: '12px' }}>
                      Tọa độ ({lookupLat}, {lookupLng}) không nằm trong bất kỳ ranh giới đa giác vùng trồng nào được ghi nhận.
                    </p>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px' }}>
                      * Hệ thống tra cứu chính xác theo ranh giới bao phủ (ST_Covers), không tự suy đoán vùng gần nhất.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: BỘ LỌC VÙNG TRỒNG ================= */}
        {activeTab === 'filter' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '12px', color: '#4b5563', lineHeight: 1.4 }}>
              Lọc hiển thị {stats.total || 42} vùng trồng trên bản đồ theo các tiêu chí ({stats.pointCount || 17} điểm Point & {stats.polyCount || 25} vùng Polygon).
            </div>

            <div className="msvt-form-group">
              <label className="msvt-form-label">Mã MSVT (mới hoặc cũ):</label>
              <input
                type="text"
                placeholder="Tìm theo mã MSVT..."
                value={filters.msvt || ''}
                onChange={(e) => onFilterChange('msvt', e.target.value)}
                className="msvt-form-input"
              />
            </div>

            <div className="msvt-form-group">
              <label className="msvt-form-label">Loại cây trồng:</label>
              <input
                type="text"
                placeholder="Ví dụ: Lúa, Cam, Chanh leo..."
                value={filters.loaiCay || ''}
                onChange={(e) => onFilterChange('loaiCay', e.target.value)}
                className="msvt-form-input"
              />
            </div>

            <div className="msvt-form-group">
              <label className="msvt-form-label">Thị trường xuất khẩu / tiêu thụ:</label>
              <input
                type="text"
                placeholder="Ví dụ: Trung Quốc, Hoa Kỳ, EU..."
                value={filters.thiTruong || ''}
                onChange={(e) => onFilterChange('thiTruong', e.target.value)}
                className="msvt-form-input"
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="msvt-action-btn msvt-action-btn-secondary"
                style={{ flex: 1 }}
                onClick={onResetFilters}
              >
                🔄 Đặt lại bộ lọc
              </button>
            </div>

            {/* Thống kê nhanh dữ liệu hình học */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '12px',
              marginTop: '10px'
            }}>
              <div style={{ fontWeight: 'bold', color: '#166534', marginBottom: '6px' }}>
                📊 Cơ cấu hình học đối tượng MSVT:
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>• Tổng số đối tượng có hình học: <strong>{stats.total || 42}</strong></li>
                <li>• Vùng ranh giới Polygon / MultiPolygon: <strong>{stats.polyCount || 25}</strong></li>
                <li>• Điểm mốc tọa độ Point: <strong>{stats.pointCount || 17}</strong></li>
                <li style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>
                  (Các bản ghi chưa có tọa độ được lưu trữ an toàn trong CSDL, không hiển thị vị trí giả)
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MsvtSidebar;

/**
 * MsvtImportModal.jsx - Hộp thoại Wizard 6 bước Nhập nhanh MSVT từ Excel vào PostgreSQL/PostGIS
 * Dành riêng cho Quản trị viên (Admin).
 * Tuân thủ nghiêm ngặt các nguyên tắc:
 * 1. Không tự động INSERT/UPDATE khi vừa tải file.
 * 2. Quy trình DRY RUN bắt buộc.
 * 3. Chống trùng lặp MSVT với database và trong cùng file.
 * 4. Cho phép xem trước hình học và rà soát lỗi trên bản đồ Leaflet.
 * 5. Commit nguyên tử (Atomic transaction) vào PostgreSQL khi Admin xác nhận.
 * 6. Xuất báo cáo kiểm định Excel 6 sheet qua openpyxl.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Polyline,
  Tooltip,
  useMap
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import adminApi from '../services/adminApi';
import './MsvtImportModal.css';

// Fix icon Leaflet mặc định an toàn
try {
  if (L?.Icon?.Default?.prototype) {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });
  }
} catch (err) {
  console.warn('[MsvtImportModal] Không thể ghi đè icon mặc định:', err);
}


// Danh mục 15 trường dữ liệu chuẩn của bảng public.vung_trong
const TARGET_FIELDS = [
  { key: 'msvt_moi', label: 'Mã số vùng trồng mới', required: true, desc: 'Mã định danh vùng trồng mới' },
  { key: 'msvt_cu', label: 'Mã số vùng trồng cũ', required: false, desc: 'Mã số vùng trồng trước đây' },
  { key: 'to_chuc_ca_nhan', label: 'Tổ chức / Cá nhân', required: false, desc: 'Tên HTX, doanh nghiệp hoặc chủ hộ' },
  { key: 'nguoi_dai_dien', label: 'Người đại diện', required: false, desc: 'Họ tên người đại diện pháp luật' },
  { key: 'so_dien_thoai', label: 'Số điện thoại', required: false, desc: 'Số điện thoại liên lạc (giữ số 0 đầu)' },
  { key: 'email', label: 'Hòm thư điện tử (Email)', required: false, desc: 'Địa chỉ email liên hệ' },
  { key: 'toa_do_goc', label: 'Tọa độ địa lý (GPS)', required: false, desc: 'Chuỗi tọa độ Decimal hoặc DMS' },
  { key: 'dia_chi_msvt', label: 'Địa chỉ vùng trồng', required: false, desc: 'Xã, huyện, tỉnh nơi đặt vùng trồng' },
  { key: 'loai_cay_trong', label: 'Loại cây trồng', required: false, desc: 'Lúa, Cam, Chè, Rau màu...' },
  { key: 'so_ho_tham_gia', label: 'Số hộ tham gia', required: false, desc: 'Số hộ gia đình cùng canh tác (nguyên)' },
  { key: 'dien_tich_ha', label: 'Diện tích (ha)', required: false, desc: 'Quy mô diện tích theo hồ sơ' },
  { key: 'tong_san_luong_tan', label: 'Tổng sản lượng (tấn)', required: false, desc: 'Tổng sản lượng thu hoạch dự kiến' },
  { key: 'san_luong_tan_ha', label: 'Năng suất (tấn/ha)', required: false, desc: 'Năng suất bình quân trên mỗi ha' },
  { key: 'quy_trinh', label: 'Quy trình canh tác', required: false, desc: 'VietGAP, GlobalGAP, Hữu cơ...' },
  { key: 'thi_truong', label: 'Thị trường tiêu thụ', required: false, desc: 'Nội địa hoặc Xuất khẩu' }
];

// Helper tự động zoom fit bounds trên Leaflet preview
const MapBoundsFitter = ({ geojson }) => {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      if (geojson.type === 'Point' && Array.isArray(geojson.coordinates)) {
        const [lng, lat] = geojson.coordinates;
        map.setView([lat, lng], 15, { animate: true });
      } else if (geojson.type === 'MultiPolygon' && Array.isArray(geojson.coordinates)) {
        const ring = geojson.coordinates[0]?.[0];
        if (ring && ring.length > 0) {
          const latlngs = ring.map(([lng, lat]) => [lat, lng]);
          const bounds = L.latLngBounds(latlngs);
          map.fitBounds(bounds, { padding: [30, 30], animate: true });
        }
      }
    } catch (err) {
      console.warn('[MapBoundsFitter] Lỗi zoom:', err);
    }
  }, [geojson, map]);
  return null;
};

export default function MsvtImportModal({ isOpen, onClose, onSuccess }) {
  // Wizard Step: 1 -> 6
  const [currentStep, setCurrentStep] = useState(1);

  // Trạng thái File và Job
  const [file, setFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [jobData, setJobData] = useState(null);

  // Bước 2: Cấu hình ánh xạ cột
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [dataStartRow, setDataStartRow] = useState(2);
  const [columnMapping, setColumnMapping] = useState({});

  // Bước 4: Preview và lọc dữ liệu
  const [previewSummary, setPreviewSummary] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());

  // Xem trước bản đồ Leaflet
  const [activeMapRow, setActiveMapRow] = useState(null);

  // Bước 5: Xác nhận commit
  const [confirmWarnings, setConfirmWarnings] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  const fileInputRef = useRef(null);

  // Tính toán số liệu được chọn (phải khai báo hook trước bất kỳ lệnh return nào)
  const selectedStats = useMemo(() => {
    let count = 0;
    let totalArea = 0.0;
    previewRows.forEach(r => {
      if (selectedRowIds.has(r.row_id)) {
        count += 1;
        totalArea += (r.dien_tich_ha || 0.0);
      }
    });
    return { count, totalArea: Math.round(totalArea * 100) / 100 };
  }, [previewRows, selectedRowIds]);

  if (!isOpen) return null;


  // ============================================================================
  // XỬ LÝ BƯỚC 1: TẢI FILE LÊN (UPLOAD)
  // ============================================================================
  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setErrorMessage('Chỉ hỗ trợ tệp định dạng Excel chuẩn (.xlsx). Nếu bạn dùng .xls, vui lòng lưu lại thành .xlsx.');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('Dung lượng tệp vượt quá 10 MB cho phép.');
      return;
    }
    setFile(selectedFile);
    setErrorMessage('');
    uploadFileToBackend(selectedFile);
  };

  const uploadFileToBackend = async (fileToUpload) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const data = await adminApi.uploadImportFile(fileToUpload);
      setJobData(data);
      setSelectedSheet(data.default_sheet || (data.sheets && data.sheets[0]) || '');
      setHeaderRow(data.detected_header_row || 1);
      setDataStartRow(data.detected_data_start_row || 2);

      // Khởi tạo ánh xạ gợi ý ban đầu
      const initialMap = {};
      TARGET_FIELDS.forEach(tf => {
        const found = data.columns.find(c => c.suggested_field === tf.key);
        if (found) {
          initialMap[tf.key] = found.col_index;
        } else {
          initialMap[tf.key] = '';
        }
      });
      setColumnMapping(initialMap);

      // Chuyển sang Bước 2
      setCurrentStep(2);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải file lên máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // XỬ LÝ BƯỚC 2: ÁNH XẠ CỘT & CHẠY DRY RUN
  // ============================================================================
  const handleMappingChange = (fieldKey, colIndexStr) => {
    setColumnMapping(prev => ({
      ...prev,
      [fieldKey]: colIndexStr ? parseInt(colIndexStr, 10) : null
    }));
  };

  const handleStartDryRun = async () => {
    if (!jobData?.job_id) return;
    setLoading(true);
    setErrorMessage('');
    setCurrentStep(3); // Hiển thị màn hình tiến trình DRY RUN

    try {
      const payload = {
        sheet_name: selectedSheet,
        header_row: Number(headerRow),
        data_start_row: Number(dataStartRow),
        mapping: columnMapping,
        skip_duplicates: true
      };

      const summary = await adminApi.validateImportJob(jobData.job_id, payload);
      setPreviewSummary(summary);

      // Tải trang 1 bảng preview
      const previewData = await adminApi.getImportPreview(jobData.job_id, {
        page: 1,
        pageSize: 20,
        statusFilter: 'ALL'
      });

      setPreviewRows(previewData.items || []);
      setTotalPages(previewData.total_pages || 1);
      setPage(1);

      // Mặc định chọn tất cả các dòng HỢP LỆ và CẢNH BÁO
      const selected = new Set();
      (previewData.items || []).forEach(r => {
        if (r.status === 'VALID' || r.status === 'WARNING') {
          selected.add(r.row_id);
        }
      });
      setSelectedRowIds(selected);

      // Chuyển sang Bước 4 (Xem trước & Rà soát)
      setCurrentStep(4);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi trong quá trình kiểm định dữ liệu.');
      setCurrentStep(2); // Quay lại bước 2 nếu lỗi
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // XỬ LÝ BƯỚC 4: XEM TRƯỚC VÀ LỌC BẢN GHI
  // ============================================================================
  const fetchPreviewPage = async (targetPage = page, targetFilter = statusFilter, targetSearch = searchQuery) => {
    if (!jobData?.job_id) return;
    setLoading(true);
    try {
      const data = await adminApi.getImportPreview(jobData.job_id, {
        page: targetPage,
        pageSize,
        statusFilter: targetFilter,
        search: targetSearch
      });
      setPreviewRows(data.items || []);
      setTotalPages(data.total_pages || 1);
      setPage(targetPage);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải dữ liệu xem trước.');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilter) => {
    setStatusFilter(newFilter);
    setPage(1);
    fetchPreviewPage(1, newFilter, searchQuery);
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setPage(1);
    fetchPreviewPage(1, statusFilter, val);
  };

  const toggleRowSelection = (rowId) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const selectAllEligible = () => {
    const next = new Set(selectedRowIds);
    previewRows.forEach(r => {
      if (r.status !== 'INVALID') {
        next.add(r.row_id);
      }
    });
    setSelectedRowIds(next);
  };

  const deselectAll = () => {
    setSelectedRowIds(new Set());
  };


  // ============================================================================
  // XỬ LÝ BƯỚC 5: XÁC NHẬN COMMIT VÀO POSTGRESQL
  // ============================================================================
  const handleCommitImport = async () => {
    if (!jobData?.job_id) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await adminApi.commitImportJob(jobData.job_id, {
        selectedRowIds: Array.from(selectedRowIds),
        confirmWarnings: confirmWarnings
      });
      setCommitResult(res);
      setCurrentStep(6); // Chuyển sang bước báo cáo kết quả

      // Gọi callback thông báo thành công cho Dashboard
      if (onSuccess) {
        onSuccess(res);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi thực thi lưu dữ liệu vào PostgreSQL.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!jobData?.job_id) return;
    try {
      await adminApi.downloadImportReport(jobData.job_id);
    } catch (err) {
      setErrorMessage(err.message || 'Lỗi khi tải file báo cáo Excel.');
    }
  };

  // ============================================================================
  // RENDER GIAO DIỆN TỪNG BƯỚC
  // ============================================================================
  return (
    <div className="msvt-import-overlay" onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="msvt-import-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="msvt-import-header">
          <div className="msvt-import-title-group">
            <div className="msvt-import-icon-badge">📤</div>
            <div>
              <h2 className="msvt-import-title">Nhập nhanh Vùng trồng từ Excel</h2>
              <p className="msvt-import-subtitle">
                Quy trình kiểm định và nạp dữ liệu MSVT an toàn vào PostgreSQL/PostGIS (EPSG:4326)
              </p>
            </div>
          </div>
          <button
            type="button"
            className="msvt-import-close-btn"
            onClick={onClose}
            disabled={loading}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {/* Stepper Progress Indicator */}
        <div className="msvt-stepper">
          {[
            { num: 1, label: '1. Tải tệp' },
            { num: 2, label: '2. Ánh xạ cột' },
            { num: 3, label: '3. Kiểm định' },
            { num: 4, label: '4. Xem trước' },
            { num: 5, label: '5. Xác nhận' },
            { num: 6, label: '6. Báo cáo' }
          ].map(s => {
            const isActive = currentStep === s.num;
            const isCompleted = currentStep > s.num;
            return (
              <div
                key={s.num}
                className={`msvt-step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              >
                <div className="msvt-step-badge">{isCompleted ? '✓' : s.num}</div>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Thông báo lỗi chung nếu có */}
        {errorMessage && (
          <div style={{
            background: '#fee2e2',
            color: '#b91c1c',
            padding: '10px 24px',
            fontSize: '13px',
            fontWeight: '600',
            borderBottom: '1px solid #fca5a5',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Nội dung động theo từng bước */}
        <div className="msvt-import-body">
          {/* ---------------- BƯỚC 1: TẢI FILE ---------------- */}
          {currentStep === 1 && (
            <div className="msvt-upload-container">
              <div
                className={`msvt-dropzone ${isDragOver ? 'dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="msvt-dropzone-icon">📊</div>
                <div className="msvt-dropzone-title">Kéo thả tệp Excel vào đây hoặc nhấn để chọn tệp</div>
                <div className="msvt-dropzone-desc">
                  Hỗ trợ định dạng chuẩn <strong>.xlsx</strong>. Dung lượng tối đa 10 MB, hỗ trợ lên tới 5.000 dòng.
                </div>
                <button type="button" className="msvt-dropzone-btn" disabled={loading}>
                  {loading ? 'Đang tải lên...' : 'Chọn tệp từ máy tính'}
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".xlsx, .xlsm"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />
              </div>

              {/* Hướng dẫn quy chuẩn dữ liệu */}
              <div className="msvt-upload-guidelines">
                <div className="msvt-guide-title">
                  <span>💡</span>
                  <span>Quy chuẩn tệp Excel vùng trồng (MSVT)</span>
                </div>
                <ul className="msvt-guide-list">
                  <li><strong>Tiêu đề:</strong> Tự động nhận diện tiêu đề 1 tầng hoặc 2 tầng (Multi-level headers) và các ô gộp (Merged cells).</li>
                  <li><strong>Mã MSVT:</strong> Định danh vùng trồng bằng chuỗi ký tự (giữ nguyên số 0 đầu, dấu gạch nối, không biến thành số).</li>
                  <li><strong>Tọa độ GPS:</strong> Hỗ trợ độ thập phân (18.815368, 105.606360), Độ-Phút-Giây (19o01'21'', 105o33'21''), ký hiệu điểm Đ1..Đn.</li>
                  <li><strong>Tự động tạo hình:</strong> 1 điểm tạo Point, từ 3 điểm hợp lệ trở lên tự động khép kín tạo Polygon MultiPolygon.</li>
                  <li><strong>Chống trùng:</strong> Tự động phát hiện trùng lặp mã với cơ sở dữ liệu và bảo toàn nguyên vẹn 51 bản ghi hiện có.</li>
                </ul>
              </div>
            </div>
          )}

          {/* ---------------- BƯỚC 2: ÁNH XẠ CỘT ---------------- */}
          {currentStep === 2 && jobData && (
            <div className="msvt-mapping-container">
              <div className="msvt-mapping-config-bar">
                <div className="msvt-form-group">
                  <label>Chọn Sheet dữ liệu:</label>
                  <select
                    value={selectedSheet}
                    onChange={(e) => setSelectedSheet(e.target.value)}
                  >
                    {jobData.sheets.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div className="msvt-form-group">
                  <label>Dòng tiêu đề (Header):</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={headerRow}
                    onChange={(e) => setHeaderRow(e.target.value)}
                  />
                </div>

                <div className="msvt-form-group">
                  <label>Dòng bắt đầu dữ liệu:</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={dataStartRow}
                    onChange={(e) => setDataStartRow(e.target.value)}
                  />
                </div>

                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>
                    Tệp nguồn: <strong>{jobData.filename}</strong> ({jobData.columns.length} cột phát hiện)
                  </span>
                </div>
              </div>

              {/* Bảng ánh xạ từng trường */}
              <div className="msvt-mapping-table-wrap">
                <table className="msvt-mapping-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>STT</th>
                      <th style={{ width: '220px' }}>Trường trong Database (PostgreSQL)</th>
                      <th style={{ width: '260px' }}>Mô tả & Định dạng</th>
                      <th>Cột Excel tương ứng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TARGET_FIELDS.map((tf, idx) => (
                      <tr key={tf.key}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{tf.label}</strong>
                          {tf.required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
                          <div><span className="msvt-field-tag">{tf.key}</span></div>
                        </td>
                        <td style={{ color: '#64748b' }}>{tf.desc}</td>
                        <td>
                          <select
                            style={{ width: '100%', maxWidth: '360px' }}
                            value={columnMapping[tf.key] || ''}
                            onChange={(e) => handleMappingChange(tf.key, e.target.value)}
                          >
                            <option value="">-- Bỏ qua không ánh xạ --</option>
                            {jobData.columns.map(col => (
                              <option key={col.col_index} value={col.col_index}>
                                Cột {col.col_letter} ({col.col_index}): {col.header_text}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---------------- BƯỚC 3: DRY RUN LOADING ---------------- */}
          {currentStep === 3 && (
            <div className="msvt-loading-box">
              <div className="msvt-spinner" />
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b' }}>
                Đang thực hiện kiểm định toàn diện (DRY RUN)...
              </div>
              <div style={{ fontSize: '13px', color: '#64748b', maxWidth: '420px', lineHeight: '1.5' }}>
                Hệ thống đang đối chiếu trùng lặp mã MSVT với 51 bản ghi hiện hữu, chuẩn hóa tọa độ GPS WGS84,
                kiểm tra tự giao cắt ranh giới Polygon và tính diện tích GIS.
              </div>
            </div>
          )}

          {/* ---------------- BƯỚC 4: XEM TRƯỚC (PREVIEW) ---------------- */}
          {currentStep === 4 && previewSummary && (
            <div className="msvt-preview-container">
              {/* KPI Summary Cards */}
              <div className="msvt-kpi-grid">
                <div className="msvt-kpi-card green">
                  <span className="msvt-kpi-label">Hợp lệ</span>
                  <span className="msvt-kpi-value">{previewSummary.valid_count}</span>
                  <span className="msvt-kpi-sub">Sẵn sàng nhập dữ liệu</span>
                </div>
                <div className="msvt-kpi-card amber">
                  <span className="msvt-kpi-label">Cảnh báo</span>
                  <span className="msvt-kpi-value">{previewSummary.warning_count}</span>
                  <span className="msvt-kpi-sub">Lệch diện tích / Tọa độ</span>
                </div>
                <div className="msvt-kpi-card blue">
                  <span className="msvt-kpi-label">Trùng lặp</span>
                  <span className="msvt-kpi-value">{previewSummary.duplicate_count}</span>
                  <span className="msvt-kpi-sub">Tự động bỏ qua (skip)</span>
                </div>
                <div className="msvt-kpi-card red">
                  <span className="msvt-kpi-label">Lỗi</span>
                  <span className="msvt-kpi-value">{previewSummary.error_count}</span>
                  <span className="msvt-kpi-sub">Không thể nhập</span>
                </div>
                <div className="msvt-kpi-card indigo">
                  <span className="msvt-kpi-label">Được chọn nhập</span>
                  <span className="msvt-kpi-value">{selectedRowIds.size}</span>
                  <span className="msvt-kpi-sub">Tổng: ~{selectedStats.totalArea} ha</span>
                </div>
              </div>

              {/* Filter Tabs & Search */}
              <div className="msvt-filter-bar">
                <div className="msvt-filter-tabs">
                  {[
                    { id: 'ALL', label: `Tất cả (${previewSummary.total_rows})`, cls: '' },
                    { id: 'VALID', label: `Hợp lệ (${previewSummary.valid_count})`, cls: 'green' },
                    { id: 'WARNING', label: `Cảnh báo (${previewSummary.warning_count})`, cls: 'amber' },
                    { id: 'DUPLICATE', label: `Trùng mã (${previewSummary.duplicate_count})`, cls: 'blue' },
                    { id: 'INVALID', label: `Lỗi (${previewSummary.error_count})`, cls: 'red' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`msvt-filter-btn ${tab.cls} ${statusFilter === tab.id ? 'active' : ''}`}
                      onClick={() => handleFilterChange(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button type="button" className="msvt-btn-map-preview" onClick={selectAllEligible}>
                    ✓ Chọn tất cả
                  </button>
                  <button type="button" className="msvt-btn-map-preview" onClick={deselectAll}>
                    ✕ Bỏ chọn
                  </button>
                  <input
                    type="text"
                    className="msvt-search-input"
                    placeholder="🔍 Tìm mã MSVT, tên cơ sở..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                  />
                </div>
              </div>

              {/* Preview Table */}
              <div className="msvt-preview-table-wrap">
                <table className="msvt-preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: '36px' }}>Chọn</th>
                      <th style={{ width: '40px' }}>Dòng</th>
                      <th style={{ width: '70px' }}>Phân loại</th>
                      <th>Mã MSVT mới</th>
                      <th>Mã MSVT cũ</th>
                      <th>Tổ chức / Cá nhân</th>
                      <th>Loại cây</th>
                      <th style={{ textAlign: 'right' }}>Diện tích (ha)</th>
                      <th>Hình học</th>
                      <th>Trạng thái & Ghi chú</th>
                      <th style={{ textAlign: 'center', width: '90px' }}>Bản đồ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length === 0 ? (
                      <tr>
                        <td colSpan="11" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                          Không có dòng dữ liệu nào khớp với bộ lọc hiện tại.
                        </td>
                      </tr>
                    ) : (
                      previewRows.map(row => {
                        const isSelected = selectedRowIds.has(row.row_id);
                        const isInvalid = row.status === 'INVALID';
                        return (
                          <tr
                            key={row.row_id}
                            className={isSelected ? 'selected' : ''}
                            style={{ opacity: isInvalid ? 0.6 : 1 }}
                          >
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isInvalid}
                                onChange={() => toggleRowSelection(row.row_id)}
                              />
                            </td>
                            <td>{row.excel_row}</td>
                            <td>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>{row.section || 'Nội địa'}</span>
                            </td>
                            <td><strong>{row.msvt_moi || '---'}</strong></td>
                            <td style={{ color: '#475569' }}>{row.msvt_cu || '---'}</td>
                            <td>{row.to_chuc_ca_nhan || '---'}</td>
                            <td>{row.loai_cay_trong || '---'}</td>
                            <td style={{ textAlign: 'right', fontWeight: '600' }}>
                              {row.dien_tich_ha !== null ? row.dien_tich_ha : '---'}
                            </td>
                            <td>
                              <span style={{
                                fontSize: '11.5px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                color: '#334155',
                                fontWeight: '600'
                              }}>
                                {row.geom_type === 'POINT' && '📍 Point'}
                                {row.geom_type === 'POLYGON' && '🔷 Polygon'}
                                {row.geom_type === 'INSUFFICIENT' && '📏 2 điểm'}
                                {row.geom_type === 'MULTI_GROUP' && '🔲 Đa nhóm'}
                                {row.geom_type === 'MISSING' && '⚪ Trống'}
                                {row.geom_type === 'INVALID' && '⚠️ Lỗi'}
                              </span>
                            </td>
                            <td>
                              {row.status === 'VALID' && <span className="msvt-badge valid">✅ Hợp lệ</span>}
                              {row.status === 'WARNING' && <span className="msvt-badge warning">⚠️ Cảnh báo</span>}
                              {row.status === 'DUPLICATE' && <span className="msvt-badge duplicate">🔄 Trùng mã</span>}
                              {row.status === 'INVALID' && <span className="msvt-badge invalid">❌ Lỗi</span>}

                              {/* Hiển thị chi tiết lỗi / cảnh báo */}
                              {row.issues && row.issues.length > 0 && (
                                <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '2px' }}>
                                  {row.issues.join('; ')}
                                </div>
                              )}
                              {row.warnings && row.warnings.length > 0 && (
                                <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px' }}>
                                  {row.warnings.join('; ')}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {row.geojson ? (
                                <button
                                  type="button"
                                  className="msvt-btn-map-preview"
                                  onClick={() => setActiveMapRow(row)}
                                >
                                  🗺️ Xem
                                </button>
                              ) : (
                                <span style={{ color: '#cbd5e1', fontSize: '12px' }}>---</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#64748b' }}>
                <span>Hiển thị trang <strong>{page} / {totalPages}</strong></span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="msvt-btn-map-preview"
                    disabled={page <= 1}
                    onClick={() => fetchPreviewPage(page - 1)}
                  >
                    ◀ Trang trước
                  </button>
                  <button
                    type="button"
                    className="msvt-btn-map-preview"
                    disabled={page >= totalPages}
                    onClick={() => fetchPreviewPage(page + 1)}
                  >
                    Trang sau ▶
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- BƯỚC 5: XÁC NHẬN NHẬP (COMMIT) ---------------- */}
          {currentStep === 5 && (
            <div className="msvt-commit-summary-box">
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '36px' }}>🛡️</span>
                <h3 style={{ margin: '8px 0 0 0', fontSize: '18px', fontWeight: '800', color: '#1e293b' }}>
                  Xác nhận nạp dữ liệu Vùng trồng vào Database
                </h3>
              </div>

              <div className="msvt-security-box">
                <strong>Chế độ Thêm mới An toàn:</strong> Toàn bộ 51 bản ghi hiện có được bảo toàn tuyệt đối 100%.
                Hệ thống chỉ thực hiện <code>INSERT</code> các bản ghi mới được lựa chọn, tuyệt đối không chạy <code>UPDATE</code>,
                không ghi đè ranh giới hình học và tự động bỏ qua toàn bộ các bản ghi trùng lặp mã.
              </div>

              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px 16px', border: '1px solid #e2e8f0' }}>
                <div className="msvt-commit-stat-row">
                  <span>Số bản ghi được chọn nạp mới:</span>
                  <strong style={{ color: '#16a34a' }}>{selectedRowIds.size} vùng trồng</strong>
                </div>
                <div className="msvt-commit-stat-row">
                  <span>Số bản ghi bỏ qua do trùng mã:</span>
                  <strong style={{ color: '#2563eb' }}>{previewSummary?.duplicate_count || 0} bản ghi</strong>
                </div>
                <div className="msvt-commit-stat-row">
                  <span>Số bản ghi lỗi bị loại trừ:</span>
                  <strong style={{ color: '#dc2626' }}>{previewSummary?.error_count || 0} bản ghi</strong>
                </div>
                <div className="msvt-commit-stat-row" style={{ borderBottom: 'none' }}>
                  <span>Tổng diện tích dự kiến bổ sung:</span>
                  <strong style={{ color: '#1e293b' }}>~{selectedStats.totalArea} ha</strong>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ marginTop: '3px' }}
                  checked={confirmWarnings}
                  onChange={(e) => setConfirmWarnings(e.target.checked)}
                />
                <span>
                  Chấp thuận nạp các bản ghi có cảnh báo tọa độ (lưu Geometry = NULL và bảo toàn nguyên vẹn tọa độ gốc).
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#1e293b', fontWeight: '600', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ marginTop: '3px' }}
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                />
                <span>
                  Tôi đã rà soát kỹ bảng kiểm định và chịu trách nhiệm xác nhận nhập dữ liệu vào hệ thống WebGIS.
                </span>
              </label>
            </div>
          )}

          {/* ---------------- BƯỚC 6: BÁO CÁO KẾT QUẢ ---------------- */}
          {currentStep === 6 && commitResult && (
            <div className="msvt-result-box">
              <div className="msvt-result-icon">✓</div>
              <h3 className="msvt-result-title">Nhập dữ liệu hoàn tất thành công!</h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#475569', maxWidth: '520px', lineHeight: '1.6' }}>
                Đã thêm <strong>{commitResult.inserted_count}</strong> vùng trồng mới vào cơ sở dữ liệu PostgreSQL.
                {commitResult.skipped_count > 0 && ` Đã tự động bỏ qua ${commitResult.skipped_count} bản ghi trùng mã.`}
                {commitResult.total_area_added_ha > 0 && ` Tổng diện tích canh tác bổ sung: ~${commitResult.total_area_added_ha} ha.`}
              </p>

              <div className="msvt-result-actions">
                <button
                  type="button"
                  className="msvt-btn msvt-btn-primary"
                  onClick={handleDownloadReport}
                >
                  📊 Xuất báo cáo kiểm định Excel (.xlsx)
                </button>
                <button
                  type="button"
                  className="msvt-btn msvt-btn-success"
                  onClick={onClose}
                >
                  🗺️ Trở về Bản đồ & Cập nhật Dashboard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="msvt-import-footer">
          <div>
            {currentStep > 1 && currentStep < 6 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-secondary"
                disabled={loading}
                onClick={() => {
                  if (currentStep === 4) setCurrentStep(2);
                  else if (currentStep === 5) setCurrentStep(4);
                  else setCurrentStep(prev => prev - 1);
                }}
              >
                ◀ Quay lại
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {currentStep === 1 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-secondary"
                onClick={onClose}
              >
                Hủy bỏ
              </button>
            )}

            {currentStep === 2 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-primary"
                disabled={loading}
                onClick={handleStartDryRun}
              >
                🔍 Chạy kiểm định dữ liệu (DRY RUN) ▶
              </button>
            )}

            {currentStep === 4 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-primary"
                disabled={selectedRowIds.size === 0}
                onClick={() => setCurrentStep(5)}
              >
                Tiếp tục xác nhận ({selectedRowIds.size} bản ghi) ▶
              </button>
            )}

            {currentStep === 5 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-success"
                disabled={loading || !agreeTerms || selectedRowIds.size === 0}
                onClick={handleCommitImport}
              >
                {loading ? 'Đang ghi vào PostgreSQL...' : '🚀 XÁC NHẬN NHẬP DỮ LIỆU'}
              </button>
            )}

            {currentStep === 6 && (
              <button
                type="button"
                className="msvt-btn msvt-btn-secondary"
                onClick={onClose}
              >
                Đóng
              </button>
            )}
          </div>
        </div>

        {/* Popup / Drawer xem trước hình học trên Leaflet */}
        {activeMapRow && (
          <div className="msvt-map-drawer-overlay" onClick={() => setActiveMapRow(null)}>
            <div className="msvt-map-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="msvt-map-drawer-header">
                <div>
                  <strong>Xem trước hình học: {activeMapRow.msvt_moi || activeMapRow.msvt_cu}</strong>
                  <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
                    {activeMapRow.to_chuc_ca_nhan} (Hồ sơ: {activeMapRow.dien_tich_ha} ha)
                  </span>
                </div>
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', fontSize: '16px' }}
                  onClick={() => setActiveMapRow(null)}
                >
                  ✕
                </button>
              </div>

              <div className="msvt-map-drawer-content">
                <MapContainer
                  center={[19.0, 105.5]}
                  zoom={12}
                  style={{ width: '100%', height: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap"
                  />
                  <MapBoundsFitter geojson={activeMapRow.geojson} />

                  {activeMapRow.geojson?.type === 'Point' && (
                    <Marker position={[activeMapRow.geojson.coordinates[1], activeMapRow.geojson.coordinates[0]]}>
                      <Tooltip permanent>
                        📍 {activeMapRow.msvt_moi} ({activeMapRow.to_chuc_ca_nhan})
                      </Tooltip>
                    </Marker>
                  )}

                  {activeMapRow.geojson?.type === 'MultiPolygon' && (
                    <Polygon
                      positions={activeMapRow.geojson.coordinates[0][0].map(([lng, lat]) => [lat, lng])}
                      pathOptions={{ color: '#16a34a', fillColor: '#22c55e', fillOpacity: 0.35, weight: 2.5 }}
                    >
                      <Tooltip permanent>
                        🔷 {activeMapRow.msvt_moi}<br />
                        GIS: ~{activeMapRow.area_gis_ha} ha | Hồ sơ: {activeMapRow.dien_tich_ha} ha
                      </Tooltip>
                    </Polygon>
                  )}
                </MapContainer>
              </div>

              <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: '12px', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                <span>Kiểu hình học: <strong>{activeMapRow.geom_type}</strong></span>
                {activeMapRow.area_diff_pct !== null && (
                  <span>Chênh lệch diện tích: <strong>{activeMapRow.area_diff_pct}%</strong></span>
                )}
                <span>Trạng thái: <strong>{activeMapRow.status_label}</strong></span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

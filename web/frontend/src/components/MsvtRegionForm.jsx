import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Marker,
  Tooltip,
  useMap,
  useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import adminApi from '../services/adminApi';
import {
  parseCoordinatesBatch,
  formatCoordinatesToText,
  validateVertices,
  generateSimulationCandidates,
  evaluateAreaDeviation,
  analyzeConvexHullVsDeclared,
  computeSegmentCorridorMetric,
  combineMultiPolygonGeoJSON
} from '../utils/geometryUtils';
import './MsvtRegionForm.css';

// Bảng màu nhận diện riêng biệt cho các nhóm ranh giới độc lập (Section VIII đề bài)
const GROUP_COLORS = [
  { border: '#9333ea', fill: '#a855f7', name: 'Tím', bg: '#f3e8ff', text: '#6b21a8' }, // Nhóm 1
  { border: '#d97706', fill: '#f59e0b', name: 'Cam', bg: '#fef3c7', text: '#92400e' }, // Nhóm 2
  { border: '#059669', fill: '#10b981', name: 'Xanh ngọc', bg: '#d1fae5', text: '#065f46' }, // Nhóm 3
  { border: '#0891b2', fill: '#06b6d4', name: 'Lam', bg: '#cffafe', text: '#155e75' }, // Nhóm 4
  { border: '#db2777', fill: '#ec4899', name: 'Hồng', bg: '#fce7f3', text: '#9d174d' }, // Nhóm 5
  { border: '#4f46e5', fill: '#6366f1', name: 'Chàm', bg: '#e0e7ff', text: '#3730a3' }  // Nhóm 6
];


// Tạo icon đánh số đỉnh 1, 2, 3... bằng DivIcon thuần CSS
const createNumberedIcon = (number, color = '#ea580c') => {
  return L.divIcon({
    className: 'msvt-numbered-marker',
    html: `<div style="
      background-color: ${color};
      color: #ffffff;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 11px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.35);
      border: 2px solid #ffffff;
      cursor: pointer;
    ">${number}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Component điều khiển tự động phóng vừa góc nhìn (fitBounds)
const FitBoundsHelper = ({ bounds, triggerKey }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid && bounds.isValid()) {
      try {
        map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
      } catch {
        // Bỏ qua nếu lỗi tính toán bounding box
      }
    }
  }, [bounds, triggerKey, map]);
  return null;
};

// Tự động sửa kích thước bản đồ khi mở modal hoặc thay đổi màn hình
const MapResizer = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        map.invalidateSize({ animate: false });
      } catch {}
    }, 200);

    const handleResize = () => {
      try {
        map.invalidateSize({ animate: false });
      } catch {}
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [map]);
  return null;
};

// Bộ lắng nghe click chuột trên bản đồ xem trước để lấy tọa độ
const MapClickListener = ({ onMapClick }) => {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6))
        });
      }
    }
  });
  return null;
};

const MsvtRegionForm = ({
  isOpen,
  region = null, // null = Thêm mới, object = Sửa
  clickedCoord = null, // Tọa độ người dùng vừa click trên MapViewer
  onClose,
  onSuccess
}) => {
  const isEdit = Boolean(region && region.id);

  // Form State
  const [formData, setFormData] = useState({
    msvt_moi: '',
    msvt_cu: '',
    to_chuc_ca_nhan: '',
    nguoi_dai_dien: '',
    so_dien_thoai: '',
    email: '',
    toa_do_goc: '',
    dia_chi_msvt: '',
    loai_cay_trong: '',
    so_ho_tham_gia: '',
    dien_tich_ha: '',
    tong_san_luong_tan: '',
    san_luong_tan_ha: '',
    quy_trinh: '',
    thi_truong: ''
  });

  // Chế độ hình học khi Sửa:
  // 'keep' = Giữ nguyên hình học cũ (Mặc định)
  // 'update_point' = Cập nhật Điểm đại diện (Point)
  // 'update_polygon' = Thay thế ranh giới Polygon mới
  // 'clear' = Xóa bỏ hình học không gian (sau khi xác nhận)
  const [editGeomMode, setEditGeomMode] = useState('keep');

  // Chế độ nhận diện tọa độ: 'auto' (Tự động) | 'decimal' (Thập phân) | 'dms' (Độ-phút-giây)
  const [coordMode, setCoordMode] = useState('auto');

  // Quản lý văn bản tọa độ & danh sách đỉnh
  const [coordInputText, setCoordInputText] = useState('');
  const [vertices, setVertices] = useState([]); // [{ id, lat, lng, raw, format, lineNum, isDuplicate, duplicateOf, isEdited }]
  const [originalVertices, setOriginalVertices] = useState([]); // Tọa độ GPS nguồn ban đầu
  const [oldGeometry, setOldGeometry] = useState(null); // GeoJSON cũ nếu có
  const [hasConfirmedBoundary, setHasConfirmedBoundary] = useState(false);
  const [activeCoordTab, setActiveCoordTab] = useState('paste'); // 'paste' | 'table'

  // Bản nháp chỉnh sửa & Stack Hoàn tác (Undo / Redo) (Section VI)
  const [isDraft, setIsDraft] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Đề xuất các phương án mô phỏng (Section IV)
  const [showCandidatesDrawer, setShowCandidatesDrawer] = useState(false);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(null);

  // Bật/tắt mô phỏng đường bao Convex Hull
  const [showSimulationHull, setShowSimulationHull] = useState(false);

  // Quản lý 2 điểm GPS (Section IV/V/VII):
  // 'line' = Xem đoạn thẳng nối hai điểm (Mặc định)
  // 'buffer' = Mô phỏng vùng đệm địa lý (theo mét)
  // 'corridor' = Mô phỏng dải vùng theo diện tích hồ sơ
  // 'bbox' = Mô phỏng hình chữ nhật từ hai góc đối diện
  const [twoPointsMode, setTwoPointsMode] = useState('line');
  const [bufferMeters, setBufferMeters] = useState(20);
  const [corridorWidthMeters, setCorridorWidthMeters] = useState(null);
  const [bboxConfirmed, setBboxConfirmed] = useState(false);

  // Quản lý nhiều nhóm ranh giới trong cùng 1 ô / danh sách (Section V & VI đề bài):
  // 'unconfirmed': Chưa xác định quan hệ (chỉ xem trên bản đồ, không ghi geometry chính thức)
  // 'same_msvt': Các nhóm thuộc cùng một MSVT (kết hợp MultiPolygon sau khi xác nhận)
  // 'independent_msvt': Mỗi nhóm thuộc một MSVT độc lập (chỉ lưu thuộc tính)
  const [multiGroupMode, setMultiGroupMode] = useState('unconfirmed');
  const [selectedGroupTab, setSelectedGroupTab] = useState('all'); // 'all' | 1 | 2 | 3 | 4...
  const [customGroupNames, setCustomGroupNames] = useState({});
  const [checkedGroups, setCheckedGroups] = useState({});

  // Modal / xem tọa độ gốc
  const [showRawCoordsModal, setShowRawCoordsModal] = useState(false);

  // Trigger fitBounds
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successInfo, setSuccessInfo] = useState('');
  const [duplicateField, setDuplicateField] = useState(null); // 'msvt_moi' | 'msvt_cu' | null
  const [duplicateInfo, setDuplicateInfo] = useState(null); // { code, id }
  const [postgisValidation, setPostgisValidation] = useState(null);
  const [isValidatingPostGIS, setIsValidatingPostGIS] = useState(false);
  const previewMapRef = useRef(null);

  // Phân tích batch tọa độ hiện tại
  const parsedBatch = useMemo(() => {
    return parseCoordinatesBatch(coordInputText, coordMode);
  }, [coordInputText, coordMode]);

  // Kiểm định danh sách đỉnh hiện tại kèm tùy chọn cho 2 điểm và đối chiếu diện tích hồ sơ
  const validationResult = useMemo(() => {
    const declArea = formData.dien_tich_ha && !isNaN(formData.dien_tich_ha)
      ? parseFloat(formData.dien_tich_ha)
      : null;
    return validateVertices(vertices, {
      declaredAreaHa: declArea,
      twoPointsMode,
      bufferMeters,
      corridorWidthMeters,
      bboxConfirmed
    });
  }, [vertices, formData.dien_tich_ha, twoPointsMode, bufferMeters, corridorWidthMeters, bboxConfirmed]);

  // Trạng thái validation thống nhất của hệ thống (Section IV)
  const unifiedValidationStatus = useMemo(() => {
    if (loading) return { state: 'saving', label: 'Đang lưu...', message: 'Hệ thống đang xử lý và lưu trữ dữ liệu vào PostGIS...', canSubmit: false };

    // Trường hợp SỬA và GIỮ NGUYÊN hình học cũ (editGeomMode === 'keep')
    if (isEdit && editGeomMode === 'keep') {
      if (!oldGeometry) {
        return {
          state: 'invalid',
          label: 'Chưa có hình học',
          message: 'Vùng trồng này hiện chưa có dữ liệu không gian. Chế độ kiểm soát nghiêm ngặt bắt buộc bạn phải bổ sung tọa độ Point hoặc Polygon hợp lệ và xác nhận trước khi lưu.',
          canSubmit: false
        };
      }
      return {
        state: 'valid_confirmed',
        label: 'Giữ nguyên ranh giới',
        message: 'Ranh giới không gian cũ được bảo toàn nguyên vẹn 100%. Sẵn sàng lưu cập nhật thông tin thuộc tính.',
        canSubmit: true
      };
    }

    // Nếu không có đỉnh nào
    if (!vertices || vertices.length === 0) {
      return {
        state: 'empty',
        label: 'Chưa có tọa độ',
        message: 'Vui lòng nhập tọa độ GPS (Decimal hoặc DMS) hoặc click trên bản đồ để thêm đỉnh ranh giới.',
        canSubmit: false
      };
    }

    // Nếu có 2 điểm GPS (Section III.1 & VII)
    if (vertices.length === 2) {
      return {
        state: 'invalid',
        label: 'Không đủ đỉnh tạo Polygon',
        message: 'Không thể lưu: Dữ liệu chỉ có 2 điểm GPS. Bắt buộc có tối thiểu 3 đỉnh phân biệt để tạo Polygon hoặc đúng 1 điểm để tạo Point mốc.',
        canSubmit: false
      };
    }

    // Đa nhóm (Multi-group)
    if (parsedBatch.isMultiGroup) {
      if (multiGroupMode !== 'same_msvt') {
        return {
          state: 'invalid',
          label: 'Chưa xác nhận cấu trúc nhóm',
          message: 'Dữ liệu chứa nhiều nhóm tọa độ. Ở chế độ nghiêm ngặt, bạn cần chọn "Các nhóm thuộc cùng một MSVT (Tạo MultiPolygon)" và xác nhận các nhóm hợp lệ để lưu.',
          canSubmit: false
        };
      }
      if (!parsedBatch.allGroupsValid) {
        const invalidGroups = parsedBatch.groups.filter(g => !g.isValid).map(g => `${g.name} (${g.reason})`).join('; ');
        return {
          state: 'invalid',
          label: 'Nhóm tọa độ bị lỗi',
          message: `Không thể lưu MultiPolygon vì có nhóm ranh giới lỗi: ${invalidGroups}.`,
          canSubmit: false
        };
      }
      if (!hasConfirmedBoundary) {
        return {
          state: 'valid_unconfirmed',
          label: 'Chưa xác nhận MultiPolygon',
          message: 'Hình học các nhóm hợp lệ nhưng bạn chưa xác nhận. Vui lòng xem trước trên bản đồ và tích chọn xác nhận ranh giới để mở khóa nút lưu.',
          canSubmit: false
        };
      }
      return {
        state: 'valid_confirmed',
        label: 'MultiPolygon hợp lệ & Đã xác nhận',
        message: `Đã xác nhận ${parsedBatch.groups.length} phân vùng MultiPolygon hợp lệ. Sẵn sàng lưu trữ.`,
        canSubmit: true
      };
    }

    // 1 điểm Point (Section V đề bài)
    if (vertices.length === 1) {
      const p = vertices[0];
      if (isNaN(p.lat) || isNaN(p.lng) || p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
        return {
          state: 'invalid',
          label: 'Tọa độ Point sai phạm vi',
          message: `Tọa độ Point (${p.lat}, ${p.lng}) không hợp lệ (Vĩ độ phải thuộc [-90, 90], Kinh độ thuộc [-180, 180]).`,
          canSubmit: false
        };
      }
      return {
        state: 'valid_confirmed',
        label: 'Điểm vị trí vùng trồng (Point)',
        message: `Tọa độ điểm mốc hợp lệ: Vĩ độ (Lat) = ${p.lat.toFixed(6)}, Kinh độ (Lng) = ${p.lng.toFixed(6)}. Hệ quy chiếu WGS84 (EPSG:4326). Sẵn sàng lưu dữ liệu.`,
        canSubmit: true
      };
    }

    // >= 3 điểm (Polygon)
    if (vertices.length >= 3) {
      if (!validationResult.isValid) {
        return {
          state: 'invalid',
          label: 'Ranh giới không hợp lệ',
          message: validationResult.message || 'Polygon không hợp lệ (tự cắt hoặc trùng đỉnh bất thường).',
          canSubmit: false
        };
      }

      if (postgisValidation && !postgisValidation.is_valid) {
        return {
          state: 'invalid',
          label: 'PostGIS ST_IsValid thất bại',
          message: `PostGIS ST_IsValid: ${postgisValidation.reason}`,
          canSubmit: false
        };
      }

      if (!hasConfirmedBoundary) {
        return {
          state: 'valid_unconfirmed',
          label: 'Polygon hợp lệ - Chưa xác nhận',
          message: 'Hình học ranh giới hợp lệ về toán học. Vui lòng đối chiếu với dữ liệu thực tế trên bản đồ và tích chọn xác nhận trước khi lưu.',
          canSubmit: false
        };
      }

      // Có cảnh báo lệch diện tích hoặc ranh giới rất hẹp
      const hasQualityWarning = validationResult.areaEvaluation && validationResult.areaEvaluation.level === 'warning';
      if (hasQualityWarning || validationResult.isNarrow) {
        return {
          state: 'warning',
          label: 'Hợp lệ nhưng có cảnh báo',
          message: validationResult.areaEvaluation?.feedback || 'Hình học hợp lệ nhưng có chênh lệch diện tích đáng kể so với hồ sơ. Đã xác nhận.',
          canSubmit: true
        };
      }

      return {
        state: 'valid_confirmed',
        label: 'Polygon hợp lệ & Đã xác nhận',
        message: `Ranh giới hợp lệ (${validationResult.areaHa} ha). Đã xác nhận đối chiếu.`,
        canSubmit: true
      };
    }

    return {
      state: 'invalid',
      label: 'Dữ liệu không hợp lệ',
      message: 'Tọa độ không hợp lệ.',
      canSubmit: false
    };
  }, [loading, isEdit, editGeomMode, oldGeometry, vertices, parsedBatch, multiGroupMode, hasConfirmedBoundary, validationResult, postgisValidation]);

  // Bảng dữ liệu 8 tiêu chí kiểm định (Section XII)
  const checklistData = useMemo(() => {
    // 1. Định dạng tọa độ
    const formatStatus = (vertices.length > 0 && (!parsedBatch.stats || parsedBatch.stats.errorCount === 0))
      ? { pass: true, text: parsedBatch.stats?.overallFormat || 'Hợp lệ' }
      : (vertices.length === 0 ? { pass: null, text: 'Chưa có dữ liệu' } : { pass: false, text: `${parsedBatch.stats?.errorCount || 1} lỗi định dạng` });

    // 2. Số đỉnh
    let vertexStatus = { pass: false, text: '0 điểm' };
    if (vertices.length === 1) {
      vertexStatus = { pass: true, text: '1 điểm (Điểm vị trí vùng trồng Point)' };
    } else if (vertices.length === 2) {
      vertexStatus = { pass: false, text: '2 điểm (Cần tối thiểu 3 đỉnh phân biệt để tạo Polygon hoặc 1 điểm cho Point)' };
    } else if (vertices.length >= 3) {
      vertexStatus = { pass: true, text: `${vertices.length} đỉnh (Đạt yêu cầu ≥ 3)` };
    }

    // 3. Điểm trùng
    const hasDup = validationResult.type === 'DUPLICATE_POINTS' || (parsedBatch.stats && parsedBatch.stats.duplicateCount > 0);
    const duplicateStatus = hasDup
      ? { pass: false, text: 'Có đỉnh trùng lặp bất thường' }
      : { pass: true, text: 'Không có đỉnh trùng' };

    // 4. Self-intersection
    const selfIntersects = validationResult.isSelfIntersecting || (validationResult.edge1 && validationResult.edge2);
    const selfIntersectStatus = selfIntersects
      ? { pass: false, text: `Tự giao cắt (Cạnh ${validationResult.edge1?.[0]}-${validationResult.edge1?.[1]} & ${validationResult.edge2?.[0]}-${validationResult.edge2?.[1]})` }
      : { pass: true, text: 'Không tự giao cắt' };

    // 5. ST_IsValid
    let isValidStatus = { pass: null, text: 'Chưa kiểm định' };
    if (vertices.length === 1) {
      isValidStatus = { pass: true, text: 'True (Point EPSG:4326 hợp lệ)' };
    } else if (postgisValidation) {
      isValidStatus = postgisValidation.is_valid
        ? { pass: true, text: 'True (PostGIS Hợp lệ)' }
        : { pass: false, text: `False (${postgisValidation.reason})` };
    } else if (vertices.length >= 3) {
      isValidStatus = validationResult.isValid
        ? { pass: true, text: 'True (Topology chuẩn)' }
        : { pass: false, text: `False (${validationResult.message})` };
    }

    // 6. Diện tích hình học
    let areaText = '0.00 ha';
    if (vertices.length === 1) {
      areaText = '0 ha (Hình học dạng Điểm - Point)';
    } else if (postgisValidation && postgisValidation.area_ha !== null && postgisValidation.area_ha !== undefined) {
      areaText = `${postgisValidation.area_ha} ha`;
    } else if (validationResult.areaHa !== null && validationResult.areaHa !== undefined) {
      areaText = `${validationResult.areaHa} ha`;
    }

    // 7. Sai lệch diện tích
    let devText = 'Chưa có hồ sơ';
    let devPass = true;
    if (vertices.length === 1) {
      devText = 'Không áp dụng cho Point';
      devPass = true;
    } else if (postgisValidation && postgisValidation.deviation_pct !== null && postgisValidation.deviation_pct !== undefined) {
      devText = `${postgisValidation.deviation_pct}% (${postgisValidation.label})`;
      if (postgisValidation.rating === 'WARNING') devPass = false;
    } else if (validationResult.areaEvaluation && validationResult.areaEvaluation.deviationPct !== null && validationResult.areaEvaluation.deviationPct !== undefined) {
      devText = `${validationResult.areaEvaluation.deviationPct}% (${validationResult.areaEvaluation.label})`;
      if (validationResult.areaEvaluation.level === 'warning') devPass = false;
    }

    // 8. Xác nhận ranh giới
    const confirmStatus = vertices.length === 1
      ? { pass: true, text: 'Tự động xác nhận (Điểm vị trí Point)' }
      : (hasConfirmedBoundary
        ? { pass: true, text: 'Đã xác nhận ranh giới' }
        : { pass: false, text: 'Chưa xác nhận' });

    return [
      { id: 1, name: '1. Định dạng tọa độ', ...formatStatus },
      { id: 2, name: '2. Số đỉnh', ...vertexStatus },
      { id: 3, name: '3. Điểm trùng', ...duplicateStatus },
      { id: 4, name: '4. Self-intersection', ...selfIntersectStatus },
      { id: 5, name: '5. ST_IsValid', ...isValidStatus },
      { id: 6, name: '6. Diện tích hình học', pass: true, text: areaText },
      { id: 7, name: '7. Sai lệch diện tích', pass: devPass, text: devText },
      { id: 8, name: '8. Xác nhận ranh giới', ...confirmStatus },
    ];
  }, [vertices, parsedBatch, validationResult, postgisValidation, hasConfirmedBoundary]);

  // Khởi tạo và điền dữ liệu khi mở form
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage('');
    setSuccessInfo('');
    setHasConfirmedBoundary(false);
    setPostgisValidation(null);
    setShowSimulationHull(false);
    setShowRawCoordsModal(false);
    setTwoPointsMode('line');
    setBufferMeters(20);
    setBboxConfirmed(false);
    setMultiGroupMode('unconfirmed');
    setSelectedGroupTab('all');
    setCustomGroupNames({});
    setCheckedGroups({});


    if (isEdit && region) {
      setFormData({
        msvt_moi: region.msvt_moi ?? '',
        msvt_cu: region.msvt_cu ?? '',
        to_chuc_ca_nhan: region.to_chuc_ca_nhan ?? '',
        nguoi_dai_dien: region.nguoi_dai_dien ?? '',
        so_dien_thoai: region.so_dien_thoai ?? '',
        email: region.email ?? '',
        toa_do_goc: region.toa_do_goc ?? '',
        dia_chi_msvt: region.dia_chi_msvt ?? '',
        loai_cay_trong: region.loai_cay_trong ?? '',
        so_ho_tham_gia: region.so_ho_tham_gia !== null && region.so_ho_tham_gia !== undefined ? String(region.so_ho_tham_gia) : '',
        dien_tich_ha: region.dien_tich_ha !== null && region.dien_tich_ha !== undefined ? String(region.dien_tich_ha) : '',
        tong_san_luong_tan: region.tong_san_luong_tan !== null && region.tong_san_luong_tan !== undefined ? String(region.tong_san_luong_tan) : '',
        san_luong_tan_ha: region.san_luong_tan_ha !== null && region.san_luong_tan_ha !== undefined ? String(region.san_luong_tan_ha) : '',
        quy_trinh: region.quy_trinh ?? '',
        thi_truong: region.thi_truong ?? ''
      });

      setEditGeomMode('keep');

      // Tải hình học cũ nếu có
      const loadOldGeom = async () => {
        let geom = region.geometry;
        if (!geom && region.id) {
          try {
            const detail = await adminApi.getAdminRegionDetail(region.id);
            if (detail && detail.geometry) {
              geom = detail.geometry;
            }
          } catch (e) {
            console.warn('[MsvtRegionForm] Không tải được chi tiết geometry cũ:', e);
          }
        }

        const initCoords = (pts) => {
          setVertices(pts);
          setOriginalVertices(pts);
          setIsDraft(false);
          setHistory([pts]);
          setHistoryIndex(0);
          if (region.toa_do_goc && region.toa_do_goc.trim()) {
            setCoordInputText(region.toa_do_goc.trim());
          } else {
            setCoordInputText(formatCoordinatesToText(pts));
          }
        };

        if (geom) {
          setOldGeometry(geom);
          if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
            const [lng, lat] = geom.coordinates;
            const pts = [{ id: 1, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), format: 'Decimal' }];
            initCoords(pts);
          } else if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
            const ring = geom.coordinates[0] || [];
            const rawPts = (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
              ? ring.slice(0, ring.length - 1)
              : ring;
            const pts = rawPts.map((c, idx) => ({
              id: idx + 1,
              lat: Number(c[1].toFixed(6)),
              lng: Number(c[0].toFixed(6)),
              format: 'Decimal'
            }));
            initCoords(pts);
          } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
            const poly = geom.coordinates[0] || [];
            const ring = poly[0] || [];
            const rawPts = (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
              ? ring.slice(0, ring.length - 1)
              : ring;
            const pts = rawPts.map((c, idx) => ({
              id: idx + 1,
              lat: Number(c[1].toFixed(6)),
              lng: Number(c[0].toFixed(6)),
              format: 'Decimal'
            }));
            initCoords(pts);
          }
        } else {
          setOldGeometry(null);
          setEditGeomMode('update_polygon');
          if (region.toa_do_goc && region.toa_do_goc.trim()) {
            const rawText = region.toa_do_goc.trim();
            setCoordInputText(rawText);
            const batch = parseCoordinatesBatch(rawText, coordMode);
            setVertices(batch.vertices);
            setOriginalVertices(batch.vertices);
            setIsDraft(false);
            setHistory([batch.vertices]);
            setHistoryIndex(0);
          } else {
            setVertices([]);
            setOriginalVertices([]);
            setIsDraft(false);
            setHistory([[]]);
            setHistoryIndex(0);
            setCoordInputText('');
          }
        }
      };

      loadOldGeom();
    } else {
      // Thêm mới
      setFormData({
        msvt_moi: '',
        msvt_cu: '',
        to_chuc_ca_nhan: '',
        nguoi_dai_dien: '',
        so_dien_thoai: '',
        email: '',
        toa_do_goc: '',
        dia_chi_msvt: '',
        loai_cay_trong: '',
        so_ho_tham_gia: '',
        dien_tich_ha: '',
        tong_san_luong_tan: '',
        san_luong_tan_ha: '',
        quy_trinh: '',
        thi_truong: 'Trong nước'
      });
      setEditGeomMode('update_polygon');
      setOldGeometry(null);

      if (clickedCoord && clickedCoord.lat && clickedCoord.lng) {
        const pts = [{ id: 1, lat: Number(clickedCoord.lat.toFixed(6)), lng: Number(clickedCoord.lng.toFixed(6)), format: 'Decimal' }];
        setVertices(pts);
        setOriginalVertices(pts);
        setIsDraft(false);
        setHistory([pts]);
        setHistoryIndex(0);
        setCoordInputText(formatCoordinatesToText(pts));
      } else {
        setVertices([]);
        setOriginalVertices([]);
        setIsDraft(false);
        setHistory([[]]);
        setHistoryIndex(0);
        setCoordInputText('');
      }
    }
  }, [isOpen, isEdit, region, clickedCoord]);

  if (!isOpen) return null;

  // Quản lý Stack Hoàn tác (Undo / Redo) và Chế độ Bản nháp chỉnh sửa (Section VI)
  const pushHistory = (newVertices, markDraft = true) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(newVertices);
    if (nextHistory.length > 30) nextHistory.shift();
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setVertices(newVertices);
    setCoordInputText(formatCoordinatesToText(newVertices));
    if (markDraft) setIsDraft(true);
    setHasConfirmedBoundary(false);
    setPostgisValidation(null);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      const prev = history[newIdx];
      setVertices(prev);
      setCoordInputText(formatCoordinatesToText(prev));
      setHasConfirmedBoundary(false);
      setPostgisValidation(null);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      const next = history[newIdx];
      setVertices(next);
      setCoordInputText(formatCoordinatesToText(next));
      setHasConfirmedBoundary(false);
      setPostgisValidation(null);
    }
  };

  const handleRestoreOriginal = () => {
    if (!originalVertices || originalVertices.length === 0) {
      alert('Không có tọa độ GPS nguồn ban đầu để khôi phục.');
      return;
    }
    pushHistory(originalVertices, false);
    setIsDraft(false);
    setSuccessInfo('Đã khôi phục về danh sách tọa độ GPS nguồn ban đầu.');
    setFitBoundsTrigger(prev => prev + 1);
  };

  const handleApplyCandidate = (candidate, candIndex) => {
    setSelectedCandidateIndex(candIndex);
    pushHistory(candidate.vertices, true);
    setIsDraft(true);
    setShowCandidatesDrawer(false);
    setSuccessInfo(`Đã áp dụng phương án mô phỏng #${candIndex + 1} (${candidate.description}). Đang ở chế độ "Bản nháp chỉnh sửa" (chưa lưu vào CSDL).`);
    setFitBoundsTrigger(prev => prev + 1);
  };

  const handleMarkerDragEnd = (index, e) => {
    const latlng = e.target.getLatLng();
    const updated = vertices.map((v, idx) => {
      if (idx === index) {
        return {
          ...v,
          lat: Number(latlng.lat.toFixed(6)),
          lng: Number(latlng.lng.toFixed(6)),
          isEdited: true
        };
      }
      return v;
    });
    pushHistory(updated, true);
  };

  // Xử lý thay đổi thông tin thuộc tính
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (duplicateField === name) {
      setDuplicateField(null);
      setDuplicateInfo(null);
      setErrorMessage('');
    }
  };

  // Xử lý thay đổi chế độ nhận diện định dạng (Auto / Decimal / DMS)
  const handleCoordModeChange = (mode) => {
    setCoordMode(mode);
    const batch = parseCoordinatesBatch(coordInputText, mode);
    setVertices(batch.vertices);
    setOriginalVertices(batch.vertices);
    setIsDraft(false);
    setHistory([batch.vertices]);
    setHistoryIndex(0);
    setHasConfirmedBoundary(false);
    setPostgisValidation(null);
  };

  // Xử lý khi người dùng gõ hoặc dán vào ô Textarea
  const handleTextareaChange = (e) => {
    const text = e.target.value;
    setCoordInputText(text);
    const batch = parseCoordinatesBatch(text, coordMode);
    setVertices(batch.vertices);
    setOriginalVertices(batch.vertices);
    setIsDraft(false);
    setHistory([batch.vertices]);
    setHistoryIndex(0);
    setHasConfirmedBoundary(false);
    setPostgisValidation(null);

    // Tự động đồng bộ chế độ hình học nếu đang ở chế độ Sửa
    if (isEdit && editGeomMode !== 'keep') {
      if (batch.vertices.length === 1 && editGeomMode === 'update_polygon') {
        setEditGeomMode('update_point');
      } else if (batch.vertices.length >= 3 && editGeomMode === 'update_point') {
        setEditGeomMode('update_polygon');
      }
    }
  };

  // 4 Nút Thao tác Kiểm định (Section XII):
  // 1. Kiểm tra lại tọa độ (với kiểm định PostGIS)
  const handleRecheckGeometry = async () => {
    setIsValidatingPostGIS(true);
    setErrorMessage('');
    setSuccessInfo('');
    try {
      const batch = parseCoordinatesBatch(coordInputText, coordMode);
      setVertices(batch.vertices);
      const declArea = formData.dien_tich_ha && !isNaN(formData.dien_tich_ha)
        ? parseFloat(formData.dien_tich_ha)
        : null;

      if (batch.vertices.length >= 3) {
        const coords = batch.vertices.map(v => [v.lng, v.lat]);
        coords.push([batch.vertices[0].lng, batch.vertices[0].lat]);
        const geojson = { type: 'Polygon', coordinates: [coords] };
        const res = await adminApi.validateGeometry(geojson, declArea);
        setPostgisValidation(res);
        if (res.is_valid) {
          setSuccessInfo(`Kiểm tra thành công: PostGIS ST_IsValid = True, diện tích ${res.area_ha} ha`);
        } else {
          setErrorMessage(`Lỗi hình học PostGIS: ${res.reason || 'Polygon không hợp lệ'}`);
        }
      } else if (batch.vertices.length === 1) {
        setSuccessInfo('Tọa độ Point hợp lệ.');
        setPostgisValidation({ is_valid: true, geom_type: 'Point', area_ha: 0, reason: null });
      } else if (batch.vertices.length === 2) {
        setErrorMessage('Dữ liệu có 2 điểm GPS, cần tối thiểu 3 đỉnh phân biệt để tạo Polygon.');
        setPostgisValidation({ is_valid: false, geom_type: 'LineString', reason: 'Chỉ có 2 điểm, không đủ tạo Polygon' });
      } else {
        setPostgisValidation(null);
      }
      setFitBoundsTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Lỗi khi kiểm tra hình học với PostGIS:', err);
      setErrorMessage(err.message || 'Lỗi khi kiểm tra tọa độ.');
    } finally {
      setIsValidatingPostGIS(false);
    }
  };

  // 2. Chỉnh sửa đỉnh
  const handleEditVertices = () => {
    setActiveCoordTab('table');
    if (previewMapRef.current) {
      previewMapRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // 3. Khôi phục tọa độ gốc
  const handleRestoreOriginalCoords = () => {
    handleRestoreOriginal();
  };

  // 4. Xem lỗi hình học
  const handleViewGeometryError = () => {
    if (validationResult.isSelfIntersecting || (validationResult.edge1 && validationResult.edge2)) {
      setErrorMessage(`Đa giác bị tự giao cắt giữa cạnh ${validationResult.edge1?.[0]}-${validationResult.edge1?.[1]} và cạnh ${validationResult.edge2?.[0]}-${validationResult.edge2?.[1]}. Vui lòng di chuyển hoặc điều chỉnh đỉnh lỗi.`);
    } else if (postgisValidation && !postgisValidation.is_valid) {
      setErrorMessage(`Lỗi PostGIS ST_IsValid: ${postgisValidation.reason}`);
    } else if (vertices.length === 2) {
      setErrorMessage('Không thể lưu: Dữ liệu chỉ có 2 điểm GPS, cần tối thiểu 3 đỉnh phân biệt để tạo Polygon.');
    } else if (!validationResult.isValid) {
      setErrorMessage(validationResult.message || 'Polygon không hợp lệ.');
    } else {
      setSuccessInfo('Hình học hiện tại hoàn toàn hợp lệ, không phát hiện lỗi tự giao cắt.');
    }
    setShowSimulationHull(true);
    setFitBoundsTrigger(prev => prev + 1);
  };

  // Nút 1: Kiểm tra tọa độ (cũ)
  const handleCheckCoordinates = () => {
    handleRecheckGeometry();
  };

  // Nút 2: Xem tọa độ gốc
  const handleToggleRawCoords = () => {
    setShowRawCoordsModal(prev => !prev);
  };

  // Nút 3: Mô phỏng đường bao (Convex Hull)
  const handleToggleSimulation = () => {
    if (!validationResult.simulationHull || validationResult.simulationHull.length < 3) {
      alert('Cần ít nhất 3 điểm phân biệt không thẳng hàng để tạo đường bao lồi mô phỏng.');
      return;
    }
    const nextState = !showSimulationHull;
    setShowSimulationHull(nextState);
    if (nextState) {
      setFitBoundsTrigger(prev => prev + 1);
    }
  };

  // Nút 4: Chuyển sang chỉnh sửa thứ tự đỉnh (Table tab)
  const handleEditVerticesOrder = () => {
    setActiveCoordTab('table');
  };

  // Nút 5: Xem trước Polygon (focus bounds trên bản đồ)
  const handleFocusPreview = () => {
    setFitBoundsTrigger(prev => prev + 1);
    if (previewMapRef.current) {
      previewMapRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Thêm một đỉnh mới thủ công
  const handleAddVertex = () => {
    const newId = vertices.length > 0 ? Math.max(...vertices.map(v => v.id)) + 1 : 1;
    const baseLat = vertices.length > 0 ? vertices[vertices.length - 1].lat + 0.001 : 19.02;
    const baseLng = vertices.length > 0 ? vertices[vertices.length - 1].lng + 0.001 : 105.55;

    const updated = [
      ...vertices,
      { id: newId, lat: Number(baseLat.toFixed(6)), lng: Number(baseLng.toFixed(6)), format: 'Decimal', isEdited: true }
    ];
    pushHistory(updated, true);
  };

  // Sửa tọa độ từng đỉnh trong bảng
  const handleVertexChange = (index, field, value) => {
    const num = parseFloat(value);
    const updated = [...vertices];
    updated[index] = {
      ...updated[index],
      [field]: isNaN(num) ? value : num,
      isEdited: true
    };
    pushHistory(updated, true);
  };

  // Xóa một đỉnh
  const handleDeleteVertex = (index) => {
    const updated = vertices.filter((_, idx) => idx !== index);
    updated.forEach((p, idx) => { p.id = idx + 1; });
    pushHistory(updated, true);
  };

  // Di chuyển đỉnh lên trên
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const updated = [...vertices];
    const temp = updated[index - 1];
    updated[index - 1] = updated[index];
    updated[index] = temp;
    updated.forEach((p, idx) => { p.id = idx + 1; });
    pushHistory(updated, true);
  };

  // Di chuyển đỉnh xuống dưới
  const handleMoveDown = (index) => {
    if (index === vertices.length - 1) return;
    const updated = [...vertices];
    const temp = updated[index + 1];
    updated[index + 1] = updated[index];
    updated[index] = temp;
    updated.forEach((p, idx) => { p.id = idx + 1; });
    pushHistory(updated, true);
  };

  // Xóa trắng toàn bộ đỉnh
  const handleClearAllVertices = () => {
    pushHistory([], true);
    setShowSimulationHull(false);
  };

  // Nhấp chuột vào bản đồ xem trước để thêm đỉnh
  const handlePreviewMapClick = (coord) => {
    if (editGeomMode === 'keep') return;
    const newId = vertices.length > 0 ? Math.max(...vertices.map(v => v.id)) + 1 : 1;
    const updated = [
      ...vertices,
      { id: newId, lat: coord.lat, lng: coord.lng, format: 'Decimal', isEdited: true }
    ];
    pushHistory(updated, true);
  };

  // Tính toán Leaflet bounds cho việc tự động zoom vừa khít
  const mapBounds = useMemo(() => {
    const latLngs = [];

    // Nếu là nhiều nhóm và đang chọn 1 nhóm cụ thể -> Phóng riêng vào nhóm đó
    if (parsedBatch.isMultiGroup && selectedGroupTab !== 'all') {
      const targetGroup = parsedBatch.groups.find(g => g.groupIndex === selectedGroupTab || g.id === selectedGroupTab);
      if (targetGroup && targetGroup.vertices && targetGroup.vertices.length > 0) {
        targetGroup.vertices.forEach(v => {
          if (!isNaN(v.lat) && !isNaN(v.lng)) {
            latLngs.push([v.lat, v.lng]);
          }
        });
        if (latLngs.length > 0) {
          return L.latLngBounds(latLngs);
        }
      }
    }

    // Điểm từ vertices mới
    vertices.forEach(v => {
      if (!isNaN(v.lat) && !isNaN(v.lng)) {
        latLngs.push([v.lat, v.lng]);
      }
    });

    // Điểm từ hình học cũ nếu có
    if (oldGeometry) {
      if (oldGeometry.type === 'Point' && Array.isArray(oldGeometry.coordinates)) {
        latLngs.push([oldGeometry.coordinates[1], oldGeometry.coordinates[0]]);
      } else if ((oldGeometry.type === 'Polygon' || oldGeometry.type === 'MultiPolygon') && Array.isArray(oldGeometry.coordinates)) {
        const ring = oldGeometry.type === 'Polygon' ? oldGeometry.coordinates[0] : oldGeometry.coordinates[0][0];
        if (Array.isArray(ring)) {
          ring.forEach(c => {
            if (Array.isArray(c)) latLngs.push([c[1], c[0]]);
          });
        }
      }
    }

    // Điểm từ simulationPolygon nếu có (vùng đệm hoặc hình chữ nhật 2 điểm)
    if (validationResult && validationResult.simulationPolygon) {
      validationResult.simulationPolygon.forEach(p => {
        if (!isNaN(p.lat) && !isNaN(p.lng)) {
          latLngs.push([p.lat, p.lng]);
        }
      });
    }

    if (latLngs.length > 0) {
      return L.latLngBounds(latLngs);
    }
    return null;
  }, [vertices, oldGeometry, validationResult, parsedBatch, selectedGroupTab]);

  // Chuyển oldGeometry thành Leaflet positions để vẽ lớp cũ
  const oldGeometryPositions = useMemo(() => {
    if (!oldGeometry) return null;
    if (oldGeometry.type === 'Point' && Array.isArray(oldGeometry.coordinates)) {
      return { type: 'Point', pos: [oldGeometry.coordinates[1], oldGeometry.coordinates[0]] };
    }
    if (oldGeometry.type === 'Polygon' && Array.isArray(oldGeometry.coordinates)) {
      const ring = oldGeometry.coordinates[0] || [];
      return { type: 'Polygon', positions: ring.map(c => [c[1], c[0]]) };
    }
    if (oldGeometry.type === 'MultiPolygon' && Array.isArray(oldGeometry.coordinates)) {
      const poly = oldGeometry.coordinates[0] || [];
      const ring = poly[0] || [];
      return { type: 'Polygon', positions: ring.map(c => [c[1], c[0]]) };
    }
    return null;
  }, [oldGeometry]);

  // Submit Form
  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErrorMessage('');
    setSuccessInfo('');
    setDuplicateField(null);
    setDuplicateInfo(null);

    // BẢO VỆ NGHIÊM NGẶT (Section IV & Section VI):
    // Không cho phép lưu khi trạng thái validation chưa đạt chuẩn
    if (!unifiedValidationStatus.canSubmit) {
      setErrorMessage(unifiedValidationStatus.message || 'Không thể lưu: Dữ liệu hình học hoặc ranh giới chưa hợp lệ.');
      return;
    }

    // 1. Kiểm tra mã vùng trồng
    if (!formData.msvt_moi.trim() && !formData.msvt_cu.trim()) {
      setErrorMessage('Vui lòng nhập ít nhất một trong hai mã: Mã MSVT mới hoặc Mã MSVT cũ.');
      return;
    }

    // 2. Kiểm tra các trường số
    const dienTich = formData.dien_tich_ha.trim() ? parseFloat(formData.dien_tich_ha) : null;
    if (dienTich !== null && (isNaN(dienTich) || dienTich < 0)) {
      setErrorMessage('Diện tích (ha) phải là số không âm.');
      return;
    }

    const tongSanLuong = formData.tong_san_luong_tan.trim() ? parseFloat(formData.tong_san_luong_tan) : null;
    if (tongSanLuong !== null && (isNaN(tongSanLuong) || tongSanLuong < 0)) {
      setErrorMessage('Tổng sản lượng (tấn) phải là số không âm.');
      return;
    }

    const sanLuongHa = formData.san_luong_tan_ha.trim() ? parseFloat(formData.san_luong_tan_ha) : null;
    if (sanLuongHa !== null && (isNaN(sanLuongHa) || sanLuongHa < 0)) {
      setErrorMessage('Năng suất (tấn/ha) phải là số không âm.');
      return;
    }

    const soHo = formData.so_ho_tham_gia.trim() ? parseInt(formData.so_ho_tham_gia, 10) : null;
    if (soHo !== null && (isNaN(soHo) || soHo < 0)) {
      setErrorMessage('Số hộ tham gia phải là số nguyên không âm.');
      return;
    }

    // 3. Kiểm tra email
    if (formData.email.trim()) {
      const emailVal = formData.email.trim();
      if (!emailVal.includes('@') || !emailVal.includes('.')) {
        setErrorMessage('Định dạng email không hợp lệ (cần chứa ký tự @ và tên miền).');
        return;
      }
    }

    // 4. Kiểm tra số điện thoại
    if (formData.so_dien_thoai.trim()) {
      const digits = formData.so_dien_thoai.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 20) {
        setErrorMessage('Số điện thoại phải chứa từ 7 đến 20 chữ số.');
        return;
      }
    }

    // Tọa độ gốc: Bảo toàn chuỗi gốc hoặc tự động lưu chuỗi văn bản nếu ô tọa độ gốc trống
    const rawToaDoGoc = formData.toa_do_goc.trim() || coordInputText.trim() || null;

    // 5. Chuẩn bị payload thông tin thuộc tính
    const payload = {
      msvt_moi: formData.msvt_moi.trim() || null,
      msvt_cu: formData.msvt_cu.trim() || null,
      to_chuc_ca_nhan: formData.to_chuc_ca_nhan.trim() || null,
      nguoi_dai_dien: formData.nguoi_dai_dien.trim() || null,
      so_dien_thoai: formData.so_dien_thoai.trim() || null,
      email: formData.email.trim() || null,
      toa_do_goc: rawToaDoGoc,
      dia_chi_msvt: formData.dia_chi_msvt.trim() || null,
      loai_cay_trong: formData.loai_cay_trong.trim() || null,
      so_ho_tham_gia: soHo,
      dien_tich_ha: dienTich,
      tong_san_luong_tan: tongSanLuong,
      san_luong_tan_ha: sanLuongHa,
      quy_trinh: formData.quy_trinh.trim() || null,
      thi_truong: formData.thi_truong.trim() || null
    };

    // 6. Xử lý hình học PostGIS theo các chế độ (Section VI, VII, VIII)
    if (parsedBatch.isMultiGroup) {
      if (multiGroupMode !== 'same_msvt') {
        setErrorMessage('Không thể lưu: Dữ liệu chứa nhiều nhóm tọa độ chưa được xác nhận cùng thuộc một MSVT.');
        return;
      }
      if (!parsedBatch.allGroupsValid) {
        const invalidGroups = parsedBatch.groups.filter(g => !g.isValid).map(g => `${g.name} (${g.reason})`).join(', ');
        setErrorMessage(`Không thể lưu MultiPolygon vì có nhóm ranh giới bị lỗi: ${invalidGroups}.`);
        return;
      }
      if (!hasConfirmedBoundary) {
        setErrorMessage('Vui lòng xem trước các phân vùng và tích chọn xác nhận ranh giới trước khi lưu MultiPolygon.');
        return;
      }
      const multiPoly = combineMultiPolygonGeoJSON(parsedBatch.groups);
      if (!multiPoly) {
        setErrorMessage('Không thể tạo cấu trúc MultiPolygon từ các nhóm hiện tại.');
        return;
      }
      payload.geometry = { geojson: multiPoly };
    } else if (isEdit && editGeomMode === 'keep') {
      if (!oldGeometry) {
        setErrorMessage('Vùng trồng này chưa có dữ liệu không gian. Chế độ kiểm soát nghiêm ngặt bắt buộc bạn phải bổ sung tọa độ Point hoặc Polygon hợp lệ.');
        return;
      }
      // TUYỆT ĐỐI BẢO TOÀN HÌNH HỌC CŨ: Không gửi trường geometry sang backend PATCH
      delete payload.geometry;
    } else {
      // Trường hợp Thêm mới HOẶC Cập nhật hình học (isEdit && editGeomMode !== 'keep')
      if (vertices.length === 1) {
        if (isNaN(vertices[0].lat) || isNaN(vertices[0].lng)) {
          setErrorMessage('Tọa độ Point không hợp lệ.');
          return;
        }
        if (vertices[0].lat < -90 || vertices[0].lat > 90 || vertices[0].lng < -180 || vertices[0].lng > 180) {
          setErrorMessage('Tọa độ Point nằm ngoài phạm vi WGS84 (Vĩ độ [-90, 90], Kinh độ [-180, 180]).');
          return;
        }
        // Gửi cấu trúc Point chuẩn theo Pydantic schema (latitude, longitude)
        payload.geometry = {
          point: {
            latitude: Number(vertices[0].lat),
            longitude: Number(vertices[0].lng)
          }
        };
      } else if (vertices.length >= 3) {
        if (!validationResult.isValid) {
          setErrorMessage(`Không thể lưu hình học: ${validationResult.message}. Lưu ý: Vùng mô phỏng chỉ dùng để tham khảo, không được tự động lưu.`);
          return;
        }
        if (!hasConfirmedBoundary) {
          setErrorMessage('Vui lòng xem trước ranh giới và tích chọn xác nhận trước khi lưu.');
          return;
        }
        payload.geometry = { geojson: validationResult.geojson };
      } else if (vertices.length === 2) {
        setErrorMessage('Không thể lưu: Bạn đã nhập 2 cặp tọa độ. Để lưu Điểm mốc (Point) vui lòng nhập chính xác 1 cặp tọa độ; để tạo Vùng ranh giới (Polygon) cần tối thiểu 3 đỉnh phân biệt.');
        return;
      } else {
        if (!isEdit) {
          setErrorMessage('Không thể thêm mới vùng trồng: Bắt buộc phải có tọa độ Point hoặc Polygon hợp lệ.');
          return;
        }
      }
    }

    setLoading(true);
    try {
      let result;
      if (isEdit) {
        result = await adminApi.patchRegion(region.id, payload);
      } else {
        result = await adminApi.createRegion(payload);
      }

      setSuccessInfo('Lưu trữ dữ liệu thành công!');
      if (onSuccess) {
        onSuccess(result);
      }
      onClose();
    } catch (err) {
      console.error('[MsvtRegionForm] Lỗi khi lưu vùng trồng:', err);
      if (err.status === 409 || err.code?.startsWith('DUPLICATE_MSVT')) {
        const dupField = err.field || (err.message && err.message.toLowerCase().includes('cũ') ? 'msvt_cu' : 'msvt_moi');
        setDuplicateField(dupField);
        setDuplicateInfo({
          code: err.duplicate_code || (dupField === 'msvt_moi' ? formData.msvt_moi : formData.msvt_cu),
          id: err.existing_id
        });
        setErrorMessage(err.message || 'Mã vùng trồng đã tồn tại trong hệ thống. Vui lòng kiểm tra hoặc sử dụng mã khác.');
      } else if (err.detail && typeof err.detail === 'object') {
        const edgesStr = err.detail.affected_edges && err.detail.affected_edges.length > 0
          ? ` (Cạnh lỗi: ${err.detail.affected_edges.join(', ')})`
          : '';
        setErrorMessage(`${err.detail.message || 'Lỗi hình học'}: ${err.detail.reason || ''}${edgesStr}`);
      } else {
        setErrorMessage(err.message || 'Đã xảy ra lỗi khi lưu thông tin vùng trồng.');
      }
    } finally {
      setLoading(false);
    }
  };

  const currentGeomType = isEdit ? (region.geometry_type || (region.ranh_gioi ? 'MULTIPOLYGON' : (region.vi_tri ? 'POINT' : null))) : null;

  return (
    <div className="msvt-form-overlay" onClick={onClose}>
      <div className="msvt-form-modal msvt-form-modal-large" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="msvt-form-header">
          <h3 className="msvt-form-header-title">
            {isEdit ? `✏️ Chỉnh sửa Vùng trồng MSVT #${region.id}` : '➕ Thêm mới Vùng trồng MSVT'}
          </h3>
          <button
            type="button"
            className="msvt-form-close-btn"
            onClick={onClose}
            title="Đóng cửa sổ"
          >
            ✕
          </button>
        </div>

        {/* Thông báo lỗi & thành công */}
        {errorMessage && (
          <div className="msvt-form-alert msvt-form-alert-error">
            <span>⚠️ {errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage('')} className="msvt-form-alert-close">✕</button>
          </div>
        )}

        {successInfo && (
          <div className="msvt-form-alert msvt-form-alert-success">
            <span>✅ {successInfo}</span>
          </div>
        )}

        {/* Form Body */}
        <form className="msvt-form-body" onSubmit={handleSubmit}>
          {/* NHÓM 1: MÃ VÙNG TRỒNG */}
          <div className="msvt-form-section">
            <h4 className="msvt-form-section-title">🏷️ 1. Thông tin Mã số Vùng trồng (MSVT)</h4>
            <div className="msvt-form-grid-2">
              <div className="msvt-field-group">
                <label className="msvt-field-label">
                  Mã MSVT mới (Định dạng chuẩn)
                  {duplicateField === 'msvt_moi' && (
                    <span className="msvt-field-duplicate-badge">⚠️ Trùng mã trong hệ thống</span>
                  )}
                </label>
                <input
                  type="text"
                  name="msvt_moi"
                  className={`msvt-field-input ${duplicateField === 'msvt_moi' ? 'msvt-input-duplicate-error' : ''}`}
                  placeholder="Ví dụ: VN-40-705-0001-01-24"
                  value={formData.msvt_moi}
                  onChange={handleChange}
                  disabled={loading}
                  autoFocus={duplicateField === 'msvt_moi'}
                />
                <span className="msvt-field-hint">
                  {duplicateField === 'msvt_moi' && duplicateInfo?.id
                    ? `Mã này đang thuộc về bản ghi ID #${duplicateInfo.id}. Vui lòng nhập mã khác.`
                    : 'Bảo toàn chuỗi gốc và các số 0 ở đầu.'}
                </span>
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">
                  Mã MSVT cũ
                  {duplicateField === 'msvt_cu' && (
                    <span className="msvt-field-duplicate-badge">⚠️ Trùng mã trong hệ thống</span>
                  )}
                </label>
                <input
                  type="text"
                  name="msvt_cu"
                  className={`msvt-field-input ${duplicateField === 'msvt_cu' ? 'msvt-input-duplicate-error' : ''}`}
                  placeholder="Ví dụ: VN-40-705-0001-01-22"
                  value={formData.msvt_cu}
                  onChange={handleChange}
                  disabled={loading}
                  autoFocus={duplicateField === 'msvt_cu'}
                />
                <span className="msvt-field-hint">
                  {duplicateField === 'msvt_cu' && duplicateInfo?.id
                    ? `Mã này đang thuộc về bản ghi ID #${duplicateInfo.id}. Vui lòng nhập mã khác.`
                    : 'Mã vùng trồng trước khi cấp mã mới (nếu có).'}
                </span>
              </div>
            </div>
          </div>

          {/* NHÓM 2: CHỦ THỂ & LIÊN HỆ */}
          <div className="msvt-form-section">
            <h4 className="msvt-form-section-title">🏢 2. Chủ thể Quản lý & Đại diện</h4>
            <div className="msvt-form-grid-2">
              <div className="msvt-field-group">
                <label className="msvt-field-label">Tổ chức / Cá nhân</label>
                <input
                  type="text"
                  name="to_chuc_ca_nhan"
                  className="msvt-field-input"
                  placeholder="Ví dụ: HTX Nông nghiệp Tây Hiếu"
                  value={formData.to_chuc_ca_nhan}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Người đại diện</label>
                <input
                  type="text"
                  name="nguoi_dai_dien"
                  className="msvt-field-input"
                  placeholder="Họ tên người đại diện pháp luật"
                  value={formData.nguoi_dai_dien}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Số điện thoại</label>
                <input
                  type="text"
                  name="so_dien_thoai"
                  className="msvt-field-input"
                  placeholder="Ví dụ: 0912345678"
                  value={formData.so_dien_thoai}
                  onChange={handleChange}
                  disabled={loading}
                />
                <span className="msvt-field-hint">Thông tin bảo mật nội bộ quản trị.</span>
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Email liên hệ</label>
                <input
                  type="email"
                  name="email"
                  className="msvt-field-input"
                  placeholder="Ví dụ: contact@htxtayhieu.vn"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="msvt-field-group">
              <label className="msvt-field-label">Địa chỉ vùng trồng</label>
              <input
                type="text"
                name="dia_chi_msvt"
                className="msvt-field-input"
                placeholder="Xã/Phường, Huyện/Thị xã, Tỉnh Nghệ An"
                value={formData.dia_chi_msvt}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          {/* NHÓM 3: SẢN XUẤT NÔNG NGHIỆP */}
          <div className="msvt-form-section">
            <h4 className="msvt-form-section-title">🌾 3. Chỉ tiêu Sản xuất & Thị trường</h4>
            <div className="msvt-form-grid-3">
              <div className="msvt-field-group">
                <label className="msvt-field-label">Loại cây trồng</label>
                <input
                  type="text"
                  name="loai_cay_trong"
                  className="msvt-field-input"
                  placeholder="Ví dụ: Lúa, Cam, Chanh leo..."
                  value={formData.loai_cay_trong}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Số hộ tham gia</label>
                <input
                  type="number"
                  name="so_ho_tham_gia"
                  className="msvt-field-input"
                  placeholder="0"
                  min="0"
                  value={formData.so_ho_tham_gia}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Diện tích (ha)</label>
                <input
                  type="number"
                  name="dien_tich_ha"
                  className="msvt-field-input"
                  placeholder="0.0"
                  step="0.0001"
                  min="0"
                  value={formData.dien_tich_ha}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Tổng sản lượng (tấn)</label>
                <input
                  type="number"
                  name="tong_san_luong_tan"
                  className="msvt-field-input"
                  placeholder="0.0"
                  step="0.0001"
                  min="0"
                  value={formData.tong_san_luong_tan}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Năng suất (tấn/ha)</label>
                <input
                  type="number"
                  name="san_luong_tan_ha"
                  className="msvt-field-input"
                  placeholder="Để trống nếu chưa xác minh"
                  step="0.0001"
                  min="0"
                  value={formData.san_luong_tan_ha}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="msvt-field-group">
                <label className="msvt-field-label">Thị trường tiêu thụ</label>
                <input
                  type="text"
                  name="thi_truong"
                  className="msvt-field-input"
                  placeholder="Trong nước, Trung Quốc, EU..."
                  value={formData.thi_truong}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="msvt-field-group">
              <label className="msvt-field-label">Quy trình kỹ thuật canh tác</label>
              <input
                type="text"
                name="quy_trinh"
                className="msvt-field-input"
                placeholder="VietGAP, Hữu cơ, GlobalGAP..."
                value={formData.quy_trinh}
                onChange={handleChange}
                disabled={loading}
              />
            </div>
          </div>

          {/* NHÓM 4: DỮ LIỆU TỌA ĐỘ GPS VÀ RANH GIỚI VÙNG TRỒNG */}
          <div className="msvt-form-section msvt-geom-section">
            <div className="msvt-geom-header-row">
              <h4 className="msvt-form-section-title" style={{ border: 'none', padding: 0 }}>
                📍 4. TỌA ĐỘ GPS VÀ RANH GIỚI VÙNG TRỒNG
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="msvt-detected-format-badge">
                  🏷️ {parsedBatch.stats.overallFormat}
                </span>
                <span className="msvt-geom-badge">
                  {vertices.length === 0 && '⚪ Chưa có tọa độ'}
                  {vertices.length === 1 && '🔵 Điểm đại diện (Point)'}
                  {vertices.length === 2 && '⚠️ Cần thêm 1 đỉnh (2/3)'}
                  {vertices.length >= 3 && `🟩 Đa giác (${vertices.length} đỉnh)`}
                </span>
              </div>
            </div>

            <div className="msvt-field-group">
              <label className="msvt-field-label">Tọa độ gốc (Bảo toàn nguyên vẹn chuỗi gốc từ Excel / văn bản)</label>
              <input
                type="text"
                name="toa_do_goc"
                className="msvt-field-input"
                placeholder="Ví dụ: 19o10'50.90'';105o34'33.08'' hoặc chuỗi gốc từ tài liệu"
                value={formData.toa_do_goc}
                onChange={handleChange}
                disabled={loading}
              />
            </div>

            {/* BỐN CHẾ ĐỘ CẬP NHẬT HÌNH HỌC KHI SỬA (SECTION VII) */}
            {isEdit && (
              <div className="msvt-geom-mode-selector">
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>
                  Hiện trạng: {currentGeomType === 'MULTIPOLYGON' ? '🟩 Đa giác ranh giới (MultiPolygon)' : currentGeomType === 'POINT' ? '🔵 Điểm đại diện (Point)' : '⚪ Chưa có hình học'}
                </div>

                <div className="msvt-geom-radio-group">
                  <label className="msvt-geom-radio-label">
                    <input
                      type="radio"
                      name="editGeomMode"
                      value="keep"
                      checked={editGeomMode === 'keep'}
                      onChange={() => setEditGeomMode('keep')}
                      disabled={!oldGeometry}
                    />
                    <span>
                      <strong>1. Giữ nguyên hình học cũ</strong> (Bảo toàn nguyên vẹn ranh giới hiện có)
                      {!oldGeometry && <span style={{ color: '#dc2626', marginLeft: '6px' }}>(Không khả dụng do chưa có dữ liệu ranh giới)</span>}
                    </span>
                  </label>

                  {!oldGeometry && (
                    <div style={{ fontSize: '12px', color: '#b45309', margin: '4px 0 8px 24px', backgroundColor: '#fef3c7', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fde68a' }}>
                      ⚠️ <strong>Vùng trồng chưa có ranh giới:</strong> Chế độ kiểm soát nghiêm ngặt bắt buộc bạn phải chọn tùy chọn 2 hoặc 3 để bổ sung Point hoặc Polygon hợp lệ trước khi lưu.
                    </div>
                  )}

                  <label className="msvt-geom-radio-label">
                    <input
                      type="radio"
                      name="editGeomMode"
                      value="update_point"
                      checked={editGeomMode === 'update_point'}
                      onChange={() => setEditGeomMode('update_point')}
                    />
                    <span><strong>2. Cập nhật Điểm đại diện (Point)</strong> (Khi nhập đúng 1 cặp tọa độ)</span>
                  </label>

                  <label className="msvt-geom-radio-label">
                    <input
                      type="radio"
                      name="editGeomMode"
                      value="update_polygon"
                      checked={editGeomMode === 'update_polygon'}
                      onChange={() => setEditGeomMode('update_polygon')}
                    />
                    <span><strong>3. Thay thế bằng ranh giới Polygon mới</strong> (Khoanh vùng từ danh sách tọa độ)</span>
                  </label>
                </div>

                {isEdit && editGeomMode === 'keep' && (
                  <div className={`msvt-validation-banner status-${unifiedValidationStatus.state}`} style={{ marginTop: '12px' }}>
                    <div className="msvt-validation-banner-title">
                      {unifiedValidationStatus.state === 'valid_confirmed' ? '✅ ' : '❌ '}
                      Trạng thái: {unifiedValidationStatus.label}
                    </div>
                    <div className="msvt-validation-banner-desc">
                      {unifiedValidationStatus.message}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* KHỐI NHẬP & KHOANH VÙNG TỌA ĐỘ ĐA ĐỊNH DẠNG */}
            {(!isEdit || editGeomMode !== 'keep') && (
              <div className="msvt-geom-editor-wrapper">
                {/* 1. LỰA CHỌN CHẾ ĐỘ NHẬN DIỆN ĐỊNH DẠNG (SECTION III.2) */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div className="msvt-format-mode-selector">
                    <span className="msvt-format-mode-label">Chế độ nhận diện:</span>
                    <div className="msvt-format-mode-btns">
                      <button
                        type="button"
                        className={`msvt-format-mode-btn ${coordMode === 'auto' ? 'active' : ''}`}
                        onClick={() => handleCoordModeChange('auto')}
                        title="Tự động nhận diện Decimal hoặc DMS"
                      >
                        ⚡ Tự động nhận diện
                      </button>
                      <button
                        type="button"
                        className={`msvt-format-mode-btn ${coordMode === 'decimal' ? 'active' : ''}`}
                        onClick={() => handleCoordModeChange('decimal')}
                        title="Chỉ chấp nhận số thập phân"
                      >
                        🔢 Thập phân (Decimal)
                      </button>
                      <button
                        type="button"
                        className={`msvt-format-mode-btn ${coordMode === 'dms' ? 'active' : ''}`}
                        onClick={() => handleCoordModeChange('dms')}
                        title="Chỉ chấp nhận Độ-phút-giây"
                      >
                        📐 Độ–Phút–Giây (DMS)
                      </button>
                    </div>
                  </div>
                </div>


                {/* 2. DASHBOARD THỐNG KÊ TRẠNG THÁI TỌA ĐỘ (SECTION III) */}
                <div className="msvt-stats-dashboard">
                  <div className="msvt-stat-card">
                    <span className="msvt-stat-label">Tổng dòng</span>
                    <span className="msvt-stat-value">{parsedBatch.stats.totalLines}</span>
                  </div>
                  <div className="msvt-stat-card valid">
                    <span className="msvt-stat-label">Điểm hợp lệ</span>
                    <span className="msvt-stat-value">{parsedBatch.stats.validCount}</span>
                  </div>
                  <div className="msvt-stat-card">
                    <span className="msvt-stat-label">Điểm phân biệt</span>
                    <span className="msvt-stat-value">{parsedBatch.stats.distinctCount}</span>
                  </div>
                  <div className={`msvt-stat-card ${parsedBatch.stats.duplicateCount > 0 ? 'warning' : ''}`}>
                    <span className="msvt-stat-label">Điểm trùng</span>
                    <span className="msvt-stat-value">{parsedBatch.stats.duplicateCount}</span>
                  </div>
                  <div className={`msvt-stat-card ${parsedBatch.stats.errorCount > 0 ? 'error' : ''}`}>
                    <span className="msvt-stat-label">Dòng lỗi</span>
                    <span className="msvt-stat-value">{parsedBatch.stats.errorCount}</span>
                  </div>
                  <div className="msvt-stat-card type">
                    <span className="msvt-stat-label">Hình học</span>
                    <span className="msvt-stat-value">
                      {vertices.length === 0 ? 'Chưa có' :
                       vertices.length === 1 ? 'Point' :
                       vertices.length === 2 ? 'Polyline (2đ)' :
                       `Polygon (${parsedBatch.stats.distinctCount}đ)`}
                    </span>
                  </div>
                </div>

                {/* Danh sách lỗi và cảnh báo điểm trùng nếu có */}
                {parsedBatch.stats.errorCount > 0 && (
                  <div className="msvt-issues-list">
                    <strong>⚠️ Chi tiết các dòng gặp lỗi:</strong>
                    {parsedBatch.stats.errors.map((err, i) => (
                      <div key={i} className="msvt-issue-item">
                        • <strong>Dòng #{err.line}:</strong> {err.reason}
                      </div>
                    ))}
                  </div>
                )}
                {parsedBatch.stats.duplicateCount > 0 && (
                  <div className="msvt-issues-list" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }}>
                    <strong>⚠️ Phát hiện điểm trùng lặp:</strong>
                    {parsedBatch.stats.duplicates.map((dup, i) => (
                      <div key={i} className="msvt-issue-item">
                        • <strong>Dòng #{dup.line}</strong> có tọa độ trùng hoàn toàn với <strong>Dòng #{dup.duplicateOf}</strong>.
                      </div>
                    ))}
                    <span style={{ fontSize: '11px', marginTop: '2px' }}>
                      (Hệ thống tự động hiển thị đường bao lồi mô phỏng để bạn tham khảo, nhưng không cho phép lưu Polygon có đỉnh trùng).
                    </span>
                  </div>
                )}

                {/* 3. THANH NÚT HÀNH ĐỘNG THEO SECTION III */}
                <div className="msvt-action-toolbar">
                  <button
                    type="button"
                    className="msvt-action-btn msvt-action-btn-primary"
                    onClick={handleCheckCoordinates}
                    title="Kiểm tra tính hợp lệ của toàn bộ tọa độ và hình học"
                  >
                    🔍 Kiểm tra tọa độ
                  </button>

                  <button
                    type="button"
                    className="msvt-action-btn"
                    onClick={handleToggleRawCoords}
                    title="Xem chi tiết tọa độ gốc nhập vào và giá trị đã chuẩn hóa"
                  >
                    📄 {showRawCoordsModal ? 'Ẩn tọa độ gốc' : 'Xem tọa độ gốc'}
                  </button>

                  <button
                    type="button"
                    className={`msvt-action-btn msvt-action-btn-simulation ${showSimulationHull ? 'active' : ''}`}
                    onClick={handleToggleSimulation}
                    title="Bật/Tắt đường bao lồi Convex Hull mô phỏng tham khảo (Frontend-only, không lưu vào DB)"
                  >
                    📐 {showSimulationHull ? 'Tắt mô phỏng' : 'Mô phỏng đường bao'}
                  </button>

                  <button
                    type="button"
                    className={`msvt-action-btn ${showCandidatesDrawer ? 'active' : ''}`}
                    style={{ backgroundColor: '#fff7ed', color: '#c2410c', borderColor: '#fdba74', fontWeight: 600 }}
                    onClick={() => setShowCandidatesDrawer(prev => !prev)}
                    title="Đề xuất các phương án nối đỉnh không tự giao cắt và đối chiếu theo diện tích khai báo"
                  >
                    💡 {showCandidatesDrawer ? 'Ẩn đề xuất PA' : 'Đề xuất hình mô phỏng'}
                  </button>

                  <button
                    type="button"
                    className="msvt-action-btn"
                    onClick={handleEditVerticesOrder}
                    title="Mở bảng điều chỉnh và đảo thứ tự đỉnh"
                  >
                    🔢 Chỉnh sửa thứ tự đỉnh
                  </button>

                  <button
                    type="button"
                    className="msvt-action-btn"
                    onClick={handleFocusPreview}
                    title="Tập trung bản đồ vào ranh giới Polygon"
                  >
                    🗺️ Xem trước Polygon
                  </button>

                  {vertices.length > 0 && (
                    <button
                      type="button"
                      className="msvt-action-btn"
                      style={{ color: '#dc2626', marginLeft: 'auto' }}
                      onClick={handleClearAllVertices}
                      title="Xóa trắng danh sách tọa độ"
                    >
                      🧹 Xóa hết
                    </button>
                  )}
                </div>

                {/* Modal / Khu vực xem chi tiết Tọa độ gốc */}
                {showRawCoordsModal && (
                  <div className="msvt-raw-coords-modal">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                        📋 Đối chiếu Tọa độ gốc và Tọa độ chuẩn hóa WGS84
                      </strong>
                      <button
                        type="button"
                        onClick={() => setShowRawCoordsModal(false)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 'bold' }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="msvt-raw-coords-table">
                      <table className="msvt-vertices-table">
                        <thead>
                          <tr>
                            <th style={{ width: '50px' }}>STT</th>
                            <th>Chuỗi gốc người dùng nhập</th>
                            <th>Định dạng</th>
                            <th>Vĩ độ (Lat)</th>
                            <th>Kinh độ (Lng)</th>
                            <th>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedBatch.items.map((item, idx) => (
                            <tr key={idx}>
                              <td>#{item.lineNum}</td>
                              <td><code style={{ fontSize: '12px' }}>{item.raw}</code></td>
                              <td><span className="msvt-vertex-badge">{item.format}</span></td>
                              <td>{item.lat !== null ? item.lat : '—'}</td>
                              <td>{item.lng !== null ? item.lng : '—'}</td>
                              <td>
                                {item.isValid ? (
                                  <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ Hợp lệ</span>
                                ) : (
                                  <span style={{ color: '#dc2626', fontSize: '11px' }}>❌ {item.error}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Chuyển đổi Tab: Dán danh sách tọa độ vs Bảng điều chỉnh đỉnh */}
                <div className="msvt-geom-tabs-bar">
                  <div className="msvt-geom-tabs">
                    <button
                      type="button"
                      className={`msvt-geom-tab-btn ${activeCoordTab === 'paste' ? 'active' : ''}`}
                      onClick={() => setActiveCoordTab('paste')}
                    >
                      📋 Dán danh sách tọa độ ({parsedBatch.stats.validCount} điểm hợp lệ)
                    </button>
                    <button
                      type="button"
                      className={`msvt-geom-tab-btn ${activeCoordTab === 'table' ? 'active' : ''}`}
                      onClick={() => setActiveCoordTab('table')}
                    >
                      🔢 Bảng tọa độ chuẩn hóa & Đổi thứ tự đỉnh ({vertices.length} đỉnh)
                    </button>
                  </div>
                </div>

                {/* Chỉ báo Điểm vị trí vùng trồng (Point) chuẩn hóa khi nhập đúng 1 cặp tọa độ */}
                {vertices.length === 1 && !isNaN(vertices[0].lat) && !isNaN(vertices[0].lng) && (
                  <div className="msvt-point-detected-card" style={{
                    margin: '10px 0',
                    padding: '12px 16px',
                    backgroundColor: '#eff6ff',
                    border: '1.5px solid #3b82f6',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '26px' }}>📍</span>
                      <div>
                        <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#1e40af' }}>
                          Điểm vị trí vùng trồng (Point)
                        </div>
                        <div style={{ fontSize: '13px', color: '#1e3a8a', marginTop: '3px' }}>
                          <strong>Vĩ độ (Latitude):</strong> {vertices[0].lat.toFixed(6)}° &nbsp;|&nbsp; <strong>Kinh độ (Longitude):</strong> {vertices[0].lng.toFixed(6)}°
                          {vertices[0].format && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#4b5563', backgroundColor: '#e0e7ff', padding: '1px 6px', borderRadius: '4px' }}>{vertices[0].format}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor: '#dbeafe',
                      color: '#1d4ed8',
                      padding: '5px 12px',
                      borderRadius: '20px',
                      border: '1px solid #93c5fd'
                    }}>
                      ✓ WGS84 EPSG:4326 • Sẵn sàng lưu
                    </div>
                  </div>
                )}

                {/* Tab 1: Ô nhập nhiều dòng cho phép dán trực tiếp */}
                {activeCoordTab === 'paste' && (
                  <div className="msvt-geom-paste-container">
                    <div className="msvt-field-hint" style={{ marginBottom: '6px' }}>
                      👉 Dán danh sách tọa độ GPS từ Excel/Word. Hỗ trợ <strong>Số thập phân (Decimal)</strong> hoặc <strong>Độ–phút–giây (DMS)</strong>.
                      <br />Thứ tự mặc định là <strong>Vĩ độ, Kinh độ (Latitude, Longitude)</strong>. Tự động khép kín vùng đa giác (không cần nhập lặp điểm đầu).
                    </div>
                    <textarea
                      className="msvt-field-textarea msvt-coord-textarea"
                      placeholder={`Ví dụ định dạng DMS:\n19o10'50.90'';105o34'33.08''\n19o10'50.92'';105o34'29.94''\n19o11'06.73'';105o34'24.27''\n19o11'08.32'';105o34'28.80''\n19o10'59.24'';105o34'29.24''\n\nHoặc định dạng Thập phân:\n19.020000, 105.550000\n19.021000, 105.553000\n19.023500, 105.554000`}
                      rows={6}
                      value={coordInputText}
                      onChange={handleTextareaChange}
                      disabled={loading}
                    />
                  </div>
                )}

                {/* Tab 2: Bảng chi tiết từng đỉnh, có thêm, xóa, sửa và đổi thứ tự */}
                {activeCoordTab === 'table' && (
                  <div className="msvt-geom-table-container">
                    {vertices.length === 0 ? (
                      <div className="msvt-empty-vertices">
                        Chưa có đỉnh tọa độ nào. Bạn có thể chuyển sang tab <strong>Dán danh sách tọa độ</strong> hoặc bấm <strong>+ Thêm đỉnh mới</strong>.
                      </div>
                    ) : (
                      <table className="msvt-vertices-table">
                        <thead>
                          <tr>
                            <th style={{ width: '55px' }}>STT</th>
                            <th>Vĩ độ (Latitude) [-90, 90]</th>
                            <th>Kinh độ (Longitude) [-180, 180]</th>
                            <th style={{ width: '90px' }}>Định dạng</th>
                            <th style={{ width: '130px' }}>Trạng thái</th>
                            <th style={{ width: '120px', textAlign: 'center' }}>Thứ tự & Xóa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vertices.map((v, idx) => (
                            <tr key={v.id || idx} style={v.isDuplicate ? { backgroundColor: '#fffbeb' } : {}}>
                              <td>
                                <span className="msvt-vertex-badge">#{idx + 1}</span>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.00000001"
                                  className="msvt-vertex-input"
                                  value={v.lat}
                                  onChange={(e) => handleVertexChange(idx, 'lat', e.target.value)}
                                  disabled={loading}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.00000001"
                                  className="msvt-vertex-input"
                                  value={v.lng}
                                  onChange={(e) => handleVertexChange(idx, 'lng', e.target.value)}
                                  disabled={loading}
                                />
                              </td>
                              <td>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                                  {v.format || 'Decimal'}
                                </span>
                              </td>
                              <td>
                                {v.isDuplicate ? (
                                  <span style={{ color: '#d97706', fontSize: '11px', fontWeight: 700 }}>
                                    ⚠️ Trùng #{v.duplicateOf}
                                  </span>
                                ) : (
                                  <span style={{ color: '#16a34a', fontSize: '11px', fontWeight: 600 }}>
                                    ✅ Hợp lệ
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div className="msvt-vertex-actions">
                                  <button
                                    type="button"
                                    className="msvt-btn-reorder"
                                    onClick={() => handleMoveUp(idx)}
                                    disabled={idx === 0 || loading}
                                    title="Di chuyển đỉnh lên trên"
                                  >
                                    ⬆️
                                  </button>
                                  <button
                                    type="button"
                                    className="msvt-btn-reorder"
                                    onClick={() => handleMoveDown(idx)}
                                    disabled={idx === vertices.length - 1 || loading}
                                    title="Di chuyển đỉnh xuống dưới"
                                  >
                                    ⬇️
                                  </button>
                                  <button
                                    type="button"
                                    className="msvt-btn-del-vertex"
                                    onClick={() => handleDeleteVertex(idx)}
                                    disabled={loading}
                                    title="Xóa đỉnh này"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ marginTop: '8px', padding: '0 8px 8px 8px' }}>
                      <button
                        type="button"
                        className="msvt-btn-tool"
                        onClick={handleAddVertex}
                        disabled={loading}
                      >
                        ➕ Thêm đỉnh tọa độ
                      </button>
                    </div>
                  </div>
                )}

                {/* Banner Thông báo Kiểm định Hình học */}
                <div className={`msvt-geom-status-banner ${
                  validationResult.type === 'EMPTY' ? 'info' :
                  validationResult.type === 'POINT' ? 'info' :
                  validationResult.type === 'TWO_POINTS' ? 'warning' :
                  validationResult.type === 'INSUFFICIENT' ? 'warning' :
                  validationResult.type === 'POLYGON' ? 'success' : 'error'
                }`}>
                  <div className="msvt-geom-status-content">
                    {validationResult.type === 'EMPTY' && <span>ℹ️ {validationResult.message}</span>}
                    {validationResult.type === 'POINT' && <span>📍 {validationResult.message} (Vĩ độ: {validationResult.point.latitude}, Kinh độ: {validationResult.point.longitude})</span>}
                    {validationResult.type === 'TWO_POINTS' && (
                      <div>
                        <span>⚠️ {validationResult.message}</span>
                        {validationResult.distanceMeters && (
                          <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>
                            (Khoảng cách 2 điểm: ~{validationResult.distanceMeters} m)
                          </span>
                        )}
                      </div>
                    )}
                    {validationResult.type === 'INSUFFICIENT' && <span>⚠️ {validationResult.message}</span>}
                    {validationResult.type === 'POLYGON' && <span>✅ {validationResult.message}</span>}
                    {['INVALID_COORD', 'OUT_OF_BOUNDS', 'DEGENERATE', 'SELF_INTERSECTING', 'DUPLICATE_POINTS', 'ZERO_AREA'].includes(validationResult.type) && (
                      <div>
                        <span>❌ {validationResult.message}</span>
                        {validationResult.simulationHull && (
                          <div style={{ marginTop: '4px', fontSize: '11.5px', color: '#c2410c' }}>
                            💡 Gợi ý: Hệ thống đã tạo đường bao lồi mô phỏng tham khảo (màu cam). Bạn có thể bấm <strong>"Mô phỏng đường bao"</strong> để đối chiếu thực địa.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* KHỐI ĐỐI CHIẾU DIỆN TÍCH RANH GIỚI VÀ HỒ SƠ KHAI BÁO (SECTION III & V) */}
                {validationResult.areaEvaluation && (
                  <div className="msvt-area-comparison-card">
                    <div className="msvt-area-comparison-header">
                      <span className="msvt-area-card-title">
                        📊 ĐỐI CHIẾU DIỆN TÍCH RANH GIỚI VÀ HỒ SƠ KHAI BÁO
                      </span>
                      <span className={`msvt-area-eval-badge ${validationResult.areaEvaluation.badgeColor || 'info'}`}>
                        {validationResult.areaEvaluation.label || 'Chưa đánh giá'}
                      </span>
                    </div>

                    <div className="msvt-area-grid">
                      <div className="msvt-area-stat">
                        <span className="msvt-area-stat-label">Diện tích hồ sơ MSVT</span>
                        <span className="msvt-area-stat-val">
                          {validationResult.areaEvaluation.declaredAreaHa != null
                            ? `${validationResult.areaEvaluation.declaredAreaHa} ha`
                            : '— (Chưa khai báo)'}
                        </span>
                      </div>

                      <div className="msvt-area-stat">
                        <span className="msvt-area-stat-label">
                          {validationResult.isValid ? 'Diện tích hình xem trước' : 'Diện tích Convex Hull'}
                        </span>
                        <span className="msvt-area-stat-val highlight">
                          {validationResult.areaEvaluation.gisAreaHa != null
                            ? `${validationResult.areaEvaluation.gisAreaHa} ha`
                            : '—'}
                        </span>
                      </div>

                      <div className="msvt-area-stat">
                        <span className="msvt-area-stat-label">Chênh lệch tuyệt đối</span>
                        <span className="msvt-area-stat-val">
                          {validationResult.areaEvaluation.diffHa != null
                            ? `${validationResult.areaEvaluation.diffHa} ha`
                            : '—'}
                        </span>
                      </div>

                      <div className="msvt-area-stat">
                        <span className="msvt-area-stat-label">Mức độ sai lệch (%)</span>
                        <span className={`msvt-area-stat-val ${validationResult.areaEvaluation.badgeColor || 'info'}`}>
                          {validationResult.areaEvaluation.deviationPct != null
                            ? `${validationResult.areaEvaluation.deviationPct}%`
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Phân tích đường bao lồi Convex Hull vs Diện tích hồ sơ (Section V) */}
                    {validationResult.hullAnalysis && validationResult.hullAnalysis.code !== 'NO_DECLARED' && (
                      <div className={`msvt-hull-analysis-alert ${validationResult.hullAnalysis.code === 'EXCEEDS_HULL' ? 'warning' : 'info'}`}>
                        {validationResult.hullAnalysis.message}
                      </div>
                    )}

                    {/* Gợi ý đề xuất khi có lỗi tự cắt hoặc sai lệch */}
                    {validationResult.candidates && validationResult.candidates.length > 0 && !validationResult.isValid && (
                      <div className="msvt-candidates-prompt-bar">
                        <span>⚠️ Phát hiện ranh giới tự cắt. Hệ thống đã tìm thấy <strong>{validationResult.candidates.length} phương án hình học hợp lệ</strong> từ tập tọa độ này.</span>
                        <button
                          type="button"
                          className="msvt-btn-open-candidates"
                          onClick={() => setShowCandidatesDrawer(true)}
                        >
                          💡 Xem đề xuất hình mô phỏng ({validationResult.candidates.length} PA)
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* KHỐI ĐỀ XUẤT CÁC PHƯƠNG ÁN MÔ PHỎNG (SECTION IV) */}
                {showCandidatesDrawer && (
                  <div className="msvt-candidates-panel">
                    <div className="msvt-candidates-panel-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                          💡 Đề xuất các phương án mô phỏng ranh giới không tự giao cắt
                        </span>
                        <span className="msvt-candidate-count-tag">
                          {validationResult.candidates ? validationResult.candidates.length : 0} phương án khả thi
                        </span>
                      </div>
                      <button
                        type="button"
                        className="msvt-candidates-close-btn"
                        onClick={() => setShowCandidatesDrawer(false)}
                      >
                        ✕ Đóng
                      </button>
                    </div>

                    <div className="msvt-candidates-disclaimer">
                      ℹ️ <strong>Nguyên tắc:</strong> Giữ nguyên 100% tọa độ các điểm GPS gốc, tìm thứ tự nối đỉnh không tự cắt có diện tích gần nhất với diện tích hồ sơ (<strong>{formData.dien_tich_ha || '—'} ha</strong>). Các phương án này chỉ là <em>gợi ý hình học</em> hỗ trợ thẩm tra, không tự ý coi là ranh giới thực tế và <u>không tự động lưu vào cơ sở dữ liệu</u>.
                    </div>

                    {(!validationResult.candidates || validationResult.candidates.length === 0) ? (
                      <div className="msvt-candidates-empty">
                        Không tìm thấy phương án sắp xếp không tự giao cắt nào trong giới hạn tính toán an toàn. Vui lòng kiểm tra lại tọa độ hoặc chỉnh sửa thủ công trên bản đồ.
                      </div>
                    ) : (
                      <div className="msvt-candidates-list">
                        {validationResult.candidates.map((cand, idx) => (
                          <div key={cand.id || idx} className={`msvt-candidate-card ${selectedCandidateIndex === idx ? 'selected' : ''}`}>
                            <div className="msvt-candidate-card-header">
                              <span className="msvt-candidate-title">
                                Phương án #{idx + 1}: {cand.description || cand.ratingLabel || 'Phương án mô phỏng'}
                              </span>
                              {cand.areaEvaluation && (
                                <span className={`msvt-area-eval-badge ${cand.areaEvaluation.badgeColor || 'info'}`}>
                                  {cand.areaEvaluation.label || cand.ratingLabel} ({cand.areaEvaluation.deviationPct != null ? `${cand.areaEvaluation.deviationPct}%` : (cand.pctDiff != null ? `${cand.pctDiff}%` : '—')} sai lệch)
                                </span>
                              )}
                            </div>

                            <div className="msvt-candidate-body">
                              <div className="msvt-candidate-specs">
                                <div>• <strong>Diện tích mô phỏng:</strong> ~{cand.areaHa} ha</div>
                                <div>• <strong>Chênh lệch so với hồ sơ:</strong> {cand.diffHa != null ? `${cand.diffHa} ha` : '—'}</div>
                                <div>• <strong>Thứ tự các đỉnh:</strong> #{(cand.vertexOrder || cand.order || []).join(' ➔ #')}</div>
                              </div>

                              <div className="msvt-candidate-actions">
                                <button
                                  type="button"
                                  className="msvt-btn-apply-candidate"
                                  onClick={() => handleApplyCandidate(cand, idx)}
                                >
                                  ✨ Đưa vào Bản nháp chỉnh sửa
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* KHỐI XỬ LÝ ĐẶC THÙ CHO TRƯỜNG HỢP 2 TỌA ĐỘ GPS (SECTION IV & V & VII) */}
                {vertices.length === 2 && (
                  <div className="msvt-2points-card">
                    <div className="msvt-2points-header">
                      <span style={{ fontWeight: 700 }}>
                        📍 Tùy chọn xử lý dữ liệu 2 điểm GPS
                      </span>
                      {validationResult.distanceMeters !== undefined && (
                        <span className="msvt-2points-dist-badge">
                          📏 Khoảng cách: ~{validationResult.distanceMeters} mét
                        </span>
                      )}
                    </div>

                    <div className="msvt-2points-notice">
                      ⚠️ <strong>Thông báo:</strong> Dữ liệu hiện có 2 điểm GPS, chưa đủ xác định ranh giới Polygon. Bạn có thể xem đường nối hoặc tạo hình mô phỏng tham khảo.
                    </div>

                    <div className="msvt-2points-modes">
                      <label className={`msvt-2points-mode-item ${twoPointsMode === 'line' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="twoPointsMode"
                          value="line"
                          checked={twoPointsMode === 'line'}
                          onChange={() => setTwoPointsMode('line')}
                        />
                        <span><strong>1. Xem đoạn thẳng nối hai điểm</strong> (Hiển thị Polyline nối Đỉnh #1 và Đỉnh #2)</span>
                      </label>

                      <label className={`msvt-2points-mode-item ${twoPointsMode === 'buffer' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="twoPointsMode"
                          value="buffer"
                          checked={twoPointsMode === 'buffer'}
                          onChange={() => setTwoPointsMode('buffer')}
                        />
                        <span><strong>2. Mô phỏng vùng đệm</strong> (Buffer địa lý theo đơn vị mét quanh đoạn thẳng)</span>
                      </label>

                      {twoPointsMode === 'buffer' && (
                        <div className="msvt-2points-buffer-params">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                              Chiều rộng / Bán kính đệm (mét):
                            </span>
                            <input
                              type="number"
                              min="1"
                              max="10000"
                              step="5"
                              value={bufferMeters}
                              onChange={(e) => setBufferMeters(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              style={{ width: '80px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12.5px', fontWeight: 'bold' }}
                            />
                            <div className="msvt-quick-dist-btns">
                              {[10, 20, 50, 100].map(m => (
                                <button
                                  key={m}
                                  type="button"
                                  className={`msvt-btn-tool ${bufferMeters === m ? 'active' : ''}`}
                                  onClick={() => setBufferMeters(m)}
                                  style={{ padding: '3px 8px', fontSize: '11.5px' }}
                                >
                                  {m}m
                                </button>
                              ))}
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            ℹ️ Vùng đệm được tính toán bằng phương pháp trắc địa cục bộ WGS84 theo đơn vị mét (không buffer trực tiếp tọa độ độ). Diện tích mô phỏng ước tính: ~<strong>{validationResult.simulatedAreaHa || 0} ha</strong>.
                          </span>
                        </div>
                      )}

                      <label className={`msvt-2points-mode-item ${twoPointsMode === 'corridor' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="twoPointsMode"
                          value="corridor"
                          checked={twoPointsMode === 'corridor'}
                          onChange={() => setTwoPointsMode('corridor')}
                        />
                        <span><strong>3. Mô phỏng dải vùng theo diện tích</strong> (Dải hình chữ nhật metric có đoạn GPS là trục giữa)</span>
                      </label>

                      {twoPointsMode === 'corridor' && (
                        <div className="msvt-2points-buffer-params" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                              Chiều dài: ~{validationResult.distanceMeters || 0} m | Chiều rộng dải (mét):
                            </span>
                            <input
                              type="number"
                              min="0.1"
                              max="10000"
                              step="0.5"
                              value={corridorWidthMeters !== null ? corridorWidthMeters : (validationResult.corridorInfo?.widthMeters || 10)}
                              onChange={(e) => setCorridorWidthMeters(Math.max(0.1, parseFloat(e.target.value) || 1))}
                              style={{ width: '90px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #86efac', fontSize: '12.5px', fontWeight: 'bold' }}
                            />
                            {formData.dien_tich_ha && (
                              <button
                                type="button"
                                className="msvt-btn-tool"
                                onClick={() => {
                                  if (validationResult.distanceMeters && validationResult.distanceMeters > 0) {
                                    const declArea = parseFloat(formData.dien_tich_ha);
                                    const autoWidth = Number(((declArea * 10000.0) / validationResult.distanceMeters).toFixed(2));
                                    setCorridorWidthMeters(autoWidth);
                                  }
                                }}
                                title="Tự động tính chiều rộng dải = (Diện tích hồ sơ * 10000) / Chiều dài"
                              >
                                ⚡ Khớp diện tích hồ sơ ({formData.dien_tich_ha} ha)
                              </button>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: '#14532d', marginTop: '4px' }}>
                            ℹ️ Giả định hình học: Đoạn GPS là trục giữa, dải kéo đều 2 bên với chiều rộng {corridorWidthMeters || validationResult.corridorInfo?.widthMeters} m. Diện tích mô phỏng: ~<strong>{validationResult.simulatedAreaHa || 0} ha</strong>.
                            <br /><span style={{ color: '#b45309' }}>⚠️ Đây chỉ là hình mô phỏng tham khảo, không coi là ranh giới thật và không tự lưu vào cơ sở dữ liệu.</span>
                          </div>
                        </div>
                      )}

                      <label className={`msvt-2points-mode-item ${twoPointsMode === 'bbox' ? 'active' : ''}`}>
                        <input
                          type="radio"
                          name="twoPointsMode"
                          value="bbox"
                          checked={twoPointsMode === 'bbox'}
                          onChange={() => setTwoPointsMode('bbox')}
                        />
                        <span><strong>4. Mô phỏng hình chữ nhật từ hai góc đối diện</strong> (Bounding Box theo trục kinh/vĩ tuyến)</span>
                      </label>

                      {twoPointsMode === 'bbox' && (
                        <div className="msvt-2points-bbox-params">
                          <label className="msvt-bbox-confirm-label">
                            <input
                              type="checkbox"
                              checked={bboxConfirmed}
                              onChange={(e) => setBboxConfirmed(e.target.checked)}
                            />
                            <span>
                              <strong>Tôi xác nhận hiểu rõ:</strong> 2 điểm nhập vào là hai góc đối diện và đây chỉ là hình chữ nhật mô phỏng tham khảo theo trục kinh/vĩ tuyến, <em>không mặc định là ranh giới thực tế</em> của vùng trồng.
                            </span>
                          </label>
                          {bboxConfirmed && (
                            <div style={{ marginTop: '6px', fontSize: '11px', color: '#047857' }}>
                              ✅ Đã xác nhận: Hiển thị hình chữ nhật mô phỏng ~<strong>{validationResult.simulatedAreaHa || 0} ha</strong>.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="msvt-2points-guide">
                      💡 <strong>Hướng dẫn hoàn thiện ranh giới:</strong> Để tạo Polygon chính thức, bạn có thể bổ sung điểm thứ 3, thứ 4, thứ 5... tại bảng tọa độ phía trên hoặc <strong>nhấp chuột trực tiếp lên bản đồ xem trước</strong> bên dưới. Hình mô phỏng chỉ dùng để quan sát trực quan và sẽ <u>không được tự động lưu</u> vào cơ sở dữ liệu.
                    </div>
                  </div>
                )}

                {/* KHỐI QUẢN LÝ VÀ PHÂN CHIA CÁC NHÓM TỌA ĐỘ RANH GIỚI ĐỘC LẬP (SECTION V & VI & VIII) */}
                {parsedBatch.isMultiGroup && (
                  <div className="msvt-multigroup-card">
                    <div className="msvt-multigroup-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#4c1d95' }}>
                          📦 PHÂN CHIA CÁC NHÓM TỌA ĐỘ RANH GIỚI ĐỘC LẬP
                        </span>
                        <span className="msvt-candidate-count-tag" style={{ backgroundColor: '#e9d5ff', color: '#581c87' }}>
                          {parsedBatch.totalGroups} nhóm ranh giới • {parsedBatch.stats.validCount} tọa độ GPS
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#6b21a8', fontWeight: 600 }}>
                        ⚡ Tự động nhận diện nhãn Đ1..Đn & hướng N/E
                      </span>
                    </div>

                    {/* Section VI: Câu hỏi xác nhận quan hệ giữa các nhóm */}
                    <div className="msvt-multigroup-question-box">
                      <div className="msvt-multigroup-question-title">
                        ❓ Các nhóm tọa độ này thuộc cùng một mã số vùng trồng hay thuộc các vùng trồng độc lập?
                      </div>
                      <div className="msvt-multigroup-options">
                        <label className={`msvt-multigroup-option ${multiGroupMode === 'same_msvt' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="multiGroupMode"
                            value="same_msvt"
                            checked={multiGroupMode === 'same_msvt'}
                            onChange={() => setMultiGroupMode('same_msvt')}
                          />
                          <div>
                            <strong>Trường hợp A: Các nhóm thuộc cùng một MSVT</strong>
                            <div style={{ fontSize: '11.5px', color: '#4b5563', marginTop: '2px' }}>
                              Mỗi nhóm đại diện cho một phân vùng (Polygon) thành phần. Kết hợp thành <strong>MultiPolygon</strong> khi tất cả các nhóm đều hợp lệ.
                            </div>
                          </div>
                        </label>

                        <label className={`msvt-multigroup-option ${multiGroupMode === 'independent_msvt' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="multiGroupMode"
                            value="independent_msvt"
                            checked={multiGroupMode === 'independent_msvt'}
                            onChange={() => setMultiGroupMode('independent_msvt')}
                          />
                          <div>
                            <strong>Trường hợp B: Mỗi nhóm thuộc một MSVT độc lập</strong>
                            <div style={{ fontSize: '11.5px', color: '#4b5563', marginTop: '2px' }}>
                              Không tự ghép chung. Chỉ lưu thông tin thuộc tính cho vùng hiện tại và bảo toàn dữ liệu nguồn; để trống hình học (NULL) để lập bản ghi riêng sau.
                            </div>
                          </div>
                        </label>

                        <label className={`msvt-multigroup-option ${multiGroupMode === 'unconfirmed' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="multiGroupMode"
                            value="unconfirmed"
                            checked={multiGroupMode === 'unconfirmed'}
                            onChange={() => setMultiGroupMode('unconfirmed')}
                          />
                          <div>
                            <strong>Trường hợp C: Chưa xác định quan hệ (Khuyến nghị khi mới dán)</strong>
                            <div style={{ fontSize: '11.5px', color: '#4b5563', marginTop: '2px' }}>
                              Chỉ xem trước các nhóm trên bản đồ Leaflet. Giữ trạng thái chờ phân loại và <strong>không ghi geometry chính thức</strong> vào CSDL.
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Thanh điều hướng Tab các nhóm */}
                    <div className="msvt-group-tabs-bar">
                      <button
                        type="button"
                        className={`msvt-group-tab-btn ${selectedGroupTab === 'all' ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedGroupTab('all');
                          setFitBoundsTrigger(prev => prev + 1);
                        }}
                      >
                        🌐 Xem tất cả ({parsedBatch.totalGroups} nhóm)
                      </button>
                      {parsedBatch.groups.map((g, idx) => {
                        const color = GROUP_COLORS[idx % GROUP_COLORS.length];
                        const gName = customGroupNames[g.id] || g.name;
                        const isSel = selectedGroupTab === g.groupIndex || selectedGroupTab === g.id;
                        return (
                          <button
                            key={g.id || idx}
                            type="button"
                            className={`msvt-group-tab-btn ${isSel ? 'active' : ''}`}
                            style={{
                              borderColor: isSel ? color.border : '#cbd5e1',
                              backgroundColor: isSel ? color.bg : '#ffffff',
                              color: isSel ? color.text : '#334155'
                            }}
                            onClick={() => {
                              setSelectedGroupTab(g.groupIndex);
                              setFitBoundsTrigger(prev => prev + 1);
                            }}
                          >
                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color.border, marginRight: '4px' }}></span>
                            {gName} ({g.validCount}đ)
                            {g.isValid ? (g.isNarrow ? ' ⚠️' : ' ✅') : ' ❌'}
                          </button>
                        );
                      })}
                    </div>

                    {/* Bảng tổng hợp chi tiết từng nhóm */}
                    <div style={{ overflowX: 'auto', marginTop: '10px' }}>
                      <table className="msvt-group-summary-table">
                        <thead>
                          <tr>
                            <th style={{ width: '40px', textAlign: 'center' }}>Màu</th>
                            <th>Tên nhóm (Có thể sửa)</th>
                            <th style={{ textAlign: 'center', width: '70px' }}>Số đỉnh</th>
                            <th>Kiểm định hình học</th>
                            <th style={{ textAlign: 'right', width: '100px' }}>Diện tích</th>
                            <th style={{ textAlign: 'center', width: '90px' }}>Đã xem</th>
                            <th style={{ textAlign: 'center', width: '80px' }}>Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedBatch.groups.map((g, idx) => {
                            const color = GROUP_COLORS[idx % GROUP_COLORS.length];
                            const gName = customGroupNames[g.id] || g.name;
                            const isChecked = Boolean(checkedGroups[g.id]);
                            return (
                              <tr key={g.id || idx}>
                                <td style={{ textAlign: 'center' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      width: '14px',
                                      height: '14px',
                                      borderRadius: '50%',
                                      backgroundColor: color.border,
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                    }}
                                    title={color.name}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    value={gName}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setCustomGroupNames(prev => ({ ...prev, [g.id]: val }));
                                    }}
                                    style={{
                                      padding: '3px 6px',
                                      borderRadius: '4px',
                                      border: '1px solid #cbd5e1',
                                      fontSize: '12px',
                                      fontWeight: 600,
                                      width: '140px'
                                    }}
                                  />
                                </td>
                                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                  {g.validCount} điểm
                                </td>
                                <td>
                                  {g.isValid ? (
                                    <div>
                                      <span className="msvt-group-status-badge valid">✅ Hợp lệ</span>
                                      {g.isNarrow && (
                                        <span className="msvt-narrow-tag" style={{ marginLeft: '6px' }}>
                                          ⚠️ Dải hẹp (~{g.avgWidthM}m)
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="msvt-group-status-badge invalid">❌ Tự giao cắt</span>
                                      <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
                                        {g.reason}
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                  {g.areaHa !== null ? `~${g.areaHa} ha` : '—'}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setCheckedGroups(prev => ({ ...prev, [g.id]: checked }));
                                    }}
                                    title="Đánh dấu nhóm đã kiểm tra thẩm tra"
                                  />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="msvt-btn-tool"
                                    style={{ padding: '2px 6px', fontSize: '11px' }}
                                    onClick={() => {
                                      setSelectedGroupTab(g.groupIndex);
                                      setFitBoundsTrigger(prev => prev + 1);
                                    }}
                                  >
                                    🔍 Phóng
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* KHỐI BẢN ĐỒ XEM TRƯỚC TRỰC TIẾP (LIVE LEAFLET PREVIEW) */}
                <div className="msvt-preview-map-box" ref={previewMapRef}>
                  <div className="msvt-preview-map-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b' }}>
                        🗺️ Bản đồ xem trước trực tiếp (Live Geometry Preview)
                      </span>
                      {isDraft && (
                        <span className="msvt-draft-badge" title="Tọa độ đang ở chế độ bản nháp chỉnh sửa">
                          ✏️ Bản nháp chỉnh sửa
                        </span>
                      )}
                    </div>

                    {/* Toolbar Hoàn tác / Làm lại / Khôi phục gốc (Section VI) */}
                    <div className="msvt-history-toolbar">
                      <button
                        type="button"
                        className="msvt-history-btn"
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        title="Hoàn tác thay đổi đỉnh (Ctrl+Z)"
                      >
                        ↩️ Hoàn tác
                      </button>
                      <button
                        type="button"
                        className="msvt-history-btn"
                        onClick={handleRedo}
                        disabled={historyIndex >= history.length - 1}
                        title="Làm lại thao tác vừa hoàn tác"
                      >
                        ↪️ Làm lại
                      </button>
                      <button
                        type="button"
                        className="msvt-history-btn restore"
                        onClick={handleRestoreOriginal}
                        title="Khôi phục lại chính xác tọa độ GPS nguồn ban đầu"
                      >
                        🔄 Khôi phục tọa độ gốc
                      </button>
                    </div>

                    <div className="msvt-map-legend">
                      {isEdit && oldGeometryPositions && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#16a34a' }}></span>
                          Ranh giới cũ đã lưu
                        </span>
                      )}
                      {isDraft && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#2563eb' }}></span>
                          Bản nháp chỉnh sửa
                        </span>
                      )}
                      {vertices.length === 2 && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#ea580c' }}></span>
                          Đoạn thẳng 2 điểm GPS
                        </span>
                      )}
                      {vertices.length === 2 && validationResult.simulationPolygon && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#f59e0b', border: '1px dashed #ffffff' }}></span>
                          VÙNG MÔ PHỎNG — CHƯA XÁC MINH
                        </span>
                      )}
                      {/* Chỉ báo nhiều nhóm ranh giới */}
                      {parsedBatch.isMultiGroup && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#9333ea' }}></span>
                          {parsedBatch.totalGroups} Nhóm ranh giới độc lập (Màu riêng biệt)
                        </span>
                      )}
                      {validationResult.isValid && validationResult.type === 'POLYGON' && !isDraft && !parsedBatch.isMultiGroup && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#ea580c', border: '1px dashed #ffffff' }}></span>
                          Polygon hợp lệ mới
                        </span>
                      )}
                      {!validationResult.isValid && vertices.length >= 3 && !parsedBatch.isMultiGroup && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#ef4444', border: '1px dashed #ffffff' }}></span>
                          Đường nối gốc bị lỗi / tự cắt
                        </span>
                      )}
                      {(showSimulationHull || !validationResult.isValid) && validationResult.simulationHull && vertices.length >= 3 && !parsedBatch.isMultiGroup && (
                        <span className="msvt-legend-item">
                          <span className="msvt-legend-dot" style={{ backgroundColor: '#f59e0b', border: '1px dashed #ffffff' }}></span>
                          Vùng mô phỏng tham khảo
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="msvt-leaflet-container-wrapper">
                    <MapContainer
                      center={[19.25, 105.35]}
                      zoom={10}
                      scrollWheelZoom={true}
                      style={{ height: '340px', width: '100%', borderRadius: '8px' }}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />

                      <MapResizer />
                      <FitBoundsHelper bounds={mapBounds} triggerKey={fitBoundsTrigger} />
                      <MapClickListener onMapClick={handlePreviewMapClick} />

                      {/* 1. Hiển thị hình học cũ (Màu xanh lá) nếu đang ở chế độ Sửa */}
                      {isEdit && oldGeometryPositions && (
                        <>
                          {oldGeometryPositions.type === 'Point' && (
                            <Marker
                              position={oldGeometryPositions.pos}
                              icon={createNumberedIcon('Cũ', '#16a34a')}
                            >
                              <Tooltip permanent={false}>Điểm đại diện cũ đã lưu</Tooltip>
                            </Marker>
                          )}
                          {oldGeometryPositions.type === 'Polygon' && (
                            <Polygon
                              positions={oldGeometryPositions.positions}
                              pathOptions={{
                                color: '#16a34a',
                                fillColor: '#22c55e',
                                fillOpacity: 0.18,
                                weight: 2
                              }}
                            >
                              <Tooltip permanent={false}>Ranh giới hiện tại đã lưu trong cơ sở dữ liệu</Tooltip>
                            </Polygon>
                          )}
                        </>
                      )}

                      {/* 2. Hiển thị hình học mới */}
                      {editGeomMode !== 'keep' && (
                        <>
                          {/* TRƯỜNG HỢP NHIỀU NHÓM RANH GIỚI ĐỘC LẬP (SECTION VIII) */}
                          {parsedBatch.isMultiGroup ? (
                            parsedBatch.groups.map((group, gIdx) => {
                              if (selectedGroupTab !== 'all' && selectedGroupTab !== group.groupIndex && selectedGroupTab !== group.id) {
                                return null;
                              }
                              const gColor = GROUP_COLORS[gIdx % GROUP_COLORS.length];
                              const gName = customGroupNames[group.id] || group.name;

                              return (
                                <React.Fragment key={group.id || gIdx}>
                                  {/* Nhóm hợp lệ: Vẽ Polygon màu riêng biệt */}
                                  {group.isValid && group.vertices && group.vertices.length >= 3 && (
                                    <Polygon
                                      positions={group.vertices.map(p => [p.lat, p.lng])}
                                      pathOptions={{
                                        color: gColor.border,
                                        fillColor: gColor.fill,
                                        fillOpacity: 0.28,
                                        weight: 2.5
                                      }}
                                    >
                                      <Tooltip permanent={false}>
                                        {`${gName}: ${group.vertices.length} điểm (~${group.areaHa || 0} ha)`}
                                      </Tooltip>
                                    </Polygon>
                                  )}

                                  {/* Nhóm lỗi / tự cắt: Vẽ Polyline khép kín màu đỏ nét đứt, KHÔNG nối sang nhóm khác */}
                                  {!group.isValid && group.vertices && group.vertices.length >= 3 && (
                                    <>
                                      <Polyline
                                        positions={[...group.vertices.map(p => [p.lat, p.lng]), [group.vertices[0].lat, group.vertices[0].lng]]}
                                        pathOptions={{
                                          color: '#ef4444',
                                          dashArray: '6, 6',
                                          weight: 2.5
                                        }}
                                      >
                                        <Tooltip permanent={false}>
                                          {`${gName} (Lỗi tự giao cắt): ${group.reason || 'Không hợp lệ'}`}
                                        </Tooltip>
                                      </Polyline>

                                      {/* Đường bao lồi Convex Hull mô phỏng tham khảo (màu cam nét đứt) */}
                                      {group.simulationHull && group.simulationHull.length >= 3 && (
                                        <Polygon
                                          positions={group.simulationHull.map(p => [p.lat, p.lng])}
                                          pathOptions={{
                                            color: '#f59e0b',
                                            dashArray: '6, 4',
                                            fillColor: '#fbbf24',
                                            fillOpacity: 0.12,
                                            weight: 1.5
                                          }}
                                        >
                                          <Tooltip permanent={false}>
                                            {`${gName}: Vùng mô phỏng Convex Hull (~${group.simulatedAreaHa || 0} ha - Chưa xác minh)`}
                                          </Tooltip>
                                        </Polygon>
                                      )}
                                    </>
                                  )}

                                  {/* Đánh số đỉnh Đ1, Đ2, Đ3... tại các mốc của nhóm này bằng màu của nhóm */}
                                  {(group.vertices || []).map((pt, pIdx) => (
                                    <Marker
                                      key={`${group.id}_${pt.id || pIdx}`}
                                      position={[pt.lat, pt.lng]}
                                      icon={createNumberedIcon(pt.label || `Đ${pIdx + 1}`, gColor.border)}
                                    >
                                      <Tooltip permanent={false} direction="top">
                                        {`${gName} - ${pt.label || `Đỉnh #${pIdx + 1}`}: ${pt.lat}, ${pt.lng}`}
                                      </Tooltip>
                                    </Marker>
                                  ))}
                                </React.Fragment>
                              );
                            })
                          ) : (
                            /* TRƯỜNG HỢP 1 NHÓM DUY NHẤT */
                            <>
                              {/* Trường hợp 1 điểm (Point) */}
                              {vertices.length === 1 && !isNaN(vertices[0].lat) && !isNaN(vertices[0].lng) && (
                                <Marker
                                  position={[vertices[0].lat, vertices[0].lng]}
                                  draggable={editGeomMode !== 'keep'}
                                  eventHandlers={{
                                    dragend: (e) => handleMarkerDragEnd(0, e)
                                  }}
                                  icon={createNumberedIcon(1, vertices[0].isEdited ? '#2563eb' : '#ea580c')}
                                >
                                  <Tooltip permanent>Điểm xem trước #{vertices[0].id}</Tooltip>
                                </Marker>
                              )}

                              {/* Trường hợp 2 điểm (Đoạn thẳng nối 2 điểm trên Leaflet) */}
                              {vertices.length === 2 && (
                                <Polyline
                                  positions={vertices.map(p => [p.lat, p.lng])}
                                  pathOptions={{ color: '#ea580c', weight: 3 }}
                                >
                                  <Tooltip permanent={false}>
                                    {`Đoạn thẳng 2 điểm GPS (Khoảng cách: ~${validationResult.distanceMeters || 0} m)`}
                                  </Tooltip>
                                </Polyline>
                              )}

                              {/* HÌNH MÔ PHỎNG 2 ĐIỂM (Vùng đệm metric hoặc Bbox hoặc Corridor): Màu cam nét đứt */}
                              {vertices.length === 2 && validationResult.simulationPolygon && validationResult.simulationPolygon.length >= 3 && (
                                <Polygon
                                  positions={validationResult.simulationPolygon.map(p => [p.lat, p.lng])}
                                  pathOptions={{
                                    color: '#f59e0b',
                                    dashArray: '8, 6',
                                    fillColor: '#fbbf24',
                                    fillOpacity: 0.22,
                                    weight: 2
                                  }}
                                >
                                  <Tooltip permanent={true} direction="center">
                                    ⚠️ VÙNG MÔ PHỎNG — CHƯA XÁC MINH (~{validationResult.simulatedAreaHa || 0} ha)
                                  </Tooltip>
                                </Polygon>
                              )}

                              {/* Trường hợp >= 3 điểm HỢP LỆ (Polygon tự động khoanh vùng / Bản nháp chỉnh sửa) */}
                              {vertices.length >= 3 && validationResult.isValid && (
                                <Polygon
                                  positions={vertices.map(p => [p.lat, p.lng])}
                                  pathOptions={{
                                    color: isDraft ? '#2563eb' : (hasConfirmedBoundary ? '#15803d' : '#ea580c'),
                                    dashArray: isDraft ? '4, 4' : (hasConfirmedBoundary ? 'none' : '6, 6'),
                                    fillColor: isDraft ? '#3b82f6' : (hasConfirmedBoundary ? '#16a34a' : '#f97316'),
                                    fillOpacity: isDraft ? 0.3 : 0.25,
                                    weight: 3
                                  }}
                                >
                                  <Tooltip permanent={false}>
                                    {`${isDraft ? 'Bản nháp chỉnh sửa: ' : 'Ranh giới mới: '}${vertices.length} đỉnh (~${validationResult.areaHa || 0} ha)`}
                                  </Tooltip>
                                </Polygon>
                              )}

                              {/* Trường hợp >= 3 điểm BỊ LỖI / TỰ GIAO CẮT: Vẽ đường nối gốc bằng nét đứt màu đỏ */}
                              {vertices.length >= 3 && !validationResult.isValid && (
                                <Polyline
                                  positions={[...vertices.map(p => [p.lat, p.lng]), [vertices[0].lat, vertices[0].lng]]}
                                  pathOptions={{
                                    color: '#ef4444',
                                    dashArray: '6, 6',
                                    weight: 3
                                  }}
                                >
                                  <Tooltip permanent={false}>
                                    Đường nối thứ tự gốc bị lỗi hoặc tự giao cắt
                                  </Tooltip>
                                </Polyline>
                              )}

                              {/* ĐƯỜNG BAO LỒI CONVEX HULL MÔ PHỎNG (SECTION V): Màu cam nét đứt cho >= 3 điểm */}
                              {vertices.length >= 3 && (showSimulationHull || !validationResult.isValid) && validationResult.simulationHull && validationResult.simulationHull.length >= 3 && (
                                <Polygon
                                  positions={validationResult.simulationHull.map(p => [p.lat, p.lng])}
                                  pathOptions={{
                                    color: '#f59e0b',
                                    dashArray: '8, 6',
                                    fillColor: '#fbbf24',
                                    fillOpacity: 0.18,
                                    weight: 2
                                  }}
                                >
                                  <Tooltip permanent={false}>
                                    ⚠️ VÙNG MÔ PHỎNG — CHƯA XÁC MINH (~{validationResult.simulatedAreaHa} ha - Không phải ranh giới chính thức)
                                  </Tooltip>
                                </Polygon>
                              )}

                              {/* Hiển thị marker có thể kéo thả (draggable) đánh số 1, 2, 3... tại tất cả các đỉnh gốc */}
                              {vertices.length > 1 && vertices.map((p, idx) => (
                                !isNaN(p.lat) && !isNaN(p.lng) && (
                                  <Marker
                                    key={p.id || idx}
                                    position={[p.lat, p.lng]}
                                    draggable={editGeomMode !== 'keep'}
                                    eventHandlers={{
                                      dragend: (e) => handleMarkerDragEnd(idx, e)
                                    }}
                                    icon={createNumberedIcon(
                                      idx + 1,
                                      p.isEdited ? '#2563eb' : (p.isDuplicate ? '#dc2626' : '#ea580c')
                                    )}
                                  >
                                    <Tooltip permanent={false} direction="top">
                                      {`Đỉnh #${idx + 1}: ${p.lat}, ${p.lng}${p.isEdited ? ' (Đã kéo chỉnh sửa)' : ''}${p.isDuplicate ? ` (Trùng với #${p.duplicateOf})` : ''}${vertices.length === 2 && idx === 1 && validationResult.distanceMeters ? ` (Cách đỉnh #1: ~${validationResult.distanceMeters}m)` : ''}`}
                                    </Tooltip>
                                  </Marker>
                                )
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </MapContainer>
                  </div>

                  <div className="msvt-map-footer-hint">
                    💡 Click trực tiếp lên bản đồ xem trước để thêm đỉnh tọa độ mới. Kéo thả các đỉnh số 1, 2, 3... để điều chỉnh vị trí ranh giới trực quan.
                  </div>
                </div>

                  {/* 4 NÚT THAO TÁC THEO SECTION XII */}
                  <div className="msvt-checklist-actions" style={{ marginTop: '12px', marginBottom: '12px' }}>
                    <button
                      type="button"
                      className="msvt-checklist-btn primary"
                      onClick={handleRecheckGeometry}
                      disabled={isValidatingPostGIS || loading}
                      title="Kiểm định lại hình học bằng Shapely và PostGIS ST_IsValid"
                    >
                      {isValidatingPostGIS ? '⏳ Đang kiểm định...' : '🔄 Kiểm tra lại tọa độ'}
                    </button>
                    <button
                      type="button"
                      className="msvt-checklist-btn"
                      onClick={handleEditVertices}
                      disabled={loading}
                      title="Chuyển sang bảng chỉnh sửa từng đỉnh"
                    >
                      ✏️ Chỉnh sửa đỉnh
                    </button>
                    <button
                      type="button"
                      className="msvt-checklist-btn"
                      onClick={handleRestoreOriginalCoords}
                      disabled={loading || !originalVertices || originalVertices.length === 0}
                      title="Khôi phục danh sách tọa độ GPS nguồn ban đầu"
                    >
                      ⏪ Khôi phục tọa độ gốc
                    </button>
                    <button
                      type="button"
                      className="msvt-checklist-btn danger"
                      onClick={handleViewGeometryError}
                      disabled={loading}
                      title="Xem chi tiết nguyên nhân lỗi tự giao cắt hoặc lỗi hình học"
                    >
                      🔍 Xem lỗi hình học
                    </button>
                  </div>

                  {/* BẢNG TRẠNG THÁI KIỂM ĐỊNH 8 TIÊU CHÍ (SECTION XII) */}
                  <div className="msvt-checklist-card">
                    <div className="msvt-checklist-header">
                      <span className="msvt-checklist-title">📋 Bảng kiểm định chất lượng hình học & ranh giới (8 tiêu chí)</span>
                      <span className={`msvt-badge-${unifiedValidationStatus.state === 'valid_confirmed' ? 'pass' : unifiedValidationStatus.state === 'warning' ? 'warn' : 'fail'}`}>
                        {unifiedValidationStatus.label}
                      </span>
                    </div>
                    <table className="msvt-checklist-table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                          <th>Tiêu chí kiểm định</th>
                          <th style={{ width: '130px', textAlign: 'center' }}>Kết quả</th>
                          <th>Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checklistData.map((item) => (
                          <tr key={item.id}>
                            <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 600 }}>{item.id}</td>
                            <td style={{ fontWeight: 600, color: '#1e293b' }}>{item.name}</td>
                            <td style={{ textAlign: 'center' }}>
                              {item.pass === true ? (
                                <span className="msvt-badge-pass">✅ Đạt / Hợp lệ</span>
                              ) : item.pass === false ? (
                                <span className="msvt-badge-fail">❌ Không đạt</span>
                              ) : (
                                <span className="msvt-badge-warn">⚪ Chờ kiểm tra</span>
                              )}
                            </td>
                            <td style={{ fontSize: '12px', color: item.pass === false ? '#b91c1c' : '#334155' }}>
                              {item.text}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Checkbox Xác nhận trước khi lưu (Chỉ bắt buộc cho Polygon hoặc MultiPolygon) */}
                  {(vertices.length >= 3 || parsedBatch.isMultiGroup) && (
                    <div className="msvt-boundary-confirm-box" style={{ marginTop: '12px' }}>
                      <label className="msvt-boundary-confirm-label">
                        <input
                          type="checkbox"
                          checked={hasConfirmedBoundary}
                          onChange={(e) => setHasConfirmedBoundary(e.target.checked)}
                          disabled={loading}
                        />
                        <span>
                          <strong>Tôi đã xem trước trên bản đồ, đối chiếu ranh giới với thực tế và xác nhận dữ liệu tọa độ này là chính xác.</strong>
                        </span>
                      </label>
                      {!hasConfirmedBoundary && (
                        <div style={{ fontSize: '12px', color: '#b45309', marginTop: '4px', marginLeft: '24px' }}>
                          ⚠️ Bắt buộc: Bạn phải xem trước trên bản đồ và tích xác nhận ranh giới để mở khóa nút Thêm hoặc Cập nhật vùng trồng.
                        </div>
                      )}
                    </div>
                  )}

                  {/* BANNER THÔNG BÁO TRẠNG THÁI VALIDATION (SECTION IV & V) */}
                  <div className={`msvt-validation-banner status-${unifiedValidationStatus.state}`} style={{ marginTop: '12px' }}>
                    <div className="msvt-validation-banner-title">
                      {unifiedValidationStatus.state === 'valid_confirmed' && '✅ '}
                      {unifiedValidationStatus.state === 'warning' && '⚠️ '}
                      {unifiedValidationStatus.state === 'valid_unconfirmed' && 'ℹ️ '}
                      {unifiedValidationStatus.state === 'invalid' && '❌ '}
                      {unifiedValidationStatus.state === 'empty' && '⚪ '}
                      {unifiedValidationStatus.state === 'saving' && '⏳ '}
                      Trạng thái: {unifiedValidationStatus.label}
                    </div>
                    <div className="msvt-validation-banner-desc">
                      {unifiedValidationStatus.message}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>

        {/* Modal Footer */}
        <div className="msvt-form-footer">
          <button
            type="button"
            className="msvt-btn-cancel"
            onClick={onClose}
            disabled={loading}
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            className={`msvt-btn-submit ${!unifiedValidationStatus.canSubmit ? 'msvt-btn-disabled' : ''}`}
            onClick={handleSubmit}
            disabled={!unifiedValidationStatus.canSubmit || loading}
            title={!unifiedValidationStatus.canSubmit ? unifiedValidationStatus.message : ''}
          >
            {loading ? 'Đang lưu trữ...' : isEdit ? '💾 Cập nhật vùng trồng' : '➕ Thêm vùng trồng'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MsvtRegionForm;

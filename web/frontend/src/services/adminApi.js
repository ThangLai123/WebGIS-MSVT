/**
 * adminApi.js - Dịch vụ API Quản trị viên (Admin) cho Quản lý Mã số Vùng trồng MSVT
 * Sử dụng Vite Proxy: /msvt-api -> http://127.0.0.1:8000
 * Bảo mật: Cookie HttpOnly phiên làm việc + Header X-CSRF-Token + Credentials: include
 */

const BASE_URL = import.meta.env.VITE_MSVT_API_URL || '/msvt-api';

let inMemoryCsrfToken = null;

export const setCsrfToken = (token) => {
  inMemoryCsrfToken = token;
};

export const getCsrfToken = () => {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(new RegExp('(^|;\\s*)csrf_token=([^;]*)'));
    if (match) return decodeURIComponent(match[2]);
  }
  return null;
};

/**
 * Chuyển đổi mã lỗi và trường validation Pydantic sang tiếng Việt thân thiện
 */
function translatePydanticError(err) {
  if (!err) return '';
  const locStr = Array.isArray(err.loc) ? err.loc.slice(1).join('.') : (err.loc || '');
  let msg = err.msg || '';

  // Dịch tên trường
  const fieldNames = {
    'geometry.point.longitude': 'Kinh độ (Longitude) của điểm mốc',
    'geometry.point.latitude': 'Vĩ độ (Latitude) của điểm mốc',
    'geometry.point': 'Tọa độ điểm mốc (Point)',
    'geometry.geojson': 'Dữ liệu không gian GeoJSON',
    'geometry': 'Dữ liệu hình học không gian',
    'msvt_moi': 'Mã số vùng trồng mới',
    'msvt_cu': 'Mã số vùng trồng cũ',
    'dien_tich_ha': 'Diện tích (ha)',
    'so_ho_tham_gia': 'Số hộ tham gia',
    'so_dien_thoai': 'Số điện thoại',
    'email': 'Email',
    'to_chuc_ca_nhan': 'Tổ chức / cá nhân',
    'nguoi_dai_dien': 'Người đại diện',
    'dia_chi_msvt': 'Địa chỉ vùng trồng',
    'loai_cay_trong': 'Loại cây trồng',
    'tong_san_luong_tan': 'Tổng sản lượng (tấn)',
    'san_luong_tan_ha': 'Năng suất (tấn/ha)',
    'quy_trinh': 'Quy trình sản xuất',
    'thi_truong': 'Thị trường tiêu thụ'
  };

  const friendlyField = fieldNames[locStr] || (locStr ? `Trường '${locStr}'` : '');

  // Dịch thông điệp Pydantic phổ biến
  if (msg.includes('Field required')) {
    msg = 'Bắt buộc còn thiếu, vui lòng nhập giá trị hợp lệ';
  } else if (msg.includes('Input should be a valid number')) {
    msg = 'Giá trị phải là số hợp lệ';
  } else if (msg.includes('Input should be a valid integer')) {
    msg = 'Giá trị phải là số nguyên';
  } else if (msg.includes('Input should be a valid string')) {
    msg = 'Giá trị phải là chuỗi văn bản';
  } else if (msg.startsWith('Value error, ')) {
    msg = msg.replace('Value error, ', '');
  }

  return friendlyField ? `${friendlyField}: ${msg}` : msg;
}

/**
 * Xử lý lỗi trả về từ API backend và chuẩn hóa thành thông báo tiếng Việt thân thiện
 */
async function handleResponseError(response) {
  let errorData = null;
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      errorData = await response.json();
    }
  } catch {
    errorData = null;
  }

  const detail = errorData?.detail;
  let detailMessage = '';

  if (Array.isArray(detail)) {
    // Trường hợp lỗi validation Pydantic (422)
    detailMessage = detail.map(d => translatePydanticError(d)).join('; ');
  } else if (typeof detail === 'string') {
    detailMessage = detail;
  } else if (detail && typeof detail === 'object') {
    // Trường hợp lỗi có cấu trúc từ backend GIS: code, message, reason, affected_edges
    detailMessage = detail.message || detail.reason || JSON.stringify(detail);
  }

  let finalError;
  switch (response.status) {
    case 401:
      finalError = new Error(detailMessage || 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
      break;
    case 403:
      finalError = new Error(detailMessage || 'Bạn không có quyền thực hiện thao tác này hoặc CSRF token không hợp lệ.');
      break;
    case 404:
      finalError = new Error(detailMessage || 'Không tìm thấy dữ liệu yêu cầu.');
      break;
    case 409:
      finalError = new Error(detailMessage || 'Mã số vùng trồng đã tồn tại trên hệ thống. Không thể tạo trùng lặp.');
      break;
    case 422:
      finalError = new Error(detailMessage || 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại các trường thông tin.');
      break;
    case 423:
      finalError = new Error(detailMessage || 'Tài khoản đang bị tạm khóa do nhập sai mật khẩu quá nhiều lần.');
      break;
    case 500:
      finalError = new Error(detailMessage || 'Lỗi máy chủ nội bộ. Vui lòng thử lại sau.');
      break;
    case 502:
    case 503:
    case 504:
      finalError = new Error(detailMessage || 'Dịch vụ backend hoặc cơ sở dữ liệu tạm thời không phản hồi. Vui lòng thử lại sau giây lát.');
      break;
    default:
      finalError = new Error(detailMessage || `Yêu cầu thất bại (${response.status}: ${response.statusText})`);
      break;
  }
  finalError.status = response.status;
  if (detail) {
    finalError.detail = detail;
    if (typeof detail === 'object') {
      finalError.code = detail.code;
      finalError.field = detail.field;
      finalError.duplicate_code = detail.duplicate_code;
      finalError.existing_id = detail.existing_id;
    }
  }
  return finalError;
}

export const adminApi = {
  /**
   * Đăng nhập Admin hoặc Viewer
   * Sử dụng cookie HttpOnly an toàn, không lưu mật khẩu hay token vào localStorage
   */
  async login(username, password) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      const data = await response.json();
      if (data.csrf_token) {
        setCsrfToken(data.csrf_token);
      }
      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Không thể kết nối đến máy chủ FastAPI. Vui lòng kiểm tra lại dịch vụ backend.');
      }
      throw err;
    }
  },

  /**
   * Lấy thông tin tài khoản hiện tại từ phiên đăng nhập (Cookie HttpOnly)
   * Trả về thông tin user hoặc null nếu chưa đăng nhập
   */
  async getMe() {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/me`, {
        method: 'GET',
        credentials: 'include'
      });

      if (response.status === 401) {
        return null;
      }

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        console.warn('[adminApi.getMe] Backend không phản hồi:', err);
        return null;
      }
      throw err;
    }
  },

  /**
   * Đăng xuất, hủy bỏ cookie phiên và CSRF
   */
  async logout() {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });

      setCsrfToken(null);

      if (!response.ok && response.status !== 401) {
        throw await handleResponseError(response);
      }

      return await response.json().catch(() => ({ message: 'Đăng xuất thành công' }));
    } catch (err) {
      setCsrfToken(null);
      throw err;
    }
  },

  /**
   * Lấy danh sách vùng trồng dành cho Quản trị viên (hỗ trợ phân trang, lọc, và include_deleted)
   */
  async getAdminRegions({ page = 1, pageSize = 20, msvt = '', loaiCay = '', thiTruong = '', includeDeleted = false } = {}) {
    try {
      const params = new URLSearchParams();
      if (page) params.append('page', String(page));
      if (pageSize) params.append('page_size', String(pageSize));
      if (msvt && msvt.trim()) params.append('msvt', msvt.trim());
      if (loaiCay && loaiCay.trim()) params.append('loai_cay', loaiCay.trim());
      if (thiTruong && thiTruong.trim()) params.append('thi_truong', thiTruong.trim());
      if (includeDeleted) params.append('include_deleted', 'true');

      const response = await fetch(`${BASE_URL}/api/admin/regions?${params.toString()}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối mạng khi tải danh sách vùng trồng quản trị.');
      }
      throw err;
    }
  },

  /**
   * Lấy chi tiết đầy đủ một vùng trồng cho quản trị viên (kể cả đã xóa mềm)
   */
  async getAdminRegionDetail(id) {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/regions/${id}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Lỗi kết nối khi tải chi tiết vùng trồng ID=${id}.`);
      }
      throw err;
    }
  },

  /**
   * Thêm mới vùng trồng MSVT (Admin)
   */
  async createRegion(payload) {
    try {
      const csrf = getCsrfToken();
      const headers = {
        'Content-Type': 'application/json'
      };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/regions`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối mạng khi tạo mới vùng trồng.');
      }
      throw err;
    }
  },

  /**
   * Cập nhật toàn bộ thông tin vùng trồng (PUT)
   */
  async updateRegion(id, payload) {
    try {
      const csrf = getCsrfToken();
      const headers = {
        'Content-Type': 'application/json'
      };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/regions/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Lỗi kết nối mạng khi cập nhật vùng trồng ID=${id}.`);
      }
      throw err;
    }
  },

  /**
   * Cập nhật từng phần thông tin vùng trồng (PATCH).
   * Nếu không truyền trường geometry, backend sẽ bảo toàn nguyên vẹn hình học cũ.
   */
  async patchRegion(id, payload) {
    try {
      const csrf = getCsrfToken();
      const headers = {
        'Content-Type': 'application/json'
      };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/regions/${id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Lỗi kết nối mạng khi cập nhật vùng trồng ID=${id}.`);
      }
      throw err;
    }
  },

  /**
   * Xóa mềm vùng trồng MSVT (DELETE)
   */
  async deleteRegion(id) {
    try {
      const csrf = getCsrfToken();
      const headers = {};
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/regions/${id}`, {
        method: 'DELETE',
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Lỗi kết nối mạng khi xóa vùng trồng ID=${id}.`);
      }
      throw err;
    }
  },

  /**
   * Kiểm tra tính hợp lệ hình học PostGIS và đối chiếu diện tích WGS84
   */
  async validateGeometry(geojson, declaredAreaHa) {
    try {
      const csrf = getCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/regions/validate-geometry`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          geojson,
          declared_area_ha: declaredAreaHa !== null && !isNaN(declaredAreaHa) ? Number(declaredAreaHa) : null
        })
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối mạng khi kiểm tra hình học với máy chủ.');
      }
      throw err;
    }
  },

  // ============================================================================
  // CÁC HÀM API NHẬP NHANH DỮ LIỆU MSVT TỪ EXCEL (ADMIN)
  // ============================================================================

  /**
   * Tải file Excel lên máy chủ để phân tích cấu trúc ban đầu
   */
  async uploadImportFile(file) {
    try {
      const csrf = getCsrfToken();
      const headers = {};
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${BASE_URL}/api/admin/imports/upload`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối khi tải tệp Excel lên máy chủ.');
      }
      throw err;
    }
  },

  /**
   * Chạy DRY RUN kiểm định toàn diện dữ liệu (không ghi database)
   */
  async validateImportJob(jobId, payload) {
    try {
      const csrf = getCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/validate`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối mạng khi gửi yêu cầu kiểm định dữ liệu.');
      }
      throw err;
    }
  },

  /**
   * Lấy danh sách kết quả kiểm định xem trước (Preview) có phân trang và bộ lọc
   */
  async getImportPreview(jobId, { page = 1, pageSize = 20, statusFilter = 'ALL', search = '' } = {}) {
    try {
      const params = new URLSearchParams();
      if (page) params.append('page', String(page));
      if (pageSize) params.append('page_size', String(pageSize));
      if (statusFilter && statusFilter !== 'ALL') params.append('status_filter', statusFilter);
      if (search && search.trim()) params.append('search', search.trim());

      const response = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/preview?${params.toString()}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối khi tải bảng xem trước kiểm định.');
      }
      throw err;
    }
  },

  /**
   * Lấy chi tiết một dòng dữ liệu kiểm định
   */
  async getImportRowDetail(jobId, rowId) {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/rows/${rowId}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Lỗi kết nối khi tải chi tiết dòng #${rowId}.`);
      }
      throw err;
    }
  },

  /**
   * Xác nhận commit các bản ghi được chọn vào PostgreSQL/PostGIS (Atomic)
   */
  async commitImportJob(jobId, { selectedRowIds = null, confirmWarnings = true } = {}) {
    try {
      const csrf = getCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }

      const response = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/commit`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          selected_row_ids: selectedRowIds,
          confirm_warnings: confirmWarnings
        })
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối mạng khi thực thi lưu dữ liệu vào cơ sở dữ liệu.');
      }
      throw err;
    }
  },

  /**
   * Tải tệp báo cáo kiểm định Excel 6 sheet (.xlsx)
   */
  async downloadImportReport(jobId, customFilename = null) {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/imports/${jobId}/report`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = customFilename || `Bao_cao_nhap_MSVT_${jobId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      return true;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối khi tải tệp báo cáo Excel.');
      }
      throw err;
    }
  },

  /**
   * Lấy lịch sử các phiên nhập liệu gần nhất
   */
  async getImportHistory(limit = 20) {
    try {
      const response = await fetch(`${BASE_URL}/api/admin/imports?limit=${limit}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối khi tải lịch sử phiên import.');
      }
      throw err;
    }
  },

  /**
   * [GIS] Kiểm định hình học và tính toán diện tích PostGIS WGS84 trực tiếp
   */
  async validateGeometry(geojson, declaredAreaHa = null) {
    try {
      const response = await fetch(`${BASE_URL}/api/regions/validate-geometry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          geojson,
          declared_area_ha: declaredAreaHa
        })
      });

      if (!response.ok) {
        throw await handleResponseError(response);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Lỗi kết nối khi kiểm tra tính hợp lệ hình học qua PostGIS.');
      }
      throw err;
    }
  }
};

export default adminApi;



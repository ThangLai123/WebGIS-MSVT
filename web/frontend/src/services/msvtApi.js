/**
 * msvtApi.js - Dịch vụ kết nối Frontend React với Backend FastAPI Quản lý Mã số Vùng trồng (MSVT)
 * Base URL qua Vite Proxy: /msvt-api (chuyển tiếp tới http://127.0.0.1:8000 khi chạy local)
 * Base URL qua Vercel Rewrites: /msvt-api (chuyển tiếp tới https://web-gis-msvt-9mx3.vercel.app khi chạy production)
 */

const BASE_URL = import.meta.env.VITE_MSVT_API_URL || '/msvt-api';
const DEFAULT_TIMEOUT_MS = 25000;

/**
 * Thực hiện gọi fetch với cơ chế timeout an toàn
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    });
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Hết thời gian chờ phản hồi từ máy chủ (Timeout). Vui lòng kiểm tra lại kết nối mạng.');
    }
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Không thể kết nối đến máy chủ API. Vui lòng kiểm tra lại dịch vụ backend hoặc kết nối mạng.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Phân tích lỗi HTTP response chuẩn mực tiếng Việt
 */
async function parseErrorResponse(response, defaultMsg) {
  let errorDetail = null;
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      errorDetail = data?.detail;
      if (Array.isArray(errorDetail)) {
        errorDetail = errorDetail.map(d => d.msg).join('; ');
      } else if (typeof errorDetail === 'object' && errorDetail !== null) {
        errorDetail = errorDetail.message || errorDetail.reason || JSON.stringify(errorDetail);
      }
    }
  } catch {
    errorDetail = null;
  }

  if (errorDetail) return new Error(errorDetail);

  switch (response.status) {
    case 401:
      return new Error('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
    case 403:
      return new Error('Bạn không có quyền truy cập dữ liệu này.');
    case 404:
      return new Error('Không tìm thấy dữ liệu vùng trồng yêu cầu.');
    case 422:
      return new Error('Dữ liệu yêu cầu không hợp lệ.');
    case 500:
      return new Error('Lỗi máy chủ nội bộ. Vui lòng thử lại sau.');
    case 502:
    case 503:
    case 504:
      return new Error('Dịch vụ cơ sở dữ liệu hoặc máy chủ backend tạm thời không phản hồi. Vui lòng thử lại sau giây lát.');
    default:
      return new Error(defaultMsg || `Yêu cầu thất bại (${response.status}: ${response.statusText})`);
  }
}

export const msvtApi = {
  /**
   * Lấy FeatureCollection GeoJSON của tất cả các vùng trồng có hình học hợp lệ (42 features).
   * Không chứa 9 bản ghi thiếu hình học và không chứa thông tin nhạy cảm (SĐT, Email).
   */
  async getGeoJSON() {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/regions/geojson`);
      if (!response.ok) {
        throw await parseErrorResponse(response, 'Lỗi máy chủ khi tải dữ liệu GeoJSON.');
      }
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('[msvtApi.getGeoJSON] Lỗi:', err);
      throw err;
    }
  },

  /**
   * Tra cứu không gian: Tìm kiếm các vùng trồng có ranh giới đa giác bao phủ tọa độ GPS (lat, lng).
   * Sử dụng hàm ST_Covers từ PostGIS. Không suy đoán vùng gần nhất.
   * @param {number|string} lat - Vĩ độ [-90, 90]
   * @param {number|string} lng - Kinh độ [-180, 180]
   * @returns {Promise<Array>} Danh sách các vùng trồng bao trùm điểm (hoặc rỗng nếu không có)
   */
  async lookupByCoordinates(lat, lng) {
    try {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);

      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        throw new Error('Tọa độ vĩ độ (lat) hoặc kinh độ (lng) không hợp lệ.');
      }
      if (parsedLat < -90 || parsedLat > 90) {
        throw new Error('Vĩ độ phải nằm trong khoảng từ -90 đến 90 độ.');
      }
      if (parsedLng < -180 || parsedLng > 180) {
        throw new Error('Kinh độ phải nằm trong khoảng từ -180 đến 180 độ.');
      }

      const url = `${BASE_URL}/api/regions/lookup?lat=${encodeURIComponent(parsedLat)}&lng=${encodeURIComponent(parsedLng)}`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw await parseErrorResponse(response, 'Lỗi khi tra cứu tọa độ vùng trồng.');
      }
      return await response.json();
    } catch (err) {
      console.error('[msvtApi.lookupByCoordinates] Lỗi:', err);
      throw err;
    }
  },

  /**
   * Lấy danh sách vùng trồng có phân trang và bộ lọc từ database PostGIS
   */
  async getRegions({ page = 1, pageSize = 50, msvt = '', loaiCay = '', thiTruong = '' } = {}) {
    try {
      const params = new URLSearchParams();
      if (page) params.append('page', String(page));
      if (pageSize) params.append('page_size', String(pageSize));
      if (msvt && msvt.trim()) params.append('msvt', msvt.trim());
      if (loaiCay && loaiCay.trim()) params.append('loai_cay', loaiCay.trim());
      if (thiTruong && thiTruong.trim()) params.append('thi_truong', thiTruong.trim());

      const response = await fetchWithTimeout(`${BASE_URL}/api/regions?${params.toString()}`);
      if (!response.ok) {
        throw await parseErrorResponse(response, 'Lỗi tải danh sách vùng trồng.');
      }
      return await response.json();
    } catch (err) {
      console.error('[msvtApi.getRegions] Lỗi:', err);
      throw err;
    }
  },

  /**
   * Lấy thông tin chi tiết một vùng trồng theo ID
   */
  async getRegionDetail(id) {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/regions/${id}`);
      if (!response.ok) {
        throw await parseErrorResponse(response, `Không tìm thấy vùng trồng ID=${id}.`);
      }
      return await response.json();
    } catch (err) {
      console.error(`[msvtApi.getRegionDetail] Lỗi ID=${id}:`, err);
      throw err;
    }
  },

  /**
   * Lấy thống kê số lượng vùng trồng, hình học và cây trồng
   */
  async getStatistics() {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/api/statistics`);
      if (!response.ok) {
        throw await parseErrorResponse(response, 'Lỗi tải thống kê vùng trồng.');
      }
      return await response.json();
    } catch (err) {
      console.error('[msvtApi.getStatistics] Lỗi:', err);
      throw err;
    }
  }
};

export default msvtApi;

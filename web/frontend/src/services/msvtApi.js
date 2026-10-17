/**
 * msvtApi.js - Dịch vụ kết nối Frontend React với Backend FastAPI Quản lý Mã số Vùng trồng (MSVT)
 * Base URL qua Vite Proxy: /msvt-api (chuyển tiếp tới http://127.0.0.1:8000)
 */

const BASE_URL = import.meta.env.VITE_MSVT_API_URL || '/msvt-api';

export const msvtApi = {
  /**
   * Lấy FeatureCollection GeoJSON của tất cả các vùng trồng có hình học hợp lệ (42 features).
   * Không chứa 9 bản ghi thiếu hình học và không chứa thông tin nhạy cảm (SĐT, Email).
   */
  async getGeoJSON() {
    try {
      const response = await fetch(`${BASE_URL}/api/regions/geojson`);
      if (!response.ok) {
        throw new Error(`Lỗi máy chủ khi tải GeoJSON (${response.status}: ${response.statusText})`);
      }
      return await response.json();
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
      const response = await fetch(url);
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || `Lỗi tra cứu tọa độ (${response.status})`);
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

      const response = await fetch(`${BASE_URL}/api/regions?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Lỗi tải danh sách vùng trồng (${response.status})`);
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
      const response = await fetch(`${BASE_URL}/api/regions/${id}`);
      if (!response.ok) {
        throw new Error(`Không tìm thấy vùng trồng ID=${id} (${response.status})`);
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
      const response = await fetch(`${BASE_URL}/api/statistics`);
      if (!response.ok) {
        throw new Error(`Lỗi tải thống kê vùng trồng (${response.status})`);
      }
      return await response.json();
    } catch (err) {
      console.error('[msvtApi.getStatistics] Lỗi:', err);
      throw err;
    }
  }
};

export default msvtApi;

/**
 * msvtZoomConfig.js
 * Cấu hình tập trung cho hiển thị Cartographic Visualization thích ứng theo Zoom
 * Dự án WebGIS Quản lý Mã số Vùng trồng (MSVT) tỉnh Nghệ An
 */

export const MSVT_ZOOM_CONFIG = {
  // 1. Phân tầng mức Zoom bản đồ
  ZOOM: {
    // Zoom <= 10: Chế độ Tổng quan (Overview) - Cluster gom nhóm, Point nhỏ, Polygon thu nhỏ hiển thị đại diện
    LOW_MAX: 10,
    // Zoom 11 - 13: Chế độ Chuyển tiếp (Mid) - Tách cụm, hiển thị ranh giới thật + đại diện cho đa giác nhỏ/hẹp
    MID_MIN: 11,
    MID_MAX: 13,
    // Zoom >= 14: Chế độ Chi tiết (Detail) - Hiển thị 100% ranh giới chính xác, hit test đầy đủ
    DETAILED_MIN: 14,
    // Mức Zoom tối đa khi tự động fitBounds vào 1 đối tượng
    MAX_FIT_ZOOM: 16,
  },

  // 2. Cấu hình phân cụm (Supercluster)
  CLUSTER: {
    // Bán kính gom cụm (pixel)
    RADIUS: 50,
    // Đến mức zoom 12 sẽ rã cụm hoàn toàn để xem từng đối tượng
    MAX_ZOOM: 11,
    // Số đối tượng tối thiểu để tạo thành 1 cụm
    MIN_POINTS: 2,
  },

  // 3. Ngưỡng kích thước đa giác để kích hoạt ký hiệu đại diện
  POLYGON: {
    // Nếu đường chéo Bounding Box trên màn hình < 28px, coi là polygon quá nhỏ/hẹp ở zoom hiện tại
    SMALL_BBOX_PX_THRESHOLD: 28,
  },

  // 4. Bảng màu chuẩn Cartographic WebGIS
  COLORS: {
    // Point: Màu XANH DƯƠNG (phân biệt hoàn toàn với Polygon xanh lá)
    POINT: {
      FILL: '#2563eb',          // Blue 600
      STROKE: '#ffffff',        // Trắng tương phản cao
      STROKE_DARK: '#1d4ed8',   // Blue 700
      HOVER_FILL: '#3b82f6',    // Blue 500
      STROKE_WEIGHT: 1.8,
    },

    // Polygon: Màu XANH LÁ chuẩn nông nghiệp
    POLYGON: {
      STROKE: '#15803d',        // Green 700
      STROKE_HOVER: '#166534',  // Green 800
      FILL: '#22c55e',          // Green 500
      FILL_OPACITY_DEFAULT: 0.28,
      FILL_OPACITY_HOVER: 0.45,
      STROKE_WEIGHT_DEFAULT: 2.2,
      STROKE_WEIGHT_HOVER: 3.2,
    },

    // Ký hiệu đại diện cho Đa giác nhỏ (Representative Marker - Green Diamond)
    REPRESENTATIVE: {
      FILL: '#16a34a',          // Green 600
      STROKE: '#ffffff',        // Trắng viền nét
      STROKE_DARK: '#15803d',   // Green 700
      ICON_COLOR: '#ffffff',
      SIZE: 22,                 // 22x22 px
    },

    // Trạng thái được chọn (Selected) - Vàng rực rỡ & Đỏ nổi bật
    SELECTED: {
      FILL: '#facc15',          // Gold 400
      STROKE: '#dc2626',        // Red 600
      FILL_OPACITY: 0.65,
      STROKE_WEIGHT: 3.5,
      POINT_RADIUS_BONUS: 3.5,
    },

    // Phân nhóm Cluster theo quy mô
    CLUSTER: {
      SMALL_BG: '#059669',     // Emerald 600
      MEDIUM_BG: '#047857',    // Emerald 700
      LARGE_BG: '#065f46',     // Emerald 800
      TEXT: '#ffffff',
      BORDER: '#ffffff',
    }
  }
};

/**
 * Hàm tính kích thước bán kính CircleMarker của Point theo mức Zoom bản đồ
 * Theo đúng hướng dẫn đề bài:
 * - Zoom <= 10: Radius 3–4 px (mặc định 3.5 px)
 * - Zoom 11–13: Radius 4–5 px (mặc định 4.8 px)
 * - Zoom >= 14: Radius 6–7 px (mặc định 6.5 px, Zoom >= 16: 7.2 px)
 *
 * @param {number} zoom Mức zoom hiện tại của bản đồ
 * @param {boolean} isSelected Trạng thái đang được chọn
 * @param {boolean} isHovered Trạng thái đang hover chuột
 * @returns {number} Bán kính điểm tính theo pixel
 */
export function getPointRadius(zoom, isSelected = false, isHovered = false) {
  let baseRadius = 3.5;

  if (zoom <= 10) {
    baseRadius = 3.5;
  } else if (zoom <= 13) {
    baseRadius = 4.8;
  } else if (zoom <= 15) {
    baseRadius = 6.5;
  } else {
    baseRadius = 7.2;
  }

  if (isSelected) {
    return baseRadius + MSVT_ZOOM_CONFIG.COLORS.SELECTED.POINT_RADIUS_BONUS;
  }
  if (isHovered) {
    return baseRadius + 1.8;
  }
  return baseRadius;
}

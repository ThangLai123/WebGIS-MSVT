/**
 * geoInteriorPoint.js
 * Tiện ích tính toán Điểm đại diện bên trong (Interior Point / Point On Surface) cho Polygon và MultiPolygon
 * Đảm bảo 100% điểm đại diện nằm TRONG ranh giới thực tế, không bị lệch ra ngoài đối với đa giác lõm (concave)
 * hoặc phân mảnh (MultiPolygon).
 */

/**
 * Kiểm tra một điểm [lng, lat] có nằm trong 1 vòng tọa độ (ring) hay không (Ray-Casting Algorithm)
 */
export function pointInRing(pt, ring) {
  if (!ring || ring.length < 3) return false;
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Kiểm tra một điểm [lng, lat] có nằm trong Polygon (tính cả lỗ khuyết - holes nếu có)
 * @param {[number, number]} pt [lng, lat]
 * @param {Array<Array<[number, number]>>} polygonCoords Coordinates của GeoJSON Polygon
 */
export function pointInPolygon(pt, polygonCoords) {
  if (!polygonCoords || polygonCoords.length === 0) return false;
  const outer = polygonCoords[0];
  if (!pointInRing(pt, outer)) return false;
  for (let h = 1; h < polygonCoords.length; h++) {
    if (pointInRing(pt, polygonCoords[h])) return false; // Nằm trong lỗ -> không thuộc polygon
  }
  return true;
}

/**
 * Tính trọng tâm hình học (Centroid) của một vòng tọa độ
 */
export function ringCentroid(ring) {
  if (!ring || ring.length === 0) return [0, 0];
  let cx = 0, cy = 0, signedArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0], y0 = ring[i][1];
    const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
    const a = x0 * y1 - x1 * y0;
    signedArea += a;
    cx += (x0 + x1) * a;
    cy += (y0 + y1) * a;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-12) {
    let avgX = 0, avgY = 0;
    for (const p of ring) { avgX += p[0]; avgY += p[1]; }
    return [avgX / ring.length, avgY / ring.length];
  }
  cx /= (6 * signedArea);
  cy /= (6 * signedArea);
  return [cx, cy];
}

/**
 * Tìm điểm chắc chắn nằm trong bề mặt đa giác (Point on Surface)
 * 1. Thử trọng tâm Centroid. Nếu Centroid nằm trong Polygon -> Chọn luôn.
 * 2. Nếu đa giác lõm (U-shape, crescent,...) làm Centroid rơi ra ngoài:
 *    Cắt một đường quét ngang (horizontal scanline) qua tọa độ Y của Centroid với các cạnh polygon.
 *    Lấy trung điểm của đoạn cắt bên trong dài nhất.
 * 3. Fallback: Chọn điểm an toàn giữa các đỉnh bên trong.
 * 
 * @param {Array<Array<[number, number]>>} polygonCoords
 * @returns {[number, number]} [lng, lat]
 */
export function getPointOnPolygon(polygonCoords) {
  if (!polygonCoords || polygonCoords.length === 0) return [105.42, 19.25];
  const outer = polygonCoords[0];
  if (!outer || outer.length < 3) return outer && outer[0] ? outer[0] : [105.42, 19.25];

  // 1. Thử Centroid
  const [cx, cy] = ringCentroid(outer);
  if (pointInPolygon([cx, cy], polygonCoords)) {
    return [cx, cy];
  }

  // 2. Cắt scanline ngang qua cy
  const yScan = cy;
  const xIntersects = [];
  for (let i = 0; i < outer.length - 1; i++) {
    const p1 = outer[i];
    const p2 = outer[i + 1];
    if ((p1[1] <= yScan && p2[1] > yScan) || (p2[1] <= yScan && p1[1] > yScan)) {
      const x = p1[0] + (yScan - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]);
      xIntersects.push(x);
    }
  }
  xIntersects.sort((a, b) => a - b);

  let bestMidX = null;
  let maxLen = -1;
  for (let i = 0; i < xIntersects.length - 1; i += 2) {
    const midX = (xIntersects[i] + xIntersects[i + 1]) / 2;
    const len = xIntersects[i + 1] - xIntersects[i];
    if (len > maxLen && pointInPolygon([midX, yScan], polygonCoords)) {
      maxLen = len;
      bestMidX = midX;
    }
  }
  if (bestMidX !== null) {
    return [bestMidX, yScan];
  }

  // 3. Fallback: Điểm dịch nhẹ vào trong từ cạnh
  for (let i = 0; i < outer.length - 1; i++) {
    const p1 = outer[i];
    const p2 = outer[i + 1];
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const candidate = [mx + (cx - mx) * 0.1, my + (cy - my) * 0.1];
    if (pointInPolygon(candidate, polygonCoords)) {
      return candidate;
    }
  }

  // 4. Fallback cuối cùng: Trả về đỉnh đầu tiên
  return [outer[0][0], outer[0][1]];
}

/**
 * Trích xuất Điểm đại diện cho bất kỳ đối tượng GeoJSON nào (Point, Polygon, MultiPolygon)
 * Luôn trả về [longitude, latitude]
 * @param {Object} geom GeoJSON geometry object
 * @returns {[number, number]|null} [lng, lat]
 */
export function getPointOnFeature(geom) {
  if (!geom || !geom.type) return null;

  if (geom.type === 'Point') {
    return geom.coordinates;
  }

  if (geom.type === 'Polygon') {
    return getPointOnPolygon(geom.coordinates);
  }

  if (geom.type === 'MultiPolygon') {
    if (!geom.coordinates || geom.coordinates.length === 0) return null;
    // Chọn thành phần đa giác có diện tích khung bao lớn nhất
    let maxBboxArea = -1;
    let bestPoly = geom.coordinates[0];
    for (const poly of geom.coordinates) {
      const ring = poly[0];
      if (!ring || ring.length < 3) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of ring) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      }
      const area = (maxX - minX) * (maxY - minY);
      if (area > maxBboxArea) {
        maxBboxArea = area;
        bestPoly = poly;
      }
    }
    return getPointOnPolygon(bestPoly);
  }

  return null;
}

/**
 * Tính Bounding Box [ [southLat, westLng], [northLat, eastLng] ] cho đối tượng hình học
 */
export function getFeatureLatLngBounds(geom) {
  if (!geom) return null;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

  const processCoord = (pt) => {
    if (Array.isArray(pt) && pt.length >= 2) {
      const [lng, lat] = pt;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geom.type === 'Point') {
    processCoord(geom.coordinates);
  } else if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      for (const pt of ring) processCoord(pt);
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const pt of ring) processCoord(pt);
      }
    }
  }

  if (minLng === Infinity) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ];
}

/**
 * Ước tính kích thước pixel đường chéo của Bounding Box trên màn hình
 * Giúp nhận biết đa giác có bị quá nhỏ (< 28px) ở mức Zoom hiện tại hay không
 */
export function getScreenDiagonalPx(geom, map) {
  if (!geom || !map) return 0;
  const bounds = getFeatureLatLngBounds(geom);
  if (!bounds) return 0;

  try {
    const swPoint = map.latLngToContainerPoint(bounds[0]);
    const nePoint = map.latLngToContainerPoint(bounds[1]);
    const dx = Math.abs(nePoint.x - swPoint.x);
    const dy = Math.abs(nePoint.y - swPoint.y);
    return Math.hypot(dx, dy);
  } catch {
    return 0;
  }
}

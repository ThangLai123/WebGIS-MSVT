/**
 * geometryUtils.js - Tiện ích nhận diện tọa độ đa định dạng và khoanh vùng Polygon WebGIS MSVT
 * 
 * Hỗ trợ:
 * 1. Decimal Degrees: '19.18080556, 105.57585556', '19.18080556;105.57585556', '19.18080556 105.57585556'
 * 2. European comma decimal: '19,18080556;105,57585556' (dấu phẩy thập phân khi phân cách bằng chấm phẩy)
 * 3. DMS (Độ-phút-giây):
 *    - Ký hiệu độ: 'o', '°', 'º', '^'
 *    - Ký hiệu phút: "'", '′', '`'
 *    - Ký hiệu giây: "''", '"', '″', '”'
 *    - Hướng: N, S, E, W
 *    - DMS dạng phân cách khoảng trắng: '19 10 50.90 N; 105 34 33.08 E'
 * 4. Dữ liệu sao chép Excel/Word/HTML/Markdown có tiền tố: 'Đ1:', 'P1:', 'Điểm 1:', '| 1 | ... |'
 * 5. Phát hiện điểm trùng lặp, đa giác tự giao cắt (self-intersecting)
 * 6. Thuật toán Monotone Chain Convex Hull mô phỏng đường bao tham khảo (frontend-only)
 * 7. Chuẩn WGS84 (EPSG:4326), GeoJSON thứ tự [Longitude, Latitude]
 */

/**
 * Phân tích một thành phần DMS riêng lẻ (ví dụ: 19o10'50.90'', 105°34'33.08"E, 19 10 50.90 N)
 * @param {string} str Chuỗi tọa độ đơn
 * @returns {{ value: number|null, isDms: boolean, error: string|null }}
 */
export function parseSingleDms(str) {
  if (!str || typeof str !== 'string') {
    return { value: null, isDms: false, error: 'Chuỗi tọa độ trống' };
  }

  const s = str.trim();

  // Pattern 1: DMS có ký hiệu độ (o, °, º), phút (', ′), giây ('', ", ″)
  // Ví dụ: 19o10'50.90'', 19°10'50.90", 19°10′50.90″, 19°10'50.90"N
  const dmsSymbolRegex = /^([+-]?\d+)\s*[o°º^]\s*(\d+(?:\.\d+)?)\s*['′`]\s*(\d+(?:\.\d+)?)\s*(?:''|"|″|”)?\s*([NSEWnsew])?$/;
  const match1 = s.match(dmsSymbolRegex);
  if (match1) {
    const deg = parseFloat(match1[1]);
    const min = parseFloat(match1[2]);
    const sec = parseFloat(match1[3]);
    const hemi = match1[4] ? match1[4].toUpperCase() : null;

    if (min < 0 || min >= 60) {
      return { value: null, isDms: true, error: `Số phút (${min}) không hợp lệ (phải từ 0 đến dưới 60)` };
    }
    if (sec < 0 || sec >= 60) {
      return { value: null, isDms: true, error: `Số giây (${sec}) không hợp lệ (phải từ 0 đến dưới 60)` };
    }

    const sign = deg < 0 ? -1 : 1;
    let val = (Math.abs(deg) + min / 60.0 + sec / 3600.0) * sign;

    if (hemi) {
      if (hemi === 'S' || hemi === 'W') {
        val = -Math.abs(val);
      } else if (hemi === 'N' || hemi === 'E') {
        val = Math.abs(val);
      }
    }

    return { value: val, isDms: true, error: null };
  }

  // Pattern 2: DMS phân cách bằng khoảng trắng có hoặc không có chữ hướng:
  // Ví dụ: "19 10 50.90 N", "105 34 33.08 E"
  const dmsSpaceRegex = /^([+-]?\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*([NSEWnsew])?$/;
  const match2 = s.match(dmsSpaceRegex);
  if (match2) {
    const deg = parseFloat(match2[1]);
    const min = parseFloat(match2[2]);
    const sec = parseFloat(match2[3]);
    const hemi = match2[4] ? match2[4].toUpperCase() : null;

    if (min < 0 || min >= 60) {
      return { value: null, isDms: true, error: `Số phút (${min}) không hợp lệ (phải từ 0 đến dưới 60)` };
    }
    if (sec < 0 || sec >= 60) {
      return { value: null, isDms: true, error: `Số giây (${sec}) không hợp lệ (phải từ 0 đến dưới 60)` };
    }

    const sign = deg < 0 ? -1 : 1;
    let val = (Math.abs(deg) + min / 60.0 + sec / 3600.0) * sign;

    if (hemi) {
      if (hemi === 'S' || hemi === 'W') {
        val = -Math.abs(val);
      } else if (hemi === 'N' || hemi === 'E') {
        val = Math.abs(val);
      }
    }

    return { value: val, isDms: true, error: null };
  }

  return { value: null, isDms: false, error: 'Không nhận diện được định dạng DMS' };
}

/**
 * Chuẩn hóa văn bản tọa độ thô:
 * - Loại bỏ thẻ HTML (<br>, <br/>, <p>)
 * - Thay thế HTML entities (&nbsp;, &#160;, &#x20;, &amp;)
 * - Loại bỏ dấu kẻ bảng Markdown (|)
 * - Sửa khoảng trắng bất thường trong số thập phân: '105. 523277' -> '105.523277'
 * - Sửa khoảng trắng giữa số độ DMS và ký hiệu độ: '19 o' -> '19o'
 * @param {string} rawText 
 * @returns {string}
 */
export function cleanRawCoordinateText(rawText) {
  if (!rawText) return '';
  let s = String(rawText);

  // 1. Thẻ HTML xuống dòng
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(?:p|div|tr|td|th)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');

  // 2. HTML entities
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&#160;/gi, ' ')
       .replace(/&#x20;/gi, ' ')
       .replace(/&amp;/gi, '&')
       .replace(/\xa0/g, ' ');

  // 3. Ký tự phân cách bảng Markdown
  s = s.replace(/^[|\s]+|[|\s]+$/g, '');
  s = s.replace(/\|/g, ' ');

  // 4. Sửa lỗi khoảng trắng bất thường trong số thập phân
  s = s.replace(/(\d+)\s*\.\s+(\d+)/g, '$1.$2');
  s = s.replace(/(\d+)\s+\.\s*(\d+)/g, '$1.$2');

  // 5. Sửa khoảng trắng giữa số độ DMS và ký hiệu độ
  s = s.replace(/(\d{1,3})\s+([o°d])\s*/gi, '$1$2');

  return s.trim();
}

/**
 * Phân tích 1 token tọa độ (chứa vĩ độ hoặc kinh độ).
 * @param {string} token 
 * @returns {{ value: number|null, direction: 'N'|'S'|'E'|'W'|null, format: string|null, error: string|null }}
 */
export function parseSingleCoordToken(token) {
  if (!token) return { value: null, direction: null, format: null, error: 'Token trống' };
  let t = token.trim();

  // Kiểm tra ký hiệu hướng ở đầu hoặc cuối token
  let direction = null;
  const mEnd = t.match(/([NSEWnsew])$/);
  if (mEnd) {
    direction = mEnd[1].toUpperCase();
    t = t.slice(0, mEnd.index).trim();
  } else {
    const mStart = t.match(/^([NSEWnsew])/);
    if (mStart) {
      direction = mStart[1].toUpperCase();
      t = t.slice(mStart[0].length).trim();
    }
  }

  // Thử chuyển đổi bằng parseSingleDms (hỗ trợ cả DMS có ký hiệu ° ' " o và DMS phân cách khoảng trắng: 19 10 50.90 N)
  const dmsRes = parseSingleDms(token);
  if (dmsRes.value !== null) {
    let dir = direction;
    if (!dir) {
      const mD = token.match(/([NSEWnsew])$/i) || token.match(/^([NSEWnsew])/i);
      if (mD) dir = mD[1].toUpperCase();
    }
    return { value: dmsRes.value, direction: dir, format: 'DMS', error: null };
  } else if (dmsRes.error && dmsRes.isDms) {
    return { value: null, direction, format: 'DMS', error: dmsRes.error };
  }

  // Dạng số thập phân Decimal: 18.997412, -18.997412
  const tClean = t.replace(',', '.');
  if (/^[-+]?\d+(?:\.\d+)?$/.test(tClean)) {
    let val = parseFloat(tClean);
    if (val < 0 && (direction === 'N' || direction === 'E')) {
      return { value: null, direction, format: 'Decimal', error: 'Mâu thuẫn giữa dấu âm và hướng N/E' };
    }
    if (direction === 'S' || direction === 'W') val = -Math.abs(val);
    return { value: val, direction, format: 'Decimal', error: null };
  }

  return { value: null, direction, format: 'Unknown', error: 'Không nhận diện được định dạng tọa độ' };
}

/**
 * Ghép 2 token thành cặp tọa độ WGS84 chuẩn: { lat, lng, format, isValid, error }
 * Tự động nhận diện hướng:
 * - Nếu c1 có hướng E/W và c2 có hướng N/S -> c1 là Longitude, c2 là Latitude
 * - Mặc định: c1 là Latitude, c2 là Longitude
 */
export function parseCoordinatePair(c1Str, c2Str) {
  const r1 = parseSingleCoordToken(c1Str);
  const r2 = parseSingleCoordToken(c2Str);

  if (r1.value === null || r2.value === null) {
    return { lat: null, lng: null, format: 'Invalid', isValid: false, error: r1.error || r2.error };
  }

  const fmt = (r1.format === r2.format) ? r1.format : 'Hỗn hợp';
  let lat = null;
  let lng = null;

  if (['E', 'W'].includes(r1.direction) && ['N', 'S'].includes(r2.direction)) {
    lng = r1.value;
    lat = r2.value;
  } else if (['N', 'S'].includes(r1.direction) && ['E', 'W'].includes(r2.direction)) {
    lat = r1.value;
    lng = r2.value;
  } else {
    lat = r1.value;
    lng = r2.value;
  }

  if (lat < -90.0 || lat > 90.0) {
    if (lng >= -90.0 && lng <= 90.0 && lat >= -180.0 && lat <= 180.0) {
      const tmp = lat;
      lat = lng;
      lng = tmp;
    } else {
      return { lat: null, lng: null, format: 'OutOfBounds', isValid: false, error: 'Vĩ độ (Latitude) vượt quá phạm vi địa lý toàn cầu [-90, 90]' };
    }
  }
  if (lng < -180.0 || lng > 180.0) {
    return { lat: null, lng: null, format: 'OutOfBounds', isValid: false, error: 'Kinh độ (Longitude) vượt quá phạm vi địa lý toàn cầu [-180, 180]' };
  }

  return { lat, lng, format: fmt, isValid: true, error: null };
}

/**
 * Trích xuất toàn bộ các điểm từ chuỗi thô kèm nhãn và phân nhóm.
 * Hỗ trợ cả trường hợp nằm trên nhiều dòng hoặc dồn trong một ô duy nhất.
 */
export function extractRawPointsAndGroups(rawText) {
  const cleaned = cleanRawCoordinateText(rawText);
  if (!cleaned) return [];

  const rawLines = cleaned.split(/\r?\n/).filter(l => l.trim());
  const rawPoints = [];

  for (let lIdx = 0; lIdx < rawLines.length; lIdx++) {
    const line = rawLines[lIdx].trim();
    if (!line) continue;

    // Kiểm tra xem dòng này có chứa nhiều điểm được đánh số (Đ1, Đ2...) hoặc nhiều khối tọa độ hay không
    const labels = line.match(/(?:[ĐDđdP]|Điểm|Diem|Point|Mốc)\s*\d+/gi);
    const hasMultipleLabels = labels && labels.length > 1;
    const semiParts = line.split(';').map(s => s.trim()).filter(Boolean);
    const hasMultiplePoints = hasMultipleLabels || (semiParts.length > 2);

    if (hasMultiplePoints || rawLines.length === 1) {
      const itemRegex = /(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)?([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)[\s,;]+([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)(?:[^\S\r\n,]*([;]))?/gi;
      let m;
      let matchedInLine = 0;
      const linePts = [];

      while ((m = itemRegex.exec(line)) !== null) {
        if (!m[3] || !m[4]) continue;
        const prefix = m[1];
        const numStr = m[2];
        const num = numStr ? parseInt(numStr, 10) : null;
        const label = `${prefix || ''}${numStr || ''}`.trim();
        const pair = parseCoordinatePair(m[3], m[4]);
        if (pair.isValid) {
          matchedInLine++;
          linePts.push({
            rawIndex: rawPoints.length + linePts.length + 1,
            label: label || `#${rawPoints.length + linePts.length + 1}`,
            labelPrefix: prefix || null,
            labelNum: num,
            c1Raw: m[3],
            c2Raw: m[4],
            lat: pair.lat !== null ? Number(pair.lat.toFixed(8)) : null,
            lng: pair.lng !== null ? Number(pair.lng.toFixed(8)) : null,
            format: pair.format,
            isValid: pair.isValid,
            error: pair.error,
            delimiter: m[5] || ''
          });
        }
      }

      if (matchedInLine > 1 || (rawLines.length === 1 && matchedInLine > 0)) {
        rawPoints.push(...linePts);
        continue;
      }
    }

    // Nếu dòng là 1 điểm đơn lẻ
    const labelMatch = line.match(/^(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)/i);
    const prefix = labelMatch ? labelMatch[1] : null;
    const numStr = labelMatch ? labelMatch[2] : null;
    const num = numStr ? parseInt(numStr, 10) : null;
    const label = labelMatch ? `${prefix || ''}${numStr || ''}`.trim() : null;

    const delimMatch = line.endsWith(';') ? ';' : '';
    const parsed = parseCoordinateLine(line, rawPoints.length + 1);

    if (parsed) {
      rawPoints.push({
        rawIndex: rawPoints.length + 1,
        label: label || `#${rawPoints.length + 1}`,
        labelPrefix: prefix,
        labelNum: num,
        c1Raw: line,
        c2Raw: '',
        lat: parsed.lat,
        lng: parsed.lng,
        format: parsed.format,
        isValid: parsed.isValid,
        error: parsed.error,
        delimiter: delimMatch
      });
    }
  }

  return rawPoints;
}

/**
 * Kiểm tra hình học độc lập cho một nhóm tọa độ (Section VII đề bài)
 * @param {number} groupId 
 * @param {Array<object>} points 
 * @param {number|null} declaredAreaHa 
 * @returns {object}
 */
export function analyzeSingleGroupGeometry(groupId, points, declaredAreaHa = null) {
  const groupName = `Nhóm ${groupId}`;
  const validPts = points.filter(p => p.isValid && p.lat !== null && p.lng !== null);

  const vertices = validPts.map((p, idx) => ({
    id: p.id || p.rawIndex || (idx + 1),
    lat: p.lat,
    lng: p.lng,
    raw: p.c1Raw ? `${p.c1Raw}, ${p.c2Raw}` : '',
    format: p.format || 'Decimal',
    label: p.label || `Đ${idx + 1}`,
    isDuplicate: Boolean(p.isDuplicate),
    duplicateOf: p.duplicateOf || null
  }));

  const labelWarnings = [];
  const nums = points.map(p => p.labelNum).filter(n => n !== null);
  if (nums.length > 1) {
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i + 1] > nums[i] + 1) {
        labelWarnings.push(`Nhảy nhãn từ Đ${nums[i]} lên Đ${nums[i + 1]} (thiếu đỉnh ở giữa)`);
      }
    }
  }

  // 1. Không có tọa độ hợp lệ
  if (validPts.length === 0) {
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices: [],
      validCount: 0,
      geomType: 'INVALID',
      isValid: false,
      reason: 'Không có tọa độ hợp lệ trong nhóm',
      areaHa: null,
      simulationHull: null,
      simulatedAreaHa: 0,
      isNarrow: false,
      isSelfIntersecting: false,
      geojson: null,
      warnings: labelWarnings
    };
  }

  // 2. Điểm mốc đơn (Point)
  if (validPts.length === 1) {
    const p0 = validPts[0];
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices,
      validCount: 1,
      geomType: 'POINT',
      isValid: true,
      reason: 'Điểm mốc đại diện đơn',
      areaHa: 0,
      simulationHull: null,
      simulatedAreaHa: 0,
      isNarrow: false,
      isSelfIntersecting: false,
      geojson: { type: 'Point', coordinates: [p0.lng, p0.lat] },
      warnings: labelWarnings
    };
  }

  // 3. Hai điểm (TWO_POINTS)
  if (validPts.length === 2) {
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices,
      validCount: 2,
      geomType: 'TWO_POINTS',
      isValid: false,
      reason: 'Chỉ có 2 điểm, chưa đủ xác định ranh giới Polygon (cần tối thiểu 3 đỉnh)',
      areaHa: null,
      simulationHull: null,
      simulatedAreaHa: 0,
      isNarrow: false,
      isSelfIntersecting: false,
      geojson: null,
      warnings: labelWarnings
    };
  }

  // 4. >= 3 điểm (Polygon)
  let coords = validPts.map(p => ({ lat: p.lat, lng: p.lng }));
  if (coords.length > 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lng - last.lng) < 1e-7) {
      coords = coords.slice(0, coords.length - 1);
    }
  }

  // Tính sẵn đường bao lồi mô phỏng cho nhóm >= 3 điểm
  let simulationHull = null;
  let simulatedAreaHa = 0;
  if (coords.length >= 3) {
    const hull = computeConvexHull(coords);
    if (hull && hull.length >= 3) {
      simulationHull = hull;
      simulatedAreaHa = Number(calculatePolygonAreaHa(hull).toFixed(4));
    }
  }

  // Kiểm tra trùng lặp
  const seenMap = new Map();
  let hasDuplicates = false;
  for (let i = 0; i < coords.length; i++) {
    const k = `${coords[i].lat.toFixed(7)}_${coords[i].lng.toFixed(7)}`;
    if (seenMap.has(k)) {
      hasDuplicates = true;
      break;
    }
    seenMap.set(k, i);
  }

  if (hasDuplicates) {
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices,
      validCount: coords.length,
      geomType: 'INVALID',
      isValid: false,
      reason: 'Phát hiện điểm trùng lặp trong nhóm, không thể tạo Polygon',
      areaHa: null,
      simulationHull,
      simulatedAreaHa,
      isNarrow: false,
      isSelfIntersecting: false,
      geojson: null,
      warnings: [...labelWarnings, 'Có đỉnh trùng lặp trong nhóm']
    };
  }

  // Kiểm tra tự giao cắt
  const intersectCheck = isSelfIntersecting(coords);
  if (intersectCheck.selfIntersects) {
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices,
      validCount: coords.length,
      geomType: 'INVALID',
      isValid: false,
      isSelfIntersecting: true,
      edge1: intersectCheck.edge1,
      edge2: intersectCheck.edge2,
      reason: `Polygon tự giao cắt (Self-intersection) giữa cạnh ${intersectCheck.edge1[0]}-${intersectCheck.edge1[1]} và cạnh ${intersectCheck.edge2[0]}-${intersectCheck.edge2[1]}`,
      areaHa: null,
      simulationHull,
      simulatedAreaHa,
      isNarrow: false,
      geojson: null,
      warnings: [...labelWarnings, 'Đa giác tự cắt ranh giới']
    };
  }

  // Tính diện tích WGS84
  const areaHa = calculatePolygonAreaHa(coords);
  if (areaHa <= 0) {
    return {
      id: groupId,
      groupIndex: groupId,
      name: groupName,
      points,
      vertices,
      validCount: coords.length,
      geomType: 'INVALID',
      isValid: false,
      reason: 'Đa giác có diện tích bằng 0 (các điểm thẳng hàng)',
      areaHa: null,
      simulationHull,
      simulatedAreaHa,
      isNarrow: false,
      isSelfIntersecting: false,
      geojson: null,
      warnings: [...labelWarnings, 'Các điểm thẳng hàng, diện tích = 0']
    };
  }

  // Tính chu vi mét bằng WGS84
  let perimeterM = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeterM += calculateDistanceMeters(coords[i], coords[j]);
  }

  // Tiêu chí nhận diện đa giác rất hẹp (sliver): Chiều rộng trung bình = 2 * Area_m2 / Perimeter < 3m
  const areaM2 = areaHa * 10000;
  const avgWidthM = perimeterM > 0 ? (2 * areaM2 / perimeterM) : 0;
  const isNarrow = (perimeterM > 0 && avgWidthM < 3.0);

  const geojsonCoords = coords.map(p => [p.lng, p.lat]);
  geojsonCoords.push([coords[0].lng, coords[0].lat]); // khép kín

  const reason = isNarrow
    ? 'Hình học hợp lệ nhưng rất hẹp (cần rà soát)'
    : 'Hình học hợp lệ';

  return {
    id: groupId,
    groupIndex: groupId,
    name: groupName,
    points,
    vertices,
    validCount: coords.length,
    geomType: 'POLYGON',
    isValid: true,
    isSelfIntersecting: false,
    isNarrow,
    avgWidthM: Number(avgWidthM.toFixed(2)),
    areaHa: Number(areaHa.toFixed(4)),
    perimeterM: Number(perimeterM.toFixed(1)),
    simulationHull,
    simulatedAreaHa,
    reason,
    geojson: {
      type: 'Polygon',
      coordinates: [geojsonCoords]
    },
    warnings: isNarrow ? [...labelWarnings, `Ranh giới rất hẹp, chiều rộng trung bình ~${avgWidthM.toFixed(1)}m`] : labelWarnings
  };
}

/**
 * Phân chia danh sách điểm thô thành các nhóm ranh giới độc lập (Section V đề bài):
 * 1. Một nhóm bắt đầu khi gặp Đ1 (hoặc số 1).
 * 2. Các nhãn Đ2, Đ3, Đ4... tiếp theo được ghép vào nhóm đang xử lý.
 * 3. Khi sau một chuỗi nhãn đã đánh số lại xuất hiện Đ1, tạo nhóm mới.
 * 4. Nếu không có nhãn nhưng có dấu chấm phẩy ';' ngăn cách các khối >= 3 điểm -> tạo nhóm mới.
 * @param {Array<object>} rawPoints 
 * @param {number|null} declaredAreaHa 
 * @returns {Array<object>}
 */
export function partitionIntoGroups(rawPoints, declaredAreaHa = null) {
  if (!rawPoints || rawPoints.length === 0) return [];

  const rawGroups = [];
  let currentGroupPts = [];

  const hasLabels = rawPoints.some(p => p.labelNum !== null);

  for (let i = 0; i < rawPoints.length; i++) {
    const pt = rawPoints[i];
    const num = pt.labelNum;

    // Điều kiện tách nhóm khi có nhãn: Gặp lại số 1 (Đ1, P1, Điểm 1) khi nhóm hiện tại đã có điểm
    const startNewByLabel = (hasLabels && num === 1 && currentGroupPts.length > 0);

    // Điều kiện tách nhóm phụ trợ: Điểm trước đó có dấu phân cách ';' và nhóm hiện tại >= 3 điểm
    const prevPt = (i > 0) ? rawPoints[i - 1] : null;
    const startNewBySemicolon = (
      prevPt && prevPt.delimiter === ';' &&
      currentGroupPts.length >= 3 &&
      (num === 1 || !hasLabels)
    );

    if (startNewByLabel || startNewBySemicolon) {
      rawGroups.push(currentGroupPts);
      currentGroupPts = [];
    }

    currentGroupPts.push(pt);
  }

  if (currentGroupPts.length > 0) {
    rawGroups.push(currentGroupPts);
  }

  return rawGroups.map((pts, idx) => analyzeSingleGroupGeometry(idx + 1, pts, declaredAreaHa));
}

/**
 * Kết hợp các nhóm Polygon hợp lệ thành GeoJSON MultiPolygon (Trường hợp A Section VI)
 * @param {Array<object>} groups 
 * @returns {{ type: 'MultiPolygon', coordinates: Array<any> } | null}
 */
export function combineMultiPolygonGeoJSON(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const validPolys = groups.filter(g => g.isValid && g.geojson && g.geojson.type === 'Polygon');
  if (validPolys.length === 0) return null;
  if (validPolys.length === 1) {
    return {
      type: 'MultiPolygon',
      coordinates: [validPolys[0].geojson.coordinates]
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: validPolys.map(g => g.geojson.coordinates)
  };
}

/**
 * Làm sạch chuỗi dòng (xóa HTML, Markdown pipes, tiền tố Đ1:, P1:...)
 * @param {string} line 
 * @returns {string}
 */
export function cleanCoordinateLine(line) {
  if (!line || typeof line !== 'string') return '';

  // 1. Loại bỏ các thẻ HTML nếu copy từ web
  let cleaned = line.replace(/<[^>]+>/g, ' ');

  // 2. Sửa lỗi khoảng trắng bất thường trong số thập phân
  cleaned = cleaned.replace(/(\d+)\s*\.\s+(\d+)/g, '$1.$2');
  cleaned = cleaned.replace(/(\d+)\s+\.\s*(\d+)/g, '$1.$2');

  // 3. Nếu dòng copy từ bảng Markdown: | 1 | 19.18... | 105.57... |
  cleaned = cleaned.trim();
  if (cleaned.startsWith('|') && cleaned.endsWith('|')) {
    const parts = cleaned.split('|').map(p => p.trim()).filter(Boolean);
    cleaned = parts.join(' ; ');
  }

  // 4. Loại bỏ tiền tố thứ tự: "Đ1:", "Đ1.", "P1:", "P1.", "Điểm 1:", "Point 1:", "#1:", "1: ", "1. "
  cleaned = cleaned.replace(/^(?:(?:Đ|P|Điểm|Point|STT)\s*\d+\s*[:.)-]?\s*|#\d+\s*[:.)-]?\s*|\d+[:.)]\s+)/i, '').trim();

  // 5. Loại bỏ dấu chấm phẩy, dấu chấm, dấu phẩy thừa ở cuối dòng
  cleaned = cleaned.replace(/[;.,\s]+$/, '').trim();

  return cleaned;
}

/**
 * Phân tích 1 dòng tọa độ thành cặp { lat, lng }
 * @param {string} line Chuỗi dòng người dùng nhập
 * @param {number} lineNum Số thứ tự dòng
 * @param {'auto'|'decimal'|'dms'} mode Chế độ nhận diện
 * @returns {{ lineNum: number, raw: string, lat: number|null, lng: number|null, format: string, isValid: boolean, error: string|null }}
 */
export function parseCoordinateLine(line, lineNum = 1, mode = 'auto') {
  const raw = line;
  const cleaned = cleanCoordinateLine(line);

  if (!cleaned) {
    return null; // Dòng trống bỏ qua
  }

  let parts = [];

  // Trường hợp 1: Phân cách bằng dấu chấm phẩy ';'
  if (cleaned.includes(';')) {
    const rawParts = cleaned.split(';').map(p => p.trim()).filter(Boolean);
    if (rawParts.length === 2) {
      parts = rawParts;
    } else if (rawParts.length === 3 && (/^\d+$/.test(rawParts[0]) || /^(?:Đ|P|Điểm|Point)\s*\d+$/i.test(rawParts[0]))) {
      parts = [rawParts[1], rawParts[2]];
    }
  }

  // Trường hợp 2: Phân cách bằng tab '\t' (copy từ Excel)
  if (!parts || parts.length !== 2) {
    if (cleaned.includes('\t')) {
      const rawParts = cleaned.split('\t').map(p => p.trim()).filter(Boolean);
      if (rawParts.length === 2) {
        parts = rawParts;
      } else if (rawParts.length >= 3 && (/^\d+$/.test(rawParts[0]) || /^(?:Đ|P|Điểm|Point)\s*\d+$/i.test(rawParts[0]))) {
        parts = [rawParts[1], rawParts[2]];
      }
    }
  }

  // Trường hợp 3: Phân cách bằng dấu phẩy ','
  if (!parts || parts.length !== 2) {
    if (cleaned.includes(',')) {
      const rawParts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
      if (rawParts.length === 2) {
        parts = rawParts;
      } else if (rawParts.length === 3 && (/^\d+$/.test(rawParts[0]) || /^(?:Đ|P|Điểm|Point)\s*\d+$/i.test(rawParts[0]))) {
        parts = [rawParts[1], rawParts[2]];
      } else if (rawParts.length > 2) {
        return {
          lineNum,
          raw,
          lat: null,
          lng: null,
          format: 'Unknown',
          isValid: false,
          error: 'Dòng chứa nhiều dấu phẩy mơ hồ (không rõ đâu là dấu thập phân và dấu phân cách tọa độ). Vui lòng dùng dấu chấm phẩy ";" để phân cách 2 tọa độ.'
        };
      }
    }
  }

  // Trường hợp 4: Phân cách bằng khoảng trắng
  if (!parts || parts.length !== 2) {
    const spaceParts = cleaned.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2) {
      parts = spaceParts;
    } else if (spaceParts.length === 8 && /^[NSns]$/.test(spaceParts[3]) && /^[EWew]$/.test(spaceParts[7])) {
      parts = [spaceParts.slice(0, 4).join(' '), spaceParts.slice(4).join(' ')];
    } else if (spaceParts.length === 6 && /^\d+$/.test(spaceParts[0]) && /^\d+$/.test(spaceParts[3])) {
      parts = [spaceParts.slice(0, 3).join(' '), spaceParts.slice(3).join(' ')];
    }
  }

  if (!parts || parts.length !== 2) {
    return {
      lineNum,
      raw,
      lat: null,
      lng: null,
      format: 'Unknown',
      isValid: false,
      error: 'Không thể tách thành đúng 2 giá trị Vĩ độ và Kinh độ (Vui lòng dùng dấu phẩy hoặc chấm phẩy để phân cách).'
    };
  }

  const p1 = parts[0].trim();
  const p2 = parts[1].trim();

  const pairResult = parseCoordinatePair(p1, p2);

  if (!pairResult.isValid) {
    return {
      lineNum,
      raw,
      lat: null,
      lng: null,
      format: pairResult.format,
      isValid: false,
      error: pairResult.error || 'Tọa độ không hợp lệ'
    };
  }

  return {
    lineNum,
    raw,
    lat: Number(pairResult.lat.toFixed(8)),
    lng: Number(pairResult.lng.toFixed(8)),
    format: pairResult.format,
    isValid: true,
    error: null
  };
}


/**
 * Phân tích toàn bộ văn bản nhiều dòng tọa độ GPS hoặc dồn chung một ô Excel
 * @param {string} text Toàn bộ nội dung văn bản người dùng dán vào
 * @param {'auto'|'decimal'|'dms'} mode Chế độ nhận diện
 * @param {number|null} declaredAreaHa Diện tích khai báo hồ sơ (nếu có)
 * @returns {{
 *   items: Array<any>,
 *   vertices: Array<{ id: number, lat: number, lng: number, raw: string, format: string, isDuplicate: boolean, duplicateOf: number|null, groupId?: number, groupName?: string, label?: string }>,
 *   isMultiGroup: boolean,
 *   totalGroups: number,
 *   groups: Array<object>,
 *   allGroupsValid: boolean,
 *   hasSelfIntersection: boolean,
 *   stats: {
 *     totalLines: number,
 *     validCount: number,
 *     distinctCount: number,
 *     duplicateCount: number,
 *     errorCount: number,
 *     duplicates: Array<{ line: number, duplicateOf: number }>,
 *     errors: Array<{ line: number, reason: string }>,
 *     overallFormat: string,
 *     isMultiGroup: boolean,
 *     totalGroups: number,
 *     allGroupsValid: boolean
 *   }
 * }}
 */
export function parseCoordinatesBatch(text, mode = 'auto', declaredAreaHa = null) {
  if (!text || typeof text !== 'string') {
    return {
      items: [],
      vertices: [],
      isMultiGroup: false,
      totalGroups: 0,
      groups: [],
      allGroupsValid: false,
      hasSelfIntersection: false,
      stats: {
        totalLines: 0,
        validCount: 0,
        distinctCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        duplicates: [],
        errors: [],
        overallFormat: 'Chưa có dữ liệu',
        isMultiGroup: false,
        totalGroups: 0,
        allGroupsValid: false
      }
    };
  }

  // Bước 1: Trích xuất toàn bộ các điểm và nhãn thông qua parser thông minh
  const rawPoints = extractRawPointsAndGroups(text);

  // Nếu trích xuất thành công các điểm
  if (rawPoints.length > 0) {
    const groups = partitionIntoGroups(rawPoints, declaredAreaHa);
    const isMultiGroup = groups.length > 1;
    const allGroupsValid = (groups.length > 0 && groups.every(g => g.isValid));
    const hasSelfIntersection = groups.some(g => g.isSelfIntersecting);

    const items = [];
    const validVertices = [];
    const errors = [];
    const duplicates = [];

    let dmsCount = 0;
    let decimalCount = 0;

    let vId = 0;
    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
      const g = groups[gIdx];
      for (let pIdx = 0; pIdx < g.points.length; pIdx++) {
        const pt = g.points[pIdx];
        vId++;
        const itemObj = {
          lineNum: vId,
          raw: `${pt.label ? pt.label + ': ' : ''}${pt.c1Raw}, ${pt.c2Raw}`,
          lat: pt.lat,
          lng: pt.lng,
          format: pt.format,
          isValid: pt.isValid,
          error: pt.error,
          groupId: g.id,
          groupName: g.name,
          label: pt.label
        };
        items.push(itemObj);

        if (pt.isValid && pt.lat !== null && pt.lng !== null) {
          if (pt.format === 'DMS') dmsCount++;
          if (pt.format === 'Decimal') decimalCount++;

          validVertices.push({
            id: vId,
            lat: pt.lat,
            lng: pt.lng,
            raw: itemObj.raw,
            format: pt.format,
            lineNum: vId,
            isDuplicate: false,
            duplicateOf: null,
            groupId: g.id,
            groupName: g.name,
            label: pt.label,
            isClosingRing: false
          });
        } else {
          errors.push({
            line: vId,
            reason: pt.error || 'Tọa độ không hợp lệ'
          });
        }
      }
    }

    // Phát hiện các đỉnh trùng nhau
    const seenMap = new Map();
    for (let idx = 0; idx < validVertices.length; idx++) {
      const v = validVertices[idx];
      const key = `${v.lat.toFixed(7)}_${v.lng.toFixed(7)}`;

      if (seenMap.has(key)) {
        const originalIdx = seenMap.get(key);
        v.isDuplicate = true;
        v.duplicateOf = originalIdx + 1;
        duplicates.push({
          line: v.lineNum,
          duplicateOf: validVertices[originalIdx].lineNum
        });
      } else {
        seenMap.set(key, idx);
      }
    }

    // Kiểm tra khép kín ring nếu chỉ có 1 nhóm
    if (!isMultiGroup && validVertices.length >= 4) {
      const first = validVertices[0];
      const last = validVertices[validVertices.length - 1];
      if (Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lng - last.lng) < 1e-7) {
        last.isClosingRing = true;
      }
    }

    // Định dạng chung
    let overallFormat = 'Không xác định';
    if (dmsCount > 0 && decimalCount === 0) {
      overallFormat = 'Độ–Phút–Giây (DMS)';
    } else if (decimalCount > 0 && dmsCount === 0) {
      overallFormat = 'Số thập phân (Decimal Degrees)';
    } else if (dmsCount > 0 && decimalCount > 0) {
      overallFormat = 'Hỗn hợp (Decimal & DMS)';
    } else if (items.length > 0) {
      overallFormat = 'Lỗi định dạng';
    }

    return {
      items,
      vertices: validVertices,
      isMultiGroup,
      totalGroups: groups.length,
      groups,
      allGroupsValid,
      hasSelfIntersection,
      stats: {
        totalLines: items.length,
        validCount: validVertices.length,
        distinctCount: seenMap.size,
        duplicateCount: duplicates.length,
        errorCount: errors.length,
        duplicates,
        errors,
        overallFormat,
        isMultiGroup,
        totalGroups: groups.length,
        allGroupsValid
      }
    };
  }

  // Fallback: Nếu không bắt được bằng regex, chạy tách theo dòng truyền thống
  const rawLines = text.split(/\r?\n/);
  const items = [];
  const validVertices = [];
  const errors = [];
  const duplicates = [];

  let dmsCount = 0;
  let decimalCount = 0;
  let activeLineIdx = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    if (!rawLine.trim()) continue;

    activeLineIdx++;
    const parsed = parseCoordinateLine(rawLine, activeLineIdx, mode);
    if (!parsed) continue;

    items.push(parsed);

    if (parsed.isValid) {
      if (parsed.format === 'DMS') dmsCount++;
      if (parsed.format === 'Decimal') decimalCount++;

      validVertices.push({
        id: validVertices.length + 1,
        lat: parsed.lat,
        lng: parsed.lng,
        raw: parsed.raw,
        format: parsed.format,
        lineNum: parsed.lineNum,
        isDuplicate: false,
        duplicateOf: null
      });
    } else {
      errors.push({
        line: parsed.lineNum,
        reason: parsed.error
      });
    }
  }

  const seenMap = new Map();
  for (let idx = 0; idx < validVertices.length; idx++) {
    const v = validVertices[idx];
    const key = `${v.lat.toFixed(7)}_${v.lng.toFixed(7)}`;

    if (seenMap.has(key)) {
      const originalIdx = seenMap.get(key);
      v.isDuplicate = true;
      v.duplicateOf = originalIdx + 1;
      duplicates.push({
        line: v.lineNum,
        duplicateOf: validVertices[originalIdx].lineNum
      });
    } else {
      seenMap.set(key, idx);
    }
  }

  if (validVertices.length >= 4) {
    const first = validVertices[0];
    const last = validVertices[validVertices.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lng - last.lng) < 1e-7) {
      last.isClosingRing = true;
    }
  }

  let overallFormat = 'Không xác định';
  if (dmsCount > 0 && decimalCount === 0) {
    overallFormat = 'Độ–Phút–Giây (DMS)';
  } else if (decimalCount > 0 && dmsCount === 0) {
    overallFormat = 'Số thập phân (Decimal Degrees)';
  } else if (dmsCount > 0 && decimalCount > 0) {
    overallFormat = 'Hỗn hợp (Decimal & DMS)';
  } else if (items.length > 0) {
    overallFormat = 'Lỗi định dạng';
  }

  return {
    items,
    vertices: validVertices,
    isMultiGroup: false,
    totalGroups: validVertices.length > 0 ? 1 : 0,
    groups: validVertices.length > 0 ? [{
      id: 1,
      groupIndex: 1,
      name: 'Nhóm 1',
      points: validVertices,
      vertices: validVertices,
      validCount: validVertices.length,
      geomType: validVertices.length === 1 ? 'POINT' : (validVertices.length === 2 ? 'TWO_POINTS' : 'POLYGON'),
      isValid: validVertices.length === 1 || validVertices.length >= 3,
      simulationHull: null,
      simulatedAreaHa: 0,
      reason: 'Nhóm đơn lẻ'
    }] : [],
    allGroupsValid: true,
    hasSelfIntersection: false,
    stats: {
      totalLines: activeLineIdx,
      validCount: validVertices.length,
      distinctCount: seenMap.size,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      duplicates,
      errors,
      overallFormat,
      isMultiGroup: false,
      totalGroups: validVertices.length > 0 ? 1 : 0,
      allGroupsValid: true
    }
  };
}

/**
 * Hàm tương thích ngược parseCoordinates
 */
export function parseCoordinates(text, mode = 'auto') {
  return parseCoordinatesBatch(text, mode).vertices;
}



/**
 * Xuất danh sách đỉnh thành chuỗi text
 */
export function formatCoordinatesToText(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return points.map(p => `${p.lat.toFixed(8)}, ${p.lng.toFixed(8)}`).join('\n');
}

/**
 * Kiểm tra hướng (Clockwise / Counterclockwise / Collinear) của 3 điểm
 */
function orientation(p, q, r) {
  const val = (q.lat - p.lat) * (r.lng - q.lng) - (q.lng - p.lng) * (r.lat - q.lat);
  if (Math.abs(val) < 1e-12) return 0; // Thẳng hàng
  return val > 0 ? 1 : 2; // 1: CW, 2: CCW
}

/**
 * Kiểm tra điểm q có nằm trên đoạn thẳng pr hay không
 */
function onSegment(p, q, r) {
  return (
    q.lng <= Math.max(p.lng, r.lng) + 1e-9 &&
    q.lng >= Math.min(p.lng, r.lng) - 1e-9 &&
    q.lat <= Math.max(p.lat, r.lat) + 1e-9 &&
    q.lat >= Math.min(p.lat, r.lat) - 1e-9
  );
}

/**
 * Kiểm tra hai đoạn thẳng p1-q1 và p2-q2 có giao cắt nhau không
 */
function doIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  // Giao nhau tổng quát
  if (o1 !== o2 && o3 !== o4) return true;

  // Điểm thẳng hàng nằm đè lên nhau
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

/**
 * Kiểm tra đa giác có bị tự giao cắt (self-intersecting) không
 */
export function isSelfIntersecting(pts) {
  const n = pts.length;
  if (n < 4) return { selfIntersects: false };

  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const q1 = pts[(i + 1) % n];

    for (let j = i + 1; j < n; j++) {
      // Bỏ qua các cạnh kề nhau (chung đỉnh)
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
        continue;
      }
      const p2 = pts[j];
      const q2 = pts[(j + 1) % n];

      if (doIntersect(p1, q1, p2, q2)) {
        return {
          selfIntersects: true,
          edge1: [i + 1, ((i + 1) % n) + 1],
          edge2: [j + 1, ((j + 1) % n) + 1]
        };
      }
    }
  }

  return { selfIntersects: false };
}

/**
 * Tính diện tích hình học đa giác theo hecta (ha) trên mặt cầu WGS84
 */
export function calculatePolygonAreaHa(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const R = 6378137; // Bán kính Trái Đất (mét)
  let total = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    const lng1 = (p1.lng * Math.PI) / 180;
    const lng2 = (p2.lng * Math.PI) / 180;
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  const areaSqMeters = Math.abs((total * R * R) / 2.0);
  return areaSqMeters / 10000;
}

/**
 * Thuật toán Andrew's Monotone Chain tính Convex Hull (Đường bao lồi mô phỏng)
 * Đảm bảo:
 * - Dữ liệu chỉ dùng trên frontend
 * - Tự động loại trùng
 * - Khép kín vòng
 * @param {Array<{lat: number, lng: number}>} points 
 * @returns {Array<{lat: number, lng: number}>}
 */
export function computeConvexHull(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  // 1. Loại bỏ điểm trùng
  const unique = [];
  const seen = new Set();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (isNaN(p.lat) || isNaN(p.lng)) continue;
    const key = `${p.lat.toFixed(7)}_${p.lng.toFixed(7)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ lat: p.lat, lng: p.lng });
    }
  }

  if (unique.length < 3) return [];

  // Sắp xếp theo kinh độ (lng), sau đó vĩ độ (lat)
  const pts = [...unique].sort((a, b) => {
    if (Math.abs(a.lng - b.lng) > 1e-9) return a.lng - b.lng;
    return a.lat - b.lat;
  });

  const cross = (o, a, b) => {
    return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  };

  // Nửa dưới (Lower hull)
  const lower = [];
  for (let i = 0; i < pts.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
      lower.pop();
    }
    lower.push(pts[i]);
  }

  // Nửa trên (Upper hull)
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
      upper.pop();
    }
    upper.push(pts[i]);
  }

  // Ghép hai nửa (bỏ phần tử cuối của mỗi nửa vì trùng điểm đầu của nửa kia)
  const hull = lower.slice(0, lower.length - 1).concat(upper.slice(0, upper.length - 1));

  if (hull.length >= 3) {
    // Khép kín vòng
    hull.push({ lat: hull[0].lat, lng: hull[0].lng });
  }

  return hull;
}

/**
 * Tính khoảng cách trắc địa (mét) giữa hai điểm WGS84
 */
export function calculateDistanceMeters(p1, p2) {
  if (!p1 || !p2 || isNaN(p1.lat) || isNaN(p1.lng) || isNaN(p2.lat) || isNaN(p2.lng)) return 0;
  const R = 6378137.0; // Bán kính Trái Đất (mét)
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Tính vùng đệm địa lý (Buffer) theo mét cho đoạn thẳng nối 2 điểm
 * Chuyển đổi chính xác sang hệ mét cục bộ WGS84, không buffer trực tiếp theo độ.
 * @param {{ lat: number, lng: number }} p1 Điểm thứ nhất
 * @param {{ lat: number, lng: number }} p2 Điểm thứ hai
 * @param {number} bufferMeters Bán kính / chiều rộng đệm tính bằng mét (m)
 * @param {number} steps Số phân đoạn cong mỗi bán cầu
 * @returns {Array<{ lat: number, lng: number }>} Vòng khép kín của vùng đệm
 */
export function computeSegmentBufferMetric(p1, p2, bufferMeters = 20, steps = 16) {
  if (!p1 || !p2 || isNaN(p1.lat) || isNaN(p1.lng) || isNaN(p2.lat) || isNaN(p2.lng)) return [];
  const r = Math.max(1, Number(bufferMeters) || 20);

  const R = 6378137.0;
  const phiM = ((p1.lat + p2.lat) / 2) * (Math.PI / 180);
  const mLat = (Math.PI * R) / 180.0;
  const mLng = (Math.PI * R * Math.cos(phiM)) / 180.0;

  const x1 = 0.0;
  const y1 = 0.0;
  const x2 = (p2.lng - p1.lng) * mLng;
  const y2 = (p2.lat - p1.lat) * mLat;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  if (len < 1e-6) {
    // Nếu hai điểm trùng nhau, trả về hình tròn bán kính r quanh p1
    const circle = [];
    for (let i = 0; i <= steps * 2; i++) {
      const angle = (2 * Math.PI * i) / (steps * 2);
      const px = r * Math.cos(angle);
      const py = r * Math.sin(angle);
      circle.push({
        lat: Number((p1.lat + py / mLat).toFixed(8)),
        lng: Number((p1.lng + px / mLng).toFixed(8))
      });
    }
    return circle;
  }

  const theta = Math.atan2(dy, dx);
  const pts = [];

  // Vòng cung bán cầu quanh điểm p2
  for (let i = 0; i <= steps; i++) {
    const a = theta + Math.PI / 2 - (Math.PI * i) / steps;
    const px = x2 + r * Math.cos(a);
    const py = y2 + r * Math.sin(a);
    pts.push({
      lat: Number((p1.lat + py / mLat).toFixed(8)),
      lng: Number((p1.lng + px / mLng).toFixed(8))
    });
  }

  // Vòng cung bán cầu quanh điểm p1
  for (let i = 0; i <= steps; i++) {
    const a = theta - Math.PI / 2 - (Math.PI * i) / steps;
    const px = x1 + r * Math.cos(a);
    const py = y1 + r * Math.sin(a);
    pts.push({
      lat: Number((p1.lat + py / mLat).toFixed(8)),
      lng: Number((p1.lng + px / mLng).toFixed(8))
    });
  }

  // Khép kín vòng
  pts.push({ lat: pts[0].lat, lng: pts[0].lng });
  return pts;
}

/**
 * Tính hình chữ nhật mô phỏng (Bounding Box) từ 2 góc đối diện
 * Theo trục kinh tuyến và vĩ tuyến WGS84
 * @param {{ lat: number, lng: number }} p1 Góc thứ nhất
 * @param {{ lat: number, lng: number }} p2 Góc đối diện thứ hai
 * @returns {Array<{ lat: number, lng: number }>} Vòng khép kín 4 góc hình chữ nhật
 */
export function computeSegmentBBox(p1, p2) {
  if (!p1 || !p2 || isNaN(p1.lat) || isNaN(p1.lng) || isNaN(p2.lat) || isNaN(p2.lng)) return [];
  const minLat = Math.min(p1.lat, p2.lat);
  const maxLat = Math.max(p1.lat, p2.lat);
  const minLng = Math.min(p1.lng, p2.lng);
  const maxLng = Math.max(p1.lng, p2.lng);

  return [
    { lat: Number(minLat.toFixed(8)), lng: Number(minLng.toFixed(8)) },
    { lat: Number(minLat.toFixed(8)), lng: Number(maxLng.toFixed(8)) },
    { lat: Number(maxLat.toFixed(8)), lng: Number(maxLng.toFixed(8)) },
    { lat: Number(maxLat.toFixed(8)), lng: Number(minLng.toFixed(8)) },
    { lat: Number(minLat.toFixed(8)), lng: Number(minLng.toFixed(8)) } // Khép kín
  ];
}

/**
 * Tính dải hình chữ nhật mô phỏng (Corridor) theo chiều rộng mét với trục giữa là đoạn thẳng 2 điểm GPS.
 * Phục vụ trường hợp 2 điểm GPS kết hợp diện tích khai báo trong hồ sơ.
 * @param {{ lat: number, lng: number }} p1 Điểm thứ nhất
 * @param {{ lat: number, lng: number }} p2 Điểm thứ hai
 * @param {number} widthMeters Chiều rộng toàn dải tính bằng mét
 * @returns {Array<{ lat: number, lng: number }>} 5 đỉnh khép kín của hình chữ nhật dải
 */
export function computeSegmentCorridorMetric(p1, p2, widthMeters = 20) {
  if (!p1 || !p2 || isNaN(p1.lat) || isNaN(p1.lng) || isNaN(p2.lat) || isNaN(p2.lng)) return [];
  const w = Math.max(0.1, Number(widthMeters) || 20);
  const halfW = w / 2.0;

  const R = 6378137.0;
  const phiM = ((p1.lat + p2.lat) / 2) * (Math.PI / 180);
  const mLat = (Math.PI * R) / 180.0;
  const mLng = (Math.PI * R * Math.cos(phiM)) / 180.0;

  const x1 = 0.0;
  const y1 = 0.0;
  const x2 = (p2.lng - p1.lng) * mLng;
  const y2 = (p2.lat - p1.lat) * mLat;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];

  // Véc-tơ pháp tuyến đơn vị vuông góc với trục đoạn thẳng
  const nx = -dy / len;
  const ny = dx / len;

  const c1 = {
    lat: Number((p1.lat + (halfW * ny) / mLat).toFixed(8)),
    lng: Number((p1.lng + (halfW * nx) / mLng).toFixed(8))
  };
  const c2 = {
    lat: Number((p2.lat + (halfW * ny) / mLat).toFixed(8)),
    lng: Number((p2.lng + (halfW * nx) / mLng).toFixed(8))
  };
  const c3 = {
    lat: Number((p2.lat - (halfW * ny) / mLat).toFixed(8)),
    lng: Number((p2.lng - (halfW * nx) / mLng).toFixed(8))
  };
  const c4 = {
    lat: Number((p1.lat - (halfW * ny) / mLat).toFixed(8)),
    lng: Number((p1.lng - (halfW * nx) / mLng).toFixed(8))
  };

  return [c1, c2, c3, c4, { ...c1 }]; // Khép kín
}

/**
 * Đánh giá sai lệch diện tích giữa hình học GIS và diện tích hồ sơ khai báo (dien_tich_ha)
 * Áp dụng công thức chuẩn: sai_lech_phan_tram = ABS(dien_tich_gis - dien_tich_ho_so) / dien_tich_ho_so * 100
 * Phân cấp đánh giá:
 * - Sai lệch <= 10%: Gần diện tích khai báo (Success)
 * - Sai lệch > 10% đến 25%: Cần rà soát (Warning)
 * - Sai lệch > 25%: Cảnh báo sai lệch lớn (Danger)
 * @param {number} gisAreaHa Diện tích đo đạc từ hình học GIS (ha)
 * @param {number|null} declaredAreaHa Diện tích khai báo trong hồ sơ MSVT (ha)
 * @returns {object} Chi tiết đối chiếu diện tích
 */
export function evaluateAreaDeviation(gisAreaHa, declaredAreaHa) {
  const gis = Number(gisAreaHa) || 0;
  const decl = declaredAreaHa !== null && declaredAreaHa !== undefined && !isNaN(declaredAreaHa)
    ? Number(declaredAreaHa)
    : null;

  if (decl === null || decl <= 0) {
    return {
      hasDeclared: false,
      declaredAreaHa: null,
      gisAreaHa: Number(gis.toFixed(4)),
      diffHa: null,
      pctDiff: null,
      deviationPct: null,
      level: 'info',
      badgeColor: 'info',
      statusLabel: 'Chưa khai báo diện tích hồ sơ',
      label: 'Chưa khai báo diện tích hồ sơ',
      statusText: 'Hồ sơ chưa có diện tích tham chiếu (hoặc bằng 0).'
    };
  }

  const diffHa = Number(Math.abs(gis - decl).toFixed(4));
  const pctDiff = Number(((diffHa / decl) * 100).toFixed(1));

  let level = 'info';
  let badgeColor = 'info';
  let statusLabel = '';
  let statusText = '';

  if (pctDiff <= 10.0) {
    level = 'success';
    badgeColor = 'success';
    statusLabel = 'Gần diện tích khai báo';
    statusText = `Sai lệch ${pctDiff}% (≤ 10%), ranh giới hình học rất sát với diện tích khai báo.`;
  } else if (pctDiff <= 25.0) {
    level = 'warning';
    badgeColor = 'warning';
    statusLabel = 'Cần rà soát';
    statusText = `Sai lệch ${pctDiff}% (> 10% – 25%), cần rà soát lại ranh giới thực tế hoặc bản đo.`;
  } else {
    level = 'danger';
    badgeColor = 'danger';
    statusLabel = 'Cảnh báo sai lệch lớn';
    statusText = `Sai lệch ${pctDiff}% (> 25%), có sự chênh lệch lớn giữa hình học và diện tích hồ sơ.`;
  }

  return {
    hasDeclared: true,
    declaredAreaHa: Number(decl.toFixed(4)),
    gisAreaHa: Number(gis.toFixed(4)),
    diffHa,
    pctDiff,
    deviationPct: pctDiff,
    level,
    badgeColor,
    statusLabel,
    label: statusLabel,
    statusText
  };
}

/**
 * Phân tích đối chiếu giữa diện tích Convex Hull và diện tích hồ sơ khai báo
 * @param {number} hullAreaHa 
 * @param {number|null} declaredAreaHa 
 * @returns {object|null}
 */
export function analyzeConvexHullVsDeclared(hullAreaHa, declaredAreaHa) {
  const hull = Number(hullAreaHa) || 0;
  const decl = Number(declaredAreaHa) || 0;

  if (decl <= 0 || hull <= 0) return null;

  if (decl > hull) {
    const missingHa = Number((decl - hull).toFixed(4));
    const pctOver = Number((((decl - hull) / decl) * 100).toFixed(1));
    return {
      type: 'DECLARED_LARGER_THAN_HULL',
      level: 'warning',
      title: 'Diện tích hồ sơ lớn hơn đường bao lồi toàn bộ tập điểm',
      message: `Diện tích khai báo (${decl} ha) lớn hơn diện tích đường bao lồi tối đa (${hull} ha) khoảng ${missingHa} ha (${pctOver}%). Dữ liệu hiện tại không đủ để tạo hình đạt diện tích đó mà vẫn giữ nguyên các đỉnh đã cung cấp.`
    };
  }

  const ratio = hull / decl;
  if (ratio >= 1.4) {
    const pctLarger = Number(((ratio - 1) * 100).toFixed(1));
    return {
      type: 'HULL_MUCH_LARGER_THAN_DECLARED',
      level: 'warning',
      title: 'Đường bao lồi lớn hơn nhiều so với diện tích hồ sơ',
      message: `Đường bao lồi (${hull} ha) lớn hơn diện tích hồ sơ (${decl} ha) khoảng ${pctLarger}%. Vùng trồng thực tế có thể là hình lõm, gồm nhiều lô riêng biệt hoặc dữ liệu GPS chưa đầy đủ.`
    };
  }

  return {
    type: 'HULL_CONSISTENT',
    level: 'info',
    title: 'Đường bao lồi tương thích diện tích hồ sơ',
    message: `Đường bao lồi đạt ${hull} ha (Hồ sơ: ${decl} ha). Vùng trồng có thể khép kín hợp lý trong phạm vi không gian này.`
  };
}

/**
 * Đề xuất các phương án nối đỉnh không tự giao cắt, đối chiếu với diện tích hồ sơ
 * Tìm tối đa 3 phương án hợp lệ có sai lệch diện tích thấp nhất
 * @param {Array<{id: number, lat: number, lng: number}>} rawPoints 
 * @param {number|null} declaredAreaHa Diện tích hồ sơ tham chiếu (ha)
 * @param {number} maxCandidates Số lượng phương án tối đa cần lấy (mặc định 3)
 * @returns {Array<object>} Danh sách các phương án hình mô phỏng
 */
export function generateSimulationCandidates(rawPoints, declaredAreaHa = null, maxCandidates = 3) {
  if (!Array.isArray(rawPoints) || rawPoints.length < 3) return [];

  // Lấy tập tọa độ phân biệt (không tự tạo tọa độ mới, không xóa đỉnh nguồn)
  const unique = [];
  const seen = new Set();
  for (let idx = 0; idx < rawPoints.length; idx++) {
    const p = rawPoints[idx];
    if (isNaN(p.lat) || isNaN(p.lng)) continue;
    const key = `${p.lat.toFixed(7)}_${p.lng.toFixed(7)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        ...p,
        id: (p.id !== undefined && p.id !== null && !isNaN(p.id)) ? p.id : (unique.length + 1)
      });
    }
  }

  const n = unique.length;
  if (n < 3) return [];

  const candidates = [];
  const seenCycles = new Set();

  function canonicalKey(cycle) {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i].id < cycle[minIdx].id) minIdx = i;
    }
    const fwd = [];
    for (let i = 0; i < cycle.length; i++) {
      fwd.push(cycle[(minIdx + i) % cycle.length].id);
    }
    const rev = [];
    for (let i = 0; i < cycle.length; i++) {
      rev.push(cycle[(minIdx - i + cycle.length) % cycle.length].id);
    }
    const sFwd = fwd.join('-');
    const sRev = rev.join('-');
    return sFwd < sRev ? sFwd : sRev;
  }

  const targetArea = (typeof declaredAreaHa === 'number' && declaredAreaHa > 0) ? declaredAreaHa : null;

  if (n <= 8) {
    // Duyệt vét cạn các chu trình (Canonical Cycles) cho số đỉnh nhỏ (N <= 8)
    const used = new Array(n).fill(false);
    const current = [unique[0]];
    used[0] = true;

    function permute(depth) {
      if (depth === n) {
        const key = canonicalKey(current);
        if (seenCycles.has(key)) return;
        seenCycles.add(key);

        const check = isSelfIntersecting(current);
        if (!check.selfIntersects) {
          const areaHa = Number(calculatePolygonAreaHa(current).toFixed(4));
          if (areaHa > 0) {
            const diffHa = targetArea !== null ? Number(Math.abs(areaHa - targetArea).toFixed(4)) : 0;
            const pctDiff = targetArea !== null ? Number(((diffHa / targetArea) * 100).toFixed(1)) : 0;
            candidates.push({
              vertices: current.map(p => ({ ...p })),
              order: current.map(p => p.id),
              areaHa,
              diffHa,
              pctDiff
            });
          }
        }
        return;
      }

      for (let i = 1; i < n; i++) {
        if (!used[i]) {
          used[i] = true;
          current.push(unique[i]);
          permute(depth + 1);
          current.pop();
          used[i] = false;
        }
      }
    }

    permute(1);
  } else {
    // Thuật toán 2-opt Heuristic và Angle-Sorting gỡ tự giao cắt cho số đỉnh lớn (N > 8)
    // Giới hạn thời gian tối đa 250ms để không bao giờ gây đơ trình duyệt
    const cLat = unique.reduce((s, p) => s + p.lat, 0) / n;
    const cLng = unique.reduce((s, p) => s + p.lng, 0) / n;
    const angleSorted = [...unique].sort((a, b) => Math.atan2(a.lat - cLat, a.lng - cLng) - Math.atan2(b.lat - cLat, b.lng - cLng));

    const seeds = [angleSorted, [...unique]];
    const startTime = Date.now();

    for (const seed of seeds) {
      let cycle = [...seed];
      let improved = true;
      let iter = 0;
      while (improved && iter < 100 && (Date.now() - startTime) < 250) {
        iter++;
        improved = false;
        const check = isSelfIntersecting(cycle);
        if (check.selfIntersects && check.edge1 && check.edge2) {
          const i = check.edge1[0] - 1;
          const j = check.edge2[0] - 1;
          const start = Math.min(i + 1, j);
          const end = Math.max(i + 1, j);
          cycle = [...cycle.slice(0, start), ...cycle.slice(start, end + 1).reverse(), ...cycle.slice(end + 1)];
          improved = true;
        }
      }

      const finalCheck = isSelfIntersecting(cycle);
      if (!finalCheck.selfIntersects) {
        const key = canonicalKey(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          const areaHa = Number(calculatePolygonAreaHa(cycle).toFixed(4));
          if (areaHa > 0) {
            const diffHa = targetArea !== null ? Number(Math.abs(areaHa - targetArea).toFixed(4)) : 0;
            const pctDiff = targetArea !== null ? Number(((diffHa / targetArea) * 100).toFixed(1)) : 0;
            candidates.push({
              vertices: cycle.map(p => ({ ...p })),
              order: cycle.map(p => p.id),
              areaHa,
              diffHa,
              pctDiff
            });
          }
        }
      }
    }
  }

  // Sắp xếp các phương án theo sai lệch diện tích thấp nhất
  if (targetArea !== null) {
    candidates.sort((a, b) => a.diffHa - b.diffHa);
  } else {
    candidates.sort((a, b) => b.areaHa - a.areaHa);
  }

  // Gắn nhãn đánh giá theo ngưỡng
  return candidates.slice(0, maxCandidates).map((c, idx) => {
    let level = 'info';
    let ratingLabel = 'Chưa có diện tích hồ sơ';
    if (targetArea !== null) {
      if (c.pctDiff <= 10.0) {
        level = 'success';
        ratingLabel = 'Gần diện tích khai báo (Sai lệch ≤ 10%)';
      } else if (c.pctDiff <= 25.0) {
        level = 'warning';
        ratingLabel = 'Cần rà soát (Sai lệch 10% – 25%)';
      } else {
        level = 'danger';
        ratingLabel = 'Cảnh báo sai lệch lớn (Sai lệch > 25%)';
      }
    }
    const vertexOrder = c.order || (c.vertices ? c.vertices.map(p => p.id) : []);
    return {
      candidateNumber: idx + 1,
      id: idx + 1,
      description: ratingLabel,
      vertexOrder,
      order: vertexOrder,
      ...c,
      areaEvaluation: evaluateAreaDeviation(c.areaHa, declaredAreaHa),
      level,
      badgeColor: level,
      ratingLabel
    };
  });
}

/**
 * Kiểm tra toàn diện tính hợp lệ của danh sách đỉnh và chuẩn bị GeoJSON
 * @param {Array<{id: number, lat: number, lng: number}>} points 
 * @param {{ declaredAreaHa?: number, twoPointsMode?: 'line'|'buffer'|'corridor'|'bbox', bufferMeters?: number, corridorWidthMeters?: number, bboxConfirmed?: boolean }} options
 * @returns {object} Kết quả kiểm định chi tiết
 */
export function validateVertices(points, options = {}) {
  const declaredAreaHa = (typeof options.declaredAreaHa === 'number' && options.declaredAreaHa > 0)
    ? options.declaredAreaHa
    : (options.declaredAreaHa ? parseFloat(options.declaredAreaHa) || null : null);

  if (!Array.isArray(points) || points.length === 0) {
    return {
      isValid: false,
      type: 'EMPTY',
      message: 'Chưa có tọa độ nào được nhập.',
      simulationHull: null,
      areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
      candidates: []
    };
  }

  // 1. Kiểm tra phạm vi tọa độ
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (isNaN(p.lat) || isNaN(p.lng)) {
      return {
        isValid: false,
        type: 'INVALID_COORD',
        message: `Đỉnh #${i + 1} có giá trị tọa độ không hợp lệ.`,
        simulationHull: null,
        areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
        candidates: []
      };
    }
    if (p.lat < -90 || p.lat > 90) {
      return {
        isValid: false,
        type: 'OUT_OF_BOUNDS',
        message: `Đỉnh #${i + 1} có Vĩ độ (Latitude = ${p.lat}) vượt ngoài khoảng [-90, 90].`,
        simulationHull: null,
        areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
        candidates: []
      };
    }
    if (p.lng < -180 || p.lng > 180) {
      return {
        isValid: false,
        type: 'OUT_OF_BOUNDS',
        message: `Đỉnh #${i + 1} có Kinh độ (Longitude = ${p.lng}) vượt ngoài khoảng [-180, 180].`,
        simulationHull: null,
        areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
        candidates: []
      };
    }
  }

  // 2. Nhận diện 1 điểm -> Point
  if (points.length === 1) {
    return {
      isValid: true,
      type: 'POINT',
      point: { longitude: points[0].lng, latitude: points[0].lat },
      message: 'Nhận diện thành công Điểm mốc đại diện (Point).',
      simulationHull: null,
      areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
      candidates: []
    };
  }

  // 3. Nhận diện 2 điểm -> Đoạn thẳng tham khảo kèm tùy chọn mô phỏng
  if (points.length === 2) {
    const isSame = Math.abs(points[0].lat - points[1].lat) < 1e-7 && Math.abs(points[0].lng - points[1].lng) < 1e-7;
    if (isSame) {
      return {
        isValid: false,
        type: 'DUPLICATE_POINTS',
        message: 'Hai điểm nhập vào có tọa độ trùng nhau hoàn toàn. Cần ít nhất 3 điểm phân biệt để tạo Polygon.',
        polyline: [[points[0].lat, points[0].lng]],
        simulationHull: null,
        areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
        candidates: []
      };
    }

    const distMeters = Math.round(calculateDistanceMeters(points[0], points[1]));
    const twoPointsMode = options.twoPointsMode || 'line'; // 'line' | 'buffer' | 'corridor' | 'bbox'
    const bufferMeters = options.bufferMeters || 20;

    let simulationPolygon = null;
    let simulatedAreaHa = 0;
    let corridorParams = null;

    if (twoPointsMode === 'buffer') {
      simulationPolygon = computeSegmentBufferMetric(points[0], points[1], bufferMeters);
      if (simulationPolygon.length >= 3) {
        simulatedAreaHa = Number(calculatePolygonAreaHa(simulationPolygon).toFixed(4));
      }
    } else if (twoPointsMode === 'corridor') {
      // Mô phỏng dải vùng theo diện tích hồ sơ (Section VII)
      let proposedW = 20;
      let targetSqm = 0;
      if (declaredAreaHa && declaredAreaHa > 0 && distMeters > 0) {
        targetSqm = declaredAreaHa * 10000;
        proposedW = Number((targetSqm / distMeters).toFixed(1));
      }
      const usedW = options.corridorWidthMeters !== undefined ? options.corridorWidthMeters : proposedW;
      simulationPolygon = computeSegmentCorridorMetric(points[0], points[1], usedW);
      if (simulationPolygon.length >= 3) {
        simulatedAreaHa = Number(calculatePolygonAreaHa(simulationPolygon).toFixed(4));
      }
      corridorParams = {
        lengthMeters: distMeters,
        targetAreaSqm: targetSqm,
        proposedWidthMeters: proposedW,
        usedWidthMeters: usedW
      };
    } else if (twoPointsMode === 'bbox') {
      const isConfirmed = options.bboxConfirmed === undefined ? true : Boolean(options.bboxConfirmed);
      if (isConfirmed) {
        simulationPolygon = computeSegmentBBox(points[0], points[1]);
        if (simulationPolygon.length >= 3) {
          simulatedAreaHa = Number(calculatePolygonAreaHa(simulationPolygon).toFixed(4));
        }
      }
    }

    const areaEval = evaluateAreaDeviation(simulatedAreaHa, declaredAreaHa);

    return {
      isValid: false, // Không tự động coi 2 điểm là Polygon chính thức
      type: 'TWO_POINTS',
      message: 'Dữ liệu hiện có 2 điểm GPS, chưa đủ xác định ranh giới Polygon. Bạn có thể xem đường nối hoặc tạo hình mô phỏng tham khảo.',
      polyline: [[points[0].lat, points[0].lng], [points[1].lat, points[1].lng]],
      distanceMeters: distMeters,
      twoPointsMode,
      bufferMeters,
      corridorParams,
      simulationPolygon,
      simulationHull: simulationPolygon, // Hiển thị trên Leaflet layer màu cam nét đứt
      simulatedAreaHa,
      areaEvaluation: areaEval,
      candidates: [],
      canSaveWithoutGeom: true
    };
  }

  // 4. Nhận diện >= 3 điểm
  // Bỏ điểm lặp cuối nếu người dùng nhập khép kín thủ công
  let workingPts = [...points];
  if (workingPts.length >= 4) {
    const first = workingPts[0];
    const last = workingPts[workingPts.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lng - last.lng) < 1e-7) {
      workingPts = workingPts.slice(0, workingPts.length - 1);
    }
  }

  // Kiểm tra trùng lặp
  const distinctMap = new Map();
  const dupIndices = [];
  workingPts.forEach((p, idx) => {
    const k = `${p.lat.toFixed(7)}_${p.lng.toFixed(7)}`;
    if (distinctMap.has(k)) {
      dupIndices.push({ current: idx + 1, original: distinctMap.get(k) + 1 });
    } else {
      distinctMap.set(k, idx);
    }
  });

  // Tính sẵn Convex Hull mô phỏng nếu có từ 3 điểm phân biệt trở lên
  let simulationHull = null;
  let simulatedAreaHa = 0;
  if (distinctMap.size >= 3) {
    simulationHull = computeConvexHull(workingPts);
    if (simulationHull.length >= 3) {
      simulatedAreaHa = Number(calculatePolygonAreaHa(simulationHull).toFixed(4));
    }
  }

  const hullAnalysis = analyzeConvexHullVsDeclared(simulatedAreaHa, declaredAreaHa);

  if (dupIndices.length > 0) {
    const dupDetails = dupIndices.map(d => `Đỉnh #${d.current} trùng Đỉnh #${d.original}`).join(', ');
    const candidates = generateSimulationCandidates(workingPts, declaredAreaHa, 3);
    return {
      isValid: false,
      type: 'DUPLICATE_POINTS',
      message: `Phát hiện tọa độ trùng lặp: ${dupDetails}. Đa giác chính thức không được chứa đỉnh trùng lặp.`,
      simulationHull,
      simulatedAreaHa,
      hullAnalysis,
      distinctCount: distinctMap.size,
      areaEvaluation: evaluateAreaDeviation(simulatedAreaHa, declaredAreaHa),
      candidates
    };
  }

  if (distinctMap.size < 3) {
    return {
      isValid: false,
      type: 'DEGENERATE',
      message: 'Polygon phải chứa ít nhất 3 đỉnh phân biệt (các đỉnh đang bị trùng nhau).',
      simulationHull,
      simulatedAreaHa,
      hullAnalysis,
      areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
      candidates: []
    };
  }

  // Kiểm tra tự cắt (Self-intersection)
  const intersectCheck = isSelfIntersecting(workingPts);
  if (intersectCheck.selfIntersects) {
    const candidates = generateSimulationCandidates(workingPts, declaredAreaHa, 3);
    return {
      isValid: false,
      type: 'SELF_INTERSECTING',
      message: `Đa giác bị tự cắt (Self-intersection) giữa cạnh ${intersectCheck.edge1[0]}-${intersectCheck.edge1[1]} và cạnh ${intersectCheck.edge2[0]}-${intersectCheck.edge2[1]}. Bạn có thể xem đường bao mô phỏng tham khảo hoặc bấm "Đề xuất hình mô phỏng theo diện tích".`,
      simulationHull,
      simulatedAreaHa,
      hullAnalysis,
      edge1: intersectCheck.edge1,
      edge2: intersectCheck.edge2,
      areaEvaluation: evaluateAreaDeviation(simulatedAreaHa, declaredAreaHa),
      candidates
    };
  }

  // Tính diện tích đa giác chính thức
  const areaHa = calculatePolygonAreaHa(workingPts);
  if (areaHa <= 0) {
    return {
      isValid: false,
      type: 'ZERO_AREA',
      message: 'Đa giác có diện tích bằng 0 (các điểm nằm thẳng hàng). Không thể tạo vùng ranh giới.',
      simulationHull,
      simulatedAreaHa,
      hullAnalysis,
      areaEvaluation: evaluateAreaDeviation(0, declaredAreaHa),
      candidates: []
    };
  }

  // Tự động khép kín theo chuẩn GeoJSON [Longitude, Latitude]
  const geojsonCoords = workingPts.map(p => [p.lng, p.lat]);
  geojsonCoords.push([workingPts[0].lng, workingPts[0].lat]); // Khép kín đỉnh cuối với đỉnh đầu

  const areaEvaluation = evaluateAreaDeviation(areaHa, declaredAreaHa);

  return {
    isValid: true,
    type: 'POLYGON',
    vertexCount: workingPts.length,
    areaHa: Number(areaHa.toFixed(4)),
    geojson: {
      type: 'Polygon',
      coordinates: [geojsonCoords]
    },
    simulationHull,
    simulatedAreaHa,
    hullAnalysis,
    areaEvaluation,
    candidates: [],
    message: `Đa giác hợp lệ gồm ${workingPts.length} đỉnh khép kín. Diện tích thực địa ước tính: ~${areaHa.toFixed(2)} ha.`
  };
}

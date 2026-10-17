function cleanRawCoordinateText(rawText) {
  if (!rawText) return '';
  let s = String(rawText);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(?:p|div|tr|td|th)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&#160;/gi, ' ').replace(/&#x20;/gi, ' ').replace(/&amp;/gi, '&').replace(/\xa0/g, ' ');
  s = s.replace(/^[|\s]+|[|\s]+$/g, '').replace(/\|/g, ' ');
  s = s.replace(/(\d+)\s*\.\s+(\d+)/g, '$1.$2');
  s = s.replace(/(\d+)\s+\.\s*(\d+)/g, '$1.$2');
  s = s.replace(/(\d{1,3})\s+([o°d])\s*/gi, '$1$2');
  return s.trim();
}

function parseSingleCoordToken(token) {
  if (!token) return { value: null, direction: null, format: null, error: 'Token trống' };
  let t = token.trim();
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

  const mDms = t.match(/^(\d{1,3})[o°º^d]\s*(\d{1,2})['’′`]\s*(\d{1,2}(?:[.,]\d+)?)['"”″]*$/i);
  if (mDms) {
    const deg = parseFloat(mDms[1]);
    const min = parseFloat(mDms[2]);
    const sec = parseFloat(mDms[3].replace(',', '.'));
    if (min >= 60 || sec >= 60) {
      return { value: null, direction, format: 'DMS', error: 'Số phút hoặc giây không hợp lệ (phải < 60)' };
    }
    let val = deg + min / 60.0 + sec / 3600.0;
    if (direction === 'S' || direction === 'W') val = -val;
    return { value: val, direction, format: 'DMS', error: null };
  }

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

function parseCoordinatePair(c1Str, c2Str) {
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

  if (lat < -90.0 || lat > 90.0 || lng < -180.0 || lng > 180.0) {
    if (lng >= -90.0 && lng <= 90.0 && lat >= -180.0 && lat <= 180.0) {
      const tmp = lat;
      lat = lng;
      lng = tmp;
    } else {
      return { lat: null, lng: null, format: 'OutOfBounds', isValid: false, error: 'Tọa độ ngoài phạm vi WGS84' };
    }
  }
  return { lat, lng, format: fmt, isValid: true, error: null };
}

function extractRawPointsAndGroups(rawText) {
  const cleaned = cleanRawCoordinateText(rawText);
  if (!cleaned) return [];
  const itemRegex = /(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)?([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)[\s,;]+([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)(?:[^\S\r\n,]*([;]))?/gi;
  const rawPoints = [];
  let m;
  let idx = 0;
  while ((m = itemRegex.exec(cleaned)) !== null) {
    const prefix = m[1];
    const numStr = m[2];
    const c1 = m[3];
    const c2 = m[4];
    const delimiter = m[5] || '';
    if (!c1 || !c2) continue;
    idx++;
    const num = numStr ? parseInt(numStr, 10) : null;
    const label = `${prefix || ''}${numStr || ''}`.trim() || `#${idx}`;
    const pair = parseCoordinatePair(c1, c2);
    rawPoints.push({
      rawIndex: idx,
      label,
      labelPrefix: prefix || null,
      labelNum: num,
      c1Raw: c1,
      c2Raw: c2,
      lat: pair.lat !== null ? Number(pair.lat.toFixed(8)) : null,
      lng: pair.lng !== null ? Number(pair.lng.toFixed(8)) : null,
      format: pair.format,
      isValid: pair.isValid,
      error: pair.error,
      delimiter
    });
  }
  return rawPoints;
}

// Test cases
console.log('Test 1 (Standard):', extractRawPointsAndGroups('19.18080556, 105.57585556\n18.962467, 105.439265').length);
console.log('Test 2 (DMS):', extractRawPointsAndGroups("19o10'50.90'';105o34'33.08''\n19o10'50.92'';105o34'29.94''").length);
console.log('Test 3 (European ;):', extractRawPointsAndGroups("19,18080556;105,57585556").length);
console.log('Test 4 (Reversed with N/E):', extractRawPointsAndGroups("105.52339 E, 18.997412 N")[0]);

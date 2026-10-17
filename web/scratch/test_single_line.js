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
      return { value: null, direction, format: 'DMS', error: `Số phút (${min}) hoặc giây (${sec}) không hợp lệ (phải từ 0 đến dưới 60)` };
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

const lineJ1 = parseCoordinatePair("19o65'50.90''", "105o34'33.08''");
console.log('lineJ1:', lineJ1);
console.log('lineJ1 error includes phút:', lineJ1.error.includes('phút'));

const lineJ2 = parseCoordinatePair("95.1234", "105.5678");
console.log('lineJ2:', lineJ2);
console.log('lineJ2 error includes Vĩ độ:', lineJ2.error.includes('Vĩ độ'));

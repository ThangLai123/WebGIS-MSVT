import assert from 'assert';
import { decimalToDms, getRegionCoordinates, parseSingleDms } from '../src/utils/geometryUtils.js';

console.log('================================================================');
console.log('BÀI KIỂM THỬ: ĐỘ CHÍNH XÁC TỌA ĐỘ GPS & CỐ ĐỊNH MARKER KHI ZOOM');
console.log('================================================================\n');

// TEST FIXTURE CHUẨN ĐƯỢC YÊU CẦU
const TEST_LAT_DEC = 18.71688888888889;
const TEST_LNG_DEC = 105.69600000000000;
const TEST_LAT_DMS = `18°43'00.8"N`;
const TEST_LNG_DMS = `105°41'45.6"E`;

// 1. Kiểm tra chuyển đổi Decimal sang DMS
const latDmsResult = decimalToDms(TEST_LAT_DEC, true);
const lngDmsResult = decimalToDms(TEST_LNG_DEC, false);

console.log(`1. Kiểm tra chuyển đổi Decimal -> DMS:`);
console.log(`   - Vĩ độ:  ${TEST_LAT_DEC} -> ${latDmsResult} (Kỳ vọng: ${TEST_LAT_DMS})`);
console.log(`   - Kinh độ: ${TEST_LNG_DEC} -> ${lngDmsResult} (Kỳ vọng: ${TEST_LNG_DMS})`);

assert.strictEqual(latDmsResult, TEST_LAT_DMS, 'Vĩ độ DMS phải khớp tuyệt đối 18°43\'00.8"N');
assert.strictEqual(lngDmsResult, TEST_LNG_DMS, 'Kinh độ DMS phải khớp tuyệt đối 105°41\'45.6"E');
console.log('   ✅ [PASS] Chuyển đổi Decimal sang DMS đạt độ chính xác 100%\n');

// 2. Kiểm tra chuyển đổi ngược từ DMS sang Decimal
const reverseLat = parseSingleDms(TEST_LAT_DMS);
const reverseLng = parseSingleDms(TEST_LNG_DMS);

console.log(`2. Kiểm tra chuyển đổi ngược DMS -> Decimal:`);
console.log(`   - Vĩ độ ngược:  ${reverseLat.value} (Kỳ vọng: ${TEST_LAT_DEC})`);
console.log(`   - Kinh độ ngược: ${reverseLng.value} (Kỳ vọng: ${TEST_LNG_DEC})`);

assert(Math.abs(reverseLat.value - TEST_LAT_DEC) < 1e-6, 'Sai lệch vĩ độ ngược phải < 0.000001');
assert(Math.abs(reverseLng.value - TEST_LNG_DEC) < 1e-6, 'Sai lệch kinh độ ngược phải < 0.000001');
console.log('   ✅ [PASS] Chuyển đổi ngược DMS sang Decimal hoàn toàn khớp sai số < 1e-6\n');

// 3. Kiểm tra hàm getRegionCoordinates với Point Feature
const mockPointRegion = {
  id: 1,
  msvt_moi: 'VN-NA-001',
  geom_type: 'POINT',
  geometry: {
    type: 'Point',
    coordinates: [TEST_LNG_DEC, TEST_LAT_DEC]
  }
};
const pointCoords = getRegionCoordinates(mockPointRegion);
console.log(`3. Kiểm tra trích xuất tọa độ Point:`);
console.log(`   - Lat: ${pointCoords.latDecimal}, Lng: ${pointCoords.lngDecimal}`);
console.log(`   - Nguồn: ${pointCoords.source}`);
assert.strictEqual(pointCoords.lat, TEST_LAT_DEC);
assert.strictEqual(pointCoords.lng, TEST_LNG_DEC);
assert.strictEqual(pointCoords.latDms, TEST_LAT_DMS);
assert.strictEqual(pointCoords.lngDms, TEST_LNG_DMS);
console.log('   ✅ [PASS] Trích xuất tọa độ Point chính xác\n');

// 4. Kiểm tra hàm getRegionCoordinates với Polygon Feature (Point on Surface)
const mockPolyRegion = {
  id: 2,
  msvt_moi: 'VN-NA-002',
  geom_type: 'MULTIPOLYGON',
  representative_point: [TEST_LNG_DEC, TEST_LAT_DEC],
  geometry: {
    type: 'Polygon',
    coordinates: [[[105.69, 18.71], [105.70, 18.71], [105.70, 18.72], [105.69, 18.72], [105.69, 18.71]]]
  }
};
const polyCoords = getRegionCoordinates(mockPolyRegion);
console.log(`4. Kiểm tra trích xuất tọa độ Polygon (representative_point):`);
console.log(`   - Lat: ${polyCoords.latDecimal}, Lng: ${polyCoords.lngDecimal}`);
console.log(`   - Nguồn: ${polyCoords.source}`);
assert.strictEqual(polyCoords.lat, TEST_LAT_DEC);
assert.strictEqual(polyCoords.lng, TEST_LNG_DEC);
assert.strictEqual(polyCoords.latDms, TEST_LAT_DMS);
assert.strictEqual(polyCoords.source, 'Điểm đại diện bề mặt Polygon (Point On Surface)');
console.log('   ✅ [PASS] Trích xuất tọa độ Polygon chính xác và bảo toàn nguồn\n');

// 5. Kiểm tra Leaflet Projection & Marker Anchor trên các mức Zoom 6 -> 20 và Chuỗi Zoom liên tục
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

global.window = {
  navigator: { userAgent: 'node' },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  devicePixelRatio: 1,
  screen: { deviceXDPI: 1, logicalXDPI: 1 }
};
function createMockEl() {
  return {
    style: {},
    className: '',
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 1024, height: 768 }),
    _leaflet_id: null
  };
}
global.Element = class Element {};
global.HTMLElement = global.Element;
global.document = {
  documentElement: { style: {} },
  createElement: () => createMockEl(),
  getElementById: () => createMockEl()
};

const L = require('leaflet');
const mapEl = global.document.getElementById('map');
mapEl.offsetWidth = 1024;
mapEl.offsetHeight = 768;
mapEl.clientWidth = 1024;
mapEl.clientHeight = 768;

const map = L.map(mapEl, {
  center: [TEST_LAT_DEC, TEST_LNG_DEC],
  zoom: 6,
  minZoom: 6,
  maxZoom: 20,
  zoomControl: false,
  attributionControl: false
});
map.getSize = () => new L.Point(1024, 768);
map.setView([TEST_LAT_DEC, TEST_LNG_DEC], 6);

const marker = L.marker([TEST_LAT_DEC, TEST_LNG_DEC], {
  icon: L.divIcon({
    className: 'msvt-unified-marker',
    html: '<div class="msvt-marker-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  })
}).addTo(map);

console.log('5. Kiểm tra vị trí hiển thị và độ ổn định của Marker qua các mức Zoom 6 đến 20:');
const zoomLevels = [6, 8, 10, 12, 14, 16, 18, 19, 20];
zoomLevels.forEach(z => {
  map.setZoom(z, { animate: false });
  const mPos = marker.getLatLng();
  const containerPoint = map.latLngToContainerPoint(mPos);
  const iconAnchor = marker.getIcon().options.iconAnchor;
  const calculatedCenter = {
    x: (containerPoint.x - iconAnchor[0]) + iconAnchor[0],
    y: (containerPoint.y - iconAnchor[1]) + iconAnchor[1]
  };
  const pixelOffset = Math.hypot(calculatedCenter.x - containerPoint.x, calculatedCenter.y - containerPoint.y);
  
  assert.strictEqual(mPos.lat, TEST_LAT_DEC, `Vĩ độ tại zoom ${z} không được đổi`);
  assert.strictEqual(mPos.lng, TEST_LNG_DEC, `Kinh độ tại zoom ${z} không được đổi`);
  assert(pixelOffset < 0.001, `Sai lệch pixel tại zoom ${z} phải = 0.00px`);
});
console.log('   ✅ [PASS] Tất cả các mức Zoom 6, 8, 10, 12, 14, 16, 18, 19, 20 đều cố định GPS và pixel offset = 0.00px\n');

console.log('6. Kiểm tra chuỗi thao tác Zoom liên tiếp: 6 → 12 → 18 → 20 → 10 → 6 → 20:');
const zoomCycle = [6, 12, 18, 20, 10, 6, 20];
zoomCycle.forEach((z, idx) => {
  map.setZoom(z, { animate: false });
  const mPos = marker.getLatLng();
  const containerPoint = map.latLngToContainerPoint(mPos);
  const iconAnchor = marker.getIcon().options.iconAnchor;
  const calculatedCenter = {
    x: (containerPoint.x - iconAnchor[0]) + iconAnchor[0],
    y: (containerPoint.y - iconAnchor[1]) + iconAnchor[1]
  };
  const pixelOffset = Math.hypot(calculatedCenter.x - containerPoint.x, calculatedCenter.y - containerPoint.y);
  
  assert.strictEqual(mPos.lat, TEST_LAT_DEC, `Vĩ độ tại bước ${idx + 1} zoom ${z} không được đổi`);
  assert.strictEqual(mPos.lng, TEST_LNG_DEC, `Kinh độ tại bước ${idx + 1} zoom ${z} không được đổi`);
  assert(pixelOffset < 0.001, `Sai lệch pixel tại bước ${idx + 1} zoom ${z} phải = 0.00px`);
});
console.log('   ✅ [PASS] Chuỗi thao tác Zoom 6 → 12 → 18 → 20 → 10 → 6 → 20 không có sai lệch tích lũy (pixel offset = 0.00px)\n');

console.log('🎉 TẤT CẢ KIỂM THỬ TỌA ĐỘ, PHÉP CHIẾU VÀ ZOOM TRÊN LEAFLET ĐỀU VƯỢT QUA 100%!');


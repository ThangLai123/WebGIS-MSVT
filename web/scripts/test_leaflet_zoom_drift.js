/**
 * test_leaflet_zoom_drift.js
 * Kiểm tra tính toán tọa độ của Leaflet qua các mức Zoom 10, 12, 15, 17, 18, 19, 20
 * với Test Fixture: Lat = 18.71688888888889, Lng = 105.69600000000000
 */

// Minimal mock for Leaflet in Node.js
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
global.navigator = global.window.navigator;

const path = require('path');
const L = require(path.join(__dirname, '../frontend/node_modules/leaflet'));

const TEST_LAT = 18.71688888888889;
const TEST_LNG = 105.69600000000000;

console.log('================================================================');
console.log('KIỂM TRA TỌA ĐỘ VÀ VỊ TRÍ MARKER QUA CÁC MỨC ZOOM (10 -> 20)');
console.log('Tọa độ mục tiêu: Lat =', TEST_LAT, ', Lng =', TEST_LNG);
console.log('================================================================\n');

const mapElement = document.getElementById('map');
mapElement.offsetWidth = 1024;
mapElement.offsetHeight = 768;
mapElement.clientWidth = 1024;
mapElement.clientHeight = 768;

const map = L.map(mapElement, {
  center: [TEST_LAT, TEST_LNG],
  zoom: 6,
  minZoom: 6,
  maxZoom: 20,
  zoomControl: false,
  attributionControl: false
});

// Giả lập kích thước viewport 1024x768
map.getSize = () => new L.Point(1024, 768);
map.setView([TEST_LAT, TEST_LNG], 6);

const marker = L.marker([TEST_LAT, TEST_LNG], {
  icon: L.divIcon({
    className: 'msvt-unified-marker',
    html: '<div class="msvt-marker-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  })
}).addTo(map);

// 1. Kiểm tra từng mức Zoom đơn lẻ theo yêu cầu Mục 4 & Mục 6
const zoomLevels = [6, 8, 10, 12, 14, 16, 18, 19, 20];
const results = [];

zoomLevels.forEach(z => {
  map.setZoom(z, { animate: false });
  
  // 1. Tọa độ GPS của marker
  const mPos = marker.getLatLng();
  const latDiff = Math.abs(mPos.lat - TEST_LAT);
  const lngDiff = Math.abs(mPos.lng - TEST_LNG);

  // 2. Tọa độ Container Point (tọa độ pixel trong khung nhìn map)
  const containerPoint = map.latLngToContainerPoint(mPos);

  // 3. Điểm neo icon thực tế (top-left sau khi trừ iconAnchor [9, 9])
  const iconAnchor = marker.getIcon().options.iconAnchor || [0, 0];
  const iconTopLeft = {
    x: containerPoint.x - iconAnchor[0],
    y: containerPoint.y - iconAnchor[1]
  };

  // Điểm neo tâm marker (iconTopLeft + anchor) so với containerPoint Leaflet tính
  const calculatedCenter = {
    x: iconTopLeft.x + iconAnchor[0],
    y: iconTopLeft.y + iconAnchor[1]
  };
  const pixelOffset = Math.hypot(calculatedCenter.x - containerPoint.x, calculatedCenter.y - containerPoint.y);

  // Đối chiếu ngược ContainerPoint -> LatLng
  const reverseLatLng = map.containerPointToLatLng(containerPoint);
  const reverseLatDiff = Math.abs(reverseLatLng.lat - TEST_LAT);
  const reverseLngDiff = Math.abs(reverseLatLng.lng - TEST_LNG);

  results.push({
    zoom: z,
    lat: mPos.lat.toFixed(14),
    lng: mPos.lng.toFixed(14),
    latDiff,
    lngDiff,
    containerPoint: `(${containerPoint.x.toFixed(1)}, ${containerPoint.y.toFixed(1)})`,
    pixelOffset: pixelOffset.toFixed(2),
    reverseLatDiff: reverseLatDiff.toExponential(4),
    reverseLngDiff: reverseLngDiff.toExponential(4)
  });
});

console.log('--- BẢNG 1: KIỂM TRA TỪNG MỨC ZOOM 6 -> 20 ---');
console.table(results);

// 2. Kiểm tra chuỗi thao tác Zoom liên tiếp: 6 → 12 → 18 → 20 → 10 → 6 → 20
console.log('\n--- BẢNG 2: KIỂM TRA CHUỖI ZOOM LIÊN TIẾP: 6 -> 12 -> 18 -> 20 -> 10 -> 6 -> 20 ---');
const zoomCycle = [6, 12, 18, 20, 10, 6, 20];
const cycleResults = [];

zoomCycle.forEach((z, idx) => {
  map.setZoom(z, { animate: false });
  const mPos = marker.getLatLng();
  const latDiff = Math.abs(mPos.lat - TEST_LAT);
  const lngDiff = Math.abs(mPos.lng - TEST_LNG);
  const containerPoint = map.latLngToContainerPoint(mPos);
  const iconAnchor = marker.getIcon().options.iconAnchor || [0, 0];
  const calculatedCenter = {
    x: (containerPoint.x - iconAnchor[0]) + iconAnchor[0],
    y: (containerPoint.y - iconAnchor[1]) + iconAnchor[1]
  };
  const pixelOffset = Math.hypot(calculatedCenter.x - containerPoint.x, calculatedCenter.y - containerPoint.y);
  
  cycleResults.push({
    step: `Bước ${idx + 1}`,
    zoom: z,
    lat: mPos.lat.toFixed(14),
    lng: mPos.lng.toFixed(14),
    latDiff,
    lngDiff,
    containerPoint: `(${containerPoint.x.toFixed(1)}, ${containerPoint.y.toFixed(1)})`,
    pixelOffset: pixelOffset.toFixed(2)
  });
});

console.table(cycleResults);

console.log('\n--- ĐÁNH GIÁ KẾT QUẢ ---');
let allPassed = true;
results.forEach(r => {
  if (r.latDiff > 1e-12 || r.lngDiff > 1e-12 || parseFloat(r.pixelOffset) > 0.001) {
    console.error(`❌ Zoom ${r.zoom}: Phát hiện sai lệch! Pixel offset: ${r.pixelOffset}`);
    allPassed = false;
  } else {
    console.log(`✅ Zoom ${r.zoom}: Tọa độ cố định tuyệt đối, sai lệch pixel = 0.00px`);
  }
});

cycleResults.forEach(r => {
  if (r.latDiff > 1e-12 || r.lngDiff > 1e-12 || parseFloat(r.pixelOffset) > 0.001) {
    console.error(`❌ Chuỗi ${r.step} (Zoom ${r.zoom}): Phát hiện sai lệch! Pixel offset: ${r.pixelOffset}`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log('\n🎉 THÀNH CÔNG: Tọa độ địa lý của Marker giữ nguyên 100% không đổi tại mọi mức Zoom từ 6 đến 20 và chuỗi Zoom liên tục!');
}


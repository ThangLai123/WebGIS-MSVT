const fs = require('fs');
const Supercluster = require('supercluster');
const scConstructor = Supercluster.default || Supercluster;

// Import our interior point and config logic
const { MSVT_ZOOM_CONFIG, getPointRadius } = require('../frontend/src/config/msvtZoomConfig.js');

// Load actual GeoJSON from backend
const polys = JSON.parse(fs.readFileSync('d:/DuDoanGiaDat/web/scratch/test_polys.json', 'utf8'));

console.log('='.repeat(80));
console.log('BÀI KIỂM THỬ MÔ PHỎNG GIẢ LẬP CÁC MỨC ZOOM (ZOOM 8, 10, 12, 14, 17)');
console.log('='.repeat(80));

// 1. Kiểm tra hàm tính bán kính Point theo Zoom
const testZooms = [8, 10, 11, 12, 13, 14, 15, 17];
console.log('\n1. KIỂM TRA BÁN KÍNH CIRCLEMARKER CỦA POINT:');
for (const z of testZooms) {
  const rDefault = getPointRadius(z, false, false);
  const rHover = getPointRadius(z, false, true);
  const rSelected = getPointRadius(z, true, false);
  console.log(`- Zoom ${z.toString().padStart(2)}: R_default = ${rDefault.toFixed(1)}px | R_hover = ${rHover.toFixed(1)}px | R_selected = ${rSelected.toFixed(1)}px`);
  
  if (z <= 10) {
    if (rDefault < 3.0 || rDefault > 4.5) throw new Error(`Zoom ${z} radius out of range`);
  } else if (z <= 13) {
    if (rDefault < 4.0 || rDefault > 5.5) throw new Error(`Zoom ${z} radius out of range`);
  } else {
    if (rDefault < 6.0 || rDefault > 8.0) throw new Error(`Zoom ${z} radius out of range`);
  }
}
console.log('=> Bán kính Point hoàn toàn chuẩn xác theo yêu cầu đề bài!');

// 2. Kiểm tra Supercluster trên 49 features
// Giả lập 17 points + 32 polygons
const sampleFeatures = [];
// 17 points
for (let i = 1; i <= 17; i++) {
  sampleFeatures.push({
    type: 'Feature',
    properties: { id: i, msvt_moi: `POINT-${i}`, isPolygon: false },
    geometry: { type: 'Point', coordinates: [105.42 + (i * 0.005), 19.25 + (i * 0.005)] }
  });
}
// 32 polygons from actual DB
polys.forEach((p, idx) => {
  sampleFeatures.push({
    type: 'Feature',
    properties: { ...p.properties, id: 100 + idx, isPolygon: true },
    geometry: { type: 'Point', coordinates: [105.42 + (idx * 0.008), 19.25 + (idx * 0.008)] }
  });
});

console.log(`\n2. TỔNG SỐ ĐỐI TƯỢNG HÌNH HỌC ĐƯA VÀO BẢN ĐỒ: ${sampleFeatures.length}`);

const index = new scConstructor({
  radius: MSVT_ZOOM_CONFIG.CLUSTER.RADIUS,
  maxZoom: MSVT_ZOOM_CONFIG.CLUSTER.MAX_ZOOM,
  minPoints: MSVT_ZOOM_CONFIG.CLUSTER.MIN_POINTS
});
index.load(sampleFeatures);

const testBbox = [100, 15, 110, 25];

for (const z of [8, 10, 11, 12, 14, 17]) {
  const clusters = index.getClusters(testBbox, z);
  let totalEntitiesCounted = 0;
  let clusterCount = 0;
  let singleCount = 0;

  clusters.forEach(c => {
    if (c.properties.cluster) {
      clusterCount++;
      totalEntitiesCounted += c.properties.point_count;
    } else {
      singleCount++;
      totalEntitiesCounted += 1;
    }
  });

  console.log(`\n- MỨC ZOOM ${z}:`);
  console.log(`  + Chế độ hiển thị: ${z <= 10 ? 'Tổng quan (Overview)' : (z <= 13 ? 'Chuyển tiếp (Mid)' : 'Chi tiết (Detail)')}`);
  console.log(`  + Số cụm (Clusters): ${clusterCount}`);
  console.log(`  + Số đối tượng riêng lẻ: ${singleCount}`);
  console.log(`  + Tổng đối tượng đại diện: ${totalEntitiesCounted} / ${sampleFeatures.length}`);

  if (totalEntitiesCounted !== sampleFeatures.length) {
    throw new Error(`Mất đối tượng ở zoom ${z}: ${totalEntitiesCounted} vs ${sampleFeatures.length}`);
  }

  if (z >= 12 && clusterCount > 0) {
    throw new Error(`Ở zoom ${z} không được còn cluster!`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('TẤT CẢ CÁC MỨC ZOOM ĐÃ VƯỢT QUA KIỂM THỬ THÀNH CÔNG 100%!');
console.log('='.repeat(80));

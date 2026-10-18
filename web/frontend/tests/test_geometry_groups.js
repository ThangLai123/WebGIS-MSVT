import {
  parseCoordinateLine,
  parseCoordinatesBatch,
  validateVertices,
  computeConvexHull,
  calculatePolygonAreaHa,
  evaluateAreaDeviation,
  combineMultiPolygonGeoJSON
} from '../src/utils/geometryUtils.js';

console.log('================================================================');
console.log('KIỂM THỬ 12 NHÓM TỌA ĐỘ THEO YÊU CẦU ĐỀ BÀI');
console.log('================================================================');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    failed++;
  }
}

// NHÓM A: Tọa độ Decimal nhiều dòng
const textA = `19.18080556, 105.57585556\n19.18080556;105.57585556\n19.18080556 105.57585556\n18.962467,105.439265\n18.963549,105.441808`;
const resA = parseCoordinatesBatch(textA, 'auto');
assert(resA.stats.validCount === 5, 'Nhóm A: Parse 5 dòng Decimal hợp lệ');
assert(resA.stats.overallFormat.includes('Decimal'), 'Nhóm A: Nhận diện định dạng Decimal');

// NHÓM B: Tọa độ DMS dùng chữ o (5 tọa độ đề bài)
const textB = `19o10'50.90'';105o34'33.08''
19o10'50.92'';105o34'29.94''
19o11'06.73'';105o34'24.27''
19o11'08.32'';105o34'28.80''
19o10'59.24'';105o34'29.24''`;
const resB = parseCoordinatesBatch(textB, 'auto');
assert(resB.stats.validCount === 5, 'Nhóm B: Parse 5 dòng DMS chữ o');
assert(Math.abs(resB.vertices[0].lat - 19.18080556) < 1e-6, 'Nhóm B: Đỉnh 1 lat = 19.18080556');
assert(Math.abs(resB.vertices[0].lng - 105.57585556) < 1e-6, 'Nhóm B: Đỉnh 1 lng = 105.57585556');
const valB = validateVertices(resB.vertices);
assert(valB.isValid && valB.type === 'POLYGON', 'Nhóm B: Tạo Polygon hợp lệ');

// NHÓM C: Tọa độ DMS dùng ký hiệu ° ' "
const textC = `19°10'50.90";105°34'33.08"
19°10′50.90″;105°34′33.08″
19o10'50.90'' , 105o34'33.08''`;
const resC = parseCoordinatesBatch(textC, 'auto');
assert(resC.stats.validCount === 3, 'Nhóm C: Parse các biến thể ký hiệu DMS');
assert(Math.abs(resC.vertices[0].lat - resC.vertices[1].lat) < 1e-6, 'Nhóm C: °\'" tương đương ′″');

// NHÓM D: Tọa độ có hướng N/E/S/W
const textD = `19°10'50.90"N, 105°34'33.08"E
19 10 50.90 N; 105 34 33.08 E
19°10'50.90"S, 105°34'33.08"W`;
const resD = parseCoordinatesBatch(textD, 'auto');
assert(resD.stats.validCount === 3, 'Nhóm D: Parse tọa độ có N/E/S/W');
assert(resD.vertices[2].lat < 0 && resD.vertices[2].lng < 0, 'Nhóm D: S và W đổi thành tọa độ âm');

// NHÓM E: Dữ liệu hỗn hợp Decimal và DMS
const textE = `19.18080556, 105.57585556
19°10'50.90"N, 105°34'33.08"E
18.962467; 105.439265`;
const resE = parseCoordinatesBatch(textE, 'auto');
assert(resE.stats.validCount === 3, 'Nhóm E: Parse hỗn hợp');
assert(resE.stats.overallFormat.includes('Hỗn hợp'), 'Nhóm E: Nhận diện định dạng Hỗn hợp');

// NHÓM F: Dữ liệu có điểm trùng
const textF = `18.962467,105.439265
18.963549,105.441808
18.962467,105.439265
18.963285,105.441808
18.965559,105.441246`;
const resF = parseCoordinatesBatch(textF, 'auto');
assert(resF.stats.duplicateCount === 1, 'Nhóm F: Phát hiện 1 điểm trùng lặp');
assert(resF.vertices[2].isDuplicate && resF.vertices[2].duplicateOf === 1, 'Nhóm F: Điểm 3 trùng Điểm 1');
const valF = validateVertices(resF.vertices);
assert(!valF.isValid && valF.type === 'DUPLICATE_POINTS', 'Nhóm F: Từ chối lưu Polygon có điểm trùng');
assert(valF.simulationHull && valF.simulationHull.length >= 3, 'Nhóm F: Cung cấp Convex Hull mô phỏng tham khảo');

// NHÓM G: Dữ liệu Polygon tự giao cắt (Bow-tie)
const ptsG = [
  { id: 1, lat: 19.0, lng: 105.0 },
  { id: 2, lat: 19.1, lng: 105.1 },
  { id: 3, lat: 19.1, lng: 105.0 },
  { id: 4, lat: 19.0, lng: 105.1 }
];
const valG = validateVertices(ptsG);
assert(!valG.isValid && valG.type === 'SELF_INTERSECTING', 'Nhóm G: Phát hiện đa giác tự giao cắt');
assert(valG.simulationHull && valG.simulationHull.length >= 4, 'Nhóm G: Có đường bao Convex Hull mô phỏng');

// NHÓM H: Dữ liệu chỉ có 1 hoặc 2 điểm (và xử lý chuyên sâu 2 điểm)
const ptsH1 = [{ id: 1, lat: 19.18, lng: 105.57 }];
const valH1 = validateVertices(ptsH1);
assert(valH1.isValid && valH1.type === 'POINT', 'Nhóm H: 1 điểm nhận diện Point');

// Dữ liệu mẫu 2 điểm trong đề bài:
const ptsH2 = [
  { id: 1, lat: 18.815368, lng: 105.606360 },
  { id: 2, lat: 18.817680, lng: 105.602557 }
];
const valH2Line = validateVertices(ptsH2, { twoPointsMode: 'line' });
assert(!valH2Line.isValid && valH2Line.type === 'TWO_POINTS', 'Nhóm H: 2 điểm nhận diện TWO_POINTS');
assert(valH2Line.polyline && valH2Line.polyline.length === 2, 'Nhóm H: 2 điểm có polyline kết nối');
assert(valH2Line.distanceMeters > 450 && valH2Line.distanceMeters < 500, 'Nhóm H: Tính khoảng cách ~476m');

// Mô phỏng Vùng đệm địa lý (Buffer 50m)
const valH2Buffer = validateVertices(ptsH2, { twoPointsMode: 'buffer', bufferMeters: 50 });
assert(valH2Buffer.simulationPolygon && valH2Buffer.simulationPolygon.length >= 10, 'Nhóm H: Tạo vùng đệm địa lý theo mét');
assert(valH2Buffer.simulatedAreaHa > 5.0 && valH2Buffer.simulatedAreaHa < 6.0, 'Nhóm H: Diện tích vùng đệm 50m ~5.54 ha');

// Mô phỏng Hình chữ nhật (Bounding Box)
const valH2BBox = validateVertices(ptsH2, { twoPointsMode: 'bbox' });
assert(valH2BBox.simulationPolygon && valH2BBox.simulationPolygon.length === 5, 'Nhóm H: Tạo hình chữ nhật 2 góc đối diện (5 đỉnh khép kín)');
assert(valH2BBox.simulatedAreaHa > 0, 'Nhóm H: Diện tích hình chữ nhật > 0');

// NHÓM I: Dữ liệu có 5, 10, 20 đỉnh
const ptsI10 = [];
for (let i = 0; i < 10; i++) {
  const angle = (i * 2 * Math.PI) / 10;
  ptsI10.push({
    id: i + 1,
    lat: 19.0 + 0.05 * Math.cos(angle),
    lng: 105.0 + 0.05 * Math.sin(angle)
  });
}
const valI10 = validateVertices(ptsI10);
assert(valI10.isValid && valI10.type === 'POLYGON' && valI10.vertexCount === 10, 'Nhóm I: Hỗ trợ 10 đỉnh đa giác');

// NHÓM J: Dữ liệu tọa độ sai phạm vi hoặc phút/giây >= 60
const lineJ1 = parseCoordinateLine("19o65'50.90'';105o34'33.08''", 1, 'auto');
assert(!lineJ1.isValid && lineJ1.error.includes('phút'), 'Nhóm J: Bắt lỗi số phút >= 60');
const lineJ2 = parseCoordinateLine("95.1234, 105.5678", 2, 'auto');
assert(!lineJ2.isValid && lineJ2.error.includes('Vĩ độ'), 'Nhóm J: Bắt lỗi Vĩ độ > 90');

// NHÓM K: Tọa độ dấu thập phân dạng địa phương khi dấu phân cách là ';'
const textK = `19,18080556;105,57585556`;
const resK = parseCoordinateLine(textK, 1, 'auto');
assert(resK.isValid, 'Nhóm K: Nhận diện European decimal comma khi dùng dấu ;');
assert(Math.abs(resK.lat - 19.18080556) < 1e-6, 'Nhóm K: Lat chuyển đúng 19.18080556');
assert(Math.abs(resK.lng - 105.57585556) < 1e-6, 'Nhóm K: Lng chuyển đúng 105.57585556');

// NHÓM L: Tọa độ Vùng trồng MSVT #38 (Tự giao cắt & Sinh phương án đối chiếu diện tích hồ sơ 0.15 ha)
const textR38 = `18.756488, 105.685531
18.756601, 105.685789
18.756658, 105.685778
18.756692, 105.685873
18.756302, 105.685084
18.756143, 105.685698
18.756488, 105.685531`;
const batchR38 = parseCoordinatesBatch(textR38, 'auto');
assert(batchR38.stats.validCount === 7 && batchR38.stats.distinctCount === 6, 'Nhóm L: Vùng 38 có 7 dòng hợp lệ, 6 đỉnh phân biệt (1 điểm khép kín)');
const valR38 = validateVertices(batchR38.vertices, { declaredAreaHa: 0.15 });
assert(!valR38.isValid && valR38.type === 'SELF_INTERSECTING', 'Nhóm L: Bắt chính xác lỗi tự giao cắt của Vùng 38');
assert(valR38.edge1[0] === 2 && valR38.edge1[1] === 3, 'Nhóm L: Cạnh 2-3 tham gia tự cắt');
assert(valR38.edge2[0] === 4 && valR38.edge2[1] === 5, 'Nhóm L: Cạnh 4-5 tham gia tự cắt');
assert(valR38.candidates && valR38.candidates.length === 3, 'Nhóm L: Sinh đúng 3 phương án mô phỏng hợp lệ');
assert(valR38.candidates[0].areaHa === 0.1391, 'Nhóm L: Phương án 1 có diện tích 0.1391 ha');
assert(valR38.candidates[0].pctDiff <= 10.0 && valR38.candidates[0].level === 'success', 'Nhóm L: Phương án 1 sai lệch 7.3% (<= 10%, Gần diện tích khai báo)');

// NHÓM M: 2 điểm GPS kết hợp diện tích hồ sơ (Mô phỏng dải vùng Corridor theo mét)
const pts2M = [
  { id: 1, lat: 18.815368, lng: 105.606360 },
  { id: 2, lat: 18.817680, lng: 105.602557 }
];
const valCorridor = validateVertices(pts2M, { twoPointsMode: 'corridor', declaredAreaHa: 0.5 });
assert(valCorridor.corridorParams && valCorridor.corridorParams.lengthMeters === 476, 'Nhóm M: Chiều dài đoạn nối 2 điểm ~476m');
assert(valCorridor.corridorParams.proposedWidthMeters === 10.5, 'Nhóm M: Chiều rộng đề xuất W = 5000m² / 476m = 10.5m');
assert(valCorridor.simulatedAreaHa >= 0.49 && valCorridor.simulatedAreaHa <= 0.51, 'Nhóm M: Diện tích dải mô phỏng ~0.5 ha khớp diện tích khai báo');

// NHÓM N: Đánh giá phân cấp sai lệch diện tích hồ sơ
const evalSuccess = evaluateAreaDeviation(0.14, 0.15); // ~6.7%
assert(evalSuccess.level === 'success' && evalSuccess.pctDiff < 10, 'Nhóm N: Phân cấp sai lệch <= 10% (Gần diện tích khai báo)');
const evalWarning = evaluateAreaDeviation(0.18, 0.15); // 20%
assert(evalWarning.level === 'warning' && evalWarning.pctDiff === 20.0, 'Nhóm N: Phân cấp sai lệch 10-25% (Cần rà soát)');
const evalDanger = evaluateAreaDeviation(0.25, 0.15); // ~66.7%
assert(evalDanger.level === 'danger' && evalDanger.pctDiff > 25, 'Nhóm N: Phân cấp sai lệch > 25% (Cảnh báo sai lệch lớn)');

// NHÓM O: Dữ liệu thực tế 18 điểm GPS có Đ1..Đ5, N/E, khoảng trắng bất thường và 4 nhóm ranh giới
const textO = `Đ1: 18.997412 N, 105.52339 E,
Đ2: 18.99728 N, 105. 523277 E,
Đ3: 18.997331 N, 105. 523887 E,
Đ4: 18.996698 N, 105.52348 E;

Đ1: 19.06788 N, 105.45612 E,
Đ2: 19.06789 N, 105. 45619 E,
Đ3: 19.06808 N, 105. 46045 E,
Đ4: 19.06792 N, 105.45697 E;

Đ1: 19.05065 N, 105.45769 E,
Đ2: 19.04986 N, 105.45818 E,
Đ3: 19.04948 N, 105.45845 E,
Đ4: 19.04867 N, 105.45842 E,
Đ5: 19.05002 N, 105.45749 E;

Đ1: 19.11937 N, 105.51659 E,
Đ2: 19.11938 N, 105.51686 E,
Đ3: 19.11513 N, 105.51783 E,
Đ4: 19.11069 N, 105.51179 E,
Đ5: 19.11071 N, 105.51860 E.`;

const resO = parseCoordinatesBatch(textO, 'auto');
assert(resO.stats.validCount === 18, 'Nhóm O: Nhận diện chính xác toàn bộ 18 điểm tọa độ');
assert(resO.isMultiGroup === true, 'Nhóm O: Nhận diện đây là đa nhóm ranh giới (isMultiGroup = true)');
assert(resO.totalGroups === 4, 'Nhóm O: Tách thành đúng 4 nhóm ranh giới');
assert(resO.groups[0].points.length === 4, 'Nhóm O: Nhóm 1 có 4 điểm');
assert(resO.groups[1].points.length === 4, 'Nhóm O: Nhóm 2 có 4 điểm');
assert(resO.groups[2].points.length === 5, 'Nhóm O: Nhóm 3 có 5 điểm');
assert(resO.groups[3].points.length === 5, 'Nhóm O: Nhóm 4 có 5 điểm');

// Kiểm tra chuẩn hóa khoảng trắng bất thường 105. 523277 E -> 105.523277
assert(resO.groups[0].points[1].lng === 105.523277, 'Nhóm O: Chuẩn hóa khoảng trắng "105. 523277 E" thành 105.523277');

// Kiểm tra hình học từng nhóm độc lập
assert(!resO.groups[0].isValid && resO.groups[0].isSelfIntersecting, 'Nhóm O: Nhóm 1 phát hiện lỗi tự giao cắt (Self-intersection)');
assert(resO.groups[1].isValid && resO.groups[1].isNarrow, 'Nhóm O: Nhóm 2 hợp lệ nhưng phát hiện là đa giác rất hẹp (sliver polygon)');
assert(resO.groups[2].isValid && !resO.groups[2].isNarrow && resO.groups[2].areaHa > 0.8, 'Nhóm O: Nhóm 3 hợp lệ về hình học (~0.86 ha)');
assert(!resO.groups[3].isValid && resO.groups[3].isSelfIntersecting, 'Nhóm O: Nhóm 4 phát hiện lỗi tự giao cắt (Self-intersection)');

// Kiểm tra kết hợp MultiPolygon (Trường hợp A)
const mp = combineMultiPolygonGeoJSON([resO.groups[1], resO.groups[2]]);
assert(mp && mp.type === 'MultiPolygon' && mp.coordinates.length === 2, 'Nhóm O: Kết hợp các nhóm hợp lệ thành MultiPolygon chuẩn GeoJSON');

console.log('----------------------------------------------------------------');
console.log(`KẾT QUẢ: Đạt ${passed} / ${passed + failed} kiểm thử.`);
if (failed === 0) {
  console.log('🎉 TẤT CẢ CÁC NHÓM KIỂM THỬ ĐỀU VƯỢT QUA 100%!');
} else {
  process.exit(1);
}

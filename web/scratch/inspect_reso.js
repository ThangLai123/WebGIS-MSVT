import { parseCoordinatesBatch } from '../frontend/src/utils/geometryUtils.js';

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
console.log('validCount:', resO.stats.validCount);
for (let i = 0; i < resO.groups.length; i++) {
  const g = resO.groups[i];
  console.log(`Group ${i + 1}: ${g.points.length} pts, valid=${g.isValid}, selfIntersects=${g.isSelfIntersecting}, reason="${g.reason}"`);
  console.log('   points:', g.points.map(p => ({ label: p.label, lat: p.lat, lng: p.lng, valid: p.isValid })));
}

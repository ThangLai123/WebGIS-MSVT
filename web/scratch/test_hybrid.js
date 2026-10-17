import { cleanRawCoordinateText, extractRawPointsAndGroups, parseCoordinateLine } from '../frontend/src/utils/geometryUtils.js';

const textD = `19°10'50.90"N, 105°34'33.08"E
19 10 50.90 N; 105 34 33.08 E
19°10'50.90"S, 105°34'33.08"W`;

const lines = textD.split(/\r?\n/).filter(l => l.trim());
console.log('Lines count:', lines.length);

for (const line of lines) {
  // Check if line has multiple points
  const pts = extractRawPointsAndGroups(line);
  console.log(`Line "${line}" -> extractRawPointsAndGroups found: ${pts.length}`);
}

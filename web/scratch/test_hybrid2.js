import { cleanRawCoordinateText, parseCoordinateLine } from '../frontend/src/utils/geometryUtils.js';

function extractPointsHybrid(text) {
  const cleaned = cleanRawCoordinateText(text);
  if (!cleaned) return [];

  // Split into lines
  const rawLines = cleaned.split(/\r?\n/).filter(l => l.trim());
  const points = [];

  for (let lIdx = 0; lIdx < rawLines.length; lIdx++) {
    const line = rawLines[lIdx].trim();
    if (!line) continue;

    // Check if this line contains multiple labeled points (e.g. Đ1... Đ2...)
    const labels = line.match(/(?:[ĐDđdP]|Điểm|Diem|Point|Mốc)\s*\d+/gi);
    const hasMultipleLabels = labels && labels.length > 1;

    // Also check if line has multiple semicolon-separated blocks with coordinate pairs
    const semiBlocks = line.split(';').map(s => s.trim()).filter(Boolean);
    const hasMultiplePointsInLine = hasMultipleLabels || (semiBlocks.length > 2);

    if (hasMultiplePointsInLine) {
      // Regex extraction for dense line with multiple items
      const itemRegex = /(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)?([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)[\s,;]+([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)(?:[^\S\r\n,]*([;]))?/gi;
      let m;
      while ((m = itemRegex.exec(line)) !== null) {
        if (!m[3] || !m[4]) continue;
        const prefix = m[1];
        const numStr = m[2];
        const num = numStr ? parseInt(numStr, 10) : null;
        const label = `${prefix || ''}${numStr || ''}`.trim();
        // Parse pair
        const parsed = parseCoordinateLine(`${m[3]}; ${m[4]}`, points.length + 1);
        if (parsed) {
          points.push({
            rawIndex: points.length + 1,
            label: label || `#${points.length + 1}`,
            labelPrefix: prefix || null,
            labelNum: num,
            c1Raw: m[3],
            c2Raw: m[4],
            lat: parsed.lat,
            lng: parsed.lng,
            format: parsed.format,
            isValid: parsed.isValid,
            error: parsed.error,
            delimiter: m[5] || ''
          });
        }
      }
    } else {
      // Single point in line
      const labelMatch = line.match(/^(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)/i);
      const prefix = labelMatch ? labelMatch[1] : null;
      const numStr = labelMatch ? labelMatch[2] : null;
      const num = numStr ? parseInt(numStr, 10) : null;
      const label = labelMatch ? `${prefix || ''}${numStr || ''}`.trim() : null;

      const delimMatch = line.match(/;$/) ? ';' : '';
      const parsed = parseCoordinateLine(line, points.length + 1);
      if (parsed) {
        points.push({
          rawIndex: points.length + 1,
          label: label || `#${points.length + 1}`,
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
  }

  return points;
}

// Test textD:
const textD = `19°10'50.90"N, 105°34'33.08"E
19 10 50.90 N; 105 34 33.08 E
19°10'50.90"S, 105°34'33.08"W`;
console.log('textD pts:', extractPointsHybrid(textD).length);
console.log('textD pts[1]:', extractPointsHybrid(textD)[1]);

// Test 18 sample points:
const sample18 = `Đ1: 18.997412 N, 105.52339 E,
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

console.log('sample18 pts:', extractPointsHybrid(sample18).length);

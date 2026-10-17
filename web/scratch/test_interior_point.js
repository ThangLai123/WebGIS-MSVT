const fs = require('fs');

const polys = JSON.parse(fs.readFileSync('d:/DuDoanGiaDat/web/scratch/test_polys.json', 'utf8'));

// Standard ray-casting point-in-polygon
function pointInRing(pt, ring) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, polygonCoords) {
  // polygonCoords[0] is outer ring, polygonCoords[1..n] are holes
  const outer = polygonCoords[0];
  if (!pointInRing(pt, outer)) return false;
  for (let h = 1; h < polygonCoords.length; h++) {
    if (pointInRing(pt, polygonCoords[h])) return false; // Inside hole -> outside polygon
  }
  return true;
}

// Calculate centroid of a ring
function ringCentroid(ring) {
  let cx = 0, cy = 0, signedArea = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0], y0 = ring[i][1];
    const x1 = ring[i + 1][0], y1 = ring[i + 1][1];
    const a = x0 * y1 - x1 * y0;
    signedArea += a;
    cx += (x0 + x1) * a;
    cy += (y0 + y1) * a;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-12) {
    // Degenerate ring, return average
    let avgX = 0, avgY = 0;
    for (const p of ring) { avgX += p[0]; avgY += p[1]; }
    return [avgX / ring.length, avgY / ring.length];
  }
  cx /= (6 * signedArea);
  cy /= (6 * signedArea);
  return [cx, cy];
}

// Guaranteed point on surface for Polygon / MultiPolygon
function getPointOnPolygon(polygonCoords) {
  const outer = polygonCoords[0];
  // 1. Try centroid
  const [cx, cy] = ringCentroid(outer);
  if (pointInPolygon([cx, cy], polygonCoords)) {
    return [cx, cy];
  }

  // 2. If centroid is outside (concave polygon), intersect horizontal scanline at cy with edges
  const yScan = cy;
  const xIntersects = [];
  for (let i = 0; i < outer.length - 1; i++) {
    const p1 = outer[i];
    const p2 = outer[i + 1];
    if ((p1[1] <= yScan && p2[1] > yScan) || (p2[1] <= yScan && p1[1] > yScan)) {
      const x = p1[0] + (yScan - p1[1]) / (p2[1] - p1[1]) * (p2[0] - p1[0]);
      xIntersects.push(x);
    }
  }
  xIntersects.sort((a, b) => a - b);

  // Find the longest segment inside the polygon along this scanline
  let bestMidX = null;
  let maxLen = -1;
  for (let i = 0; i < xIntersects.length - 1; i += 2) {
    const midX = (xIntersects[i] + xIntersects[i + 1]) / 2;
    const len = xIntersects[i + 1] - xIntersects[i];
    if (len > maxLen && pointInPolygon([midX, yScan], polygonCoords)) {
      maxLen = len;
      bestMidX = midX;
    }
  }
  if (bestMidX !== null) {
    return [bestMidX, yScan];
  }

  // 3. Fallback: try midpoints between consecutive vertices
  for (let i = 0; i < outer.length - 1; i++) {
    // vector inward: midpoint nudge
    const p1 = outer[i];
    const p2 = outer[i + 1];
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const candidate = [mx + (cx - mx) * 0.1, my + (cy - my) * 0.1];
    if (pointInPolygon(candidate, polygonCoords)) {
      return candidate;
    }
  }

  // 4. Ultimate fallback: return first vertex
  return [outer[0][0], outer[0][1]];
}

function getPointOnFeature(geom) {
  if (!geom) return null;
  if (geom.type === 'Point') {
    return geom.coordinates;
  }
  if (geom.type === 'Polygon') {
    return getPointOnPolygon(geom.coordinates);
  }
  if (geom.type === 'MultiPolygon') {
    // Pick the largest polygon component by bounding box area
    let maxArea = -1;
    let bestPoly = geom.coordinates[0];
    for (const poly of geom.coordinates) {
      const ring = poly[0];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of ring) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      }
      const approxArea = (maxX - minX) * (maxY - minY);
      if (approxArea > maxArea) {
        maxArea = approxArea;
        bestPoly = poly;
      }
    }
    return getPointOnPolygon(bestPoly);
  }
  return null;
}

let passCount = 0;
for (const p of polys) {
  const pt = getPointOnFeature(p.geometry);
  const geom = p.geometry;
  let isInside = false;
  if (geom.type === 'Polygon') {
    isInside = pointInPolygon(pt, geom.coordinates);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (pointInPolygon(pt, poly)) {
        isInside = true;
        break;
      }
    }
  }
  if (isInside) {
    passCount++;
  } else {
    console.error(`FAILED for region ${p.properties.msvt_moi}: pt=${pt}`);
  }
}

console.log(`Test completed: ${passCount} / ${polys.length} polygons verified INSIDE!`);

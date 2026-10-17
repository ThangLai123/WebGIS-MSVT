import {
  parseSingleDms,
  cleanCoordinateLine,
  parseCoordinateLine,
  parseCoordinatesBatch,
  validateVertices,
  calculatePolygonAreaHa,
  calculateDistanceMeters,
  isSelfIntersecting
} from '../frontend/src/utils/geometryUtils.js';

console.log('Testing geometryUtils import...');
console.log('calculateDistanceMeters:', typeof calculateDistanceMeters);

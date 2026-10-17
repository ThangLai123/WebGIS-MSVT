import { parseSingleDms, parseSingleCoordToken, parseCoordinatePair } from '../frontend/src/utils/geometryUtils.js';

const s1 = "19 10 50.90 N";
const s2 = "105 34 33.08 E";

console.log('parseSingleDms s1:', parseSingleDms(s1));
console.log('parseSingleDms s2:', parseSingleDms(s2));

console.log('parseSingleCoordToken s1:', parseSingleCoordToken(s1));
console.log('parseSingleCoordToken s2:', parseSingleCoordToken(s2));

const textD = `19°10'50.90"N, 105°34'33.08"E
19 10 50.90 N; 105 34 33.08 E
19°10'50.90"S, 105°34'33.08"W`;

import { parseCoordinatesBatch } from '../frontend/src/utils/geometryUtils.js';
const resD = parseCoordinatesBatch(textD);
console.log('resD stats:', resD.stats);
console.log('resD items:', resD.items);

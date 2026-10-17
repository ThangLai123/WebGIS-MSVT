let line1 = "Đ4: 18.996698 N, 105.52348 E;";
let line2 = "Đ5: 19.11071 N, 105.51860 E.";

function clean(l) {
  let cleaned = l.replace(/^(?:(?:Đ|P|Điểm|Point|STT)\s*\d+\s*[:.)-]?\s*|#\d+\s*[:.)-]?\s*|\d+[:.)]\s+)/i, '').trim();
  cleaned = cleaned.replace(/[;.\s]+$/, '').trim();
  return cleaned;
}

console.log('clean line1:', clean(line1));
console.log('clean line2:', clean(line2));

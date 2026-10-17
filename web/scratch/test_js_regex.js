const text = `Đ1: 18.997412 N, 105.52339 E,
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

let cleaned = text.replace(/<br\s*\/?>/gi, '\n')
  .replace(/(\d+)\s*\.\s+(\d+)/g, '$1.$2')
  .replace(/(\d+)\s+\.\s*(\d+)/g, '$1.$2');

const itemRegex = /(?:([ĐDđdP]|Điểm|Diem|Point|Mốc)\s*(\d+)[\s:.-]*)?([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)[\s,;]+([^\s,;]+(?:\s*[o°d']+[^\s,;]*)?\s*[NSEWnsew]?)(?:[\s,;]*([;\n]))?/gi;

let match;
let count = 0;
while ((match = itemRegex.exec(cleaned)) !== null) {
  if (match[3] && match[4]) {
    count++;
    console.log(`${count}. Label: ${match[1] || ''}${match[2] || ''} | c1: ${match[3]} | c2: ${match[4]} | delim: ${match[5] || ''}`);
  }
}
console.log('Total extracted:', count);

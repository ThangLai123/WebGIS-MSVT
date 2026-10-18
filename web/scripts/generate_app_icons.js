const fs = require('fs');
const path = require('path');
const resvgPath = path.join(__dirname, '..', 'frontend', 'node_modules', '@resvg', 'resvg-js');
const { Resvg } = require(resvgPath);

// Tạo SVG cho Logo WebGIS MSVT (512x512)
function getSvgLogo({ isMaskable = false, isAppleTouch = true } = {}) {
  // Maskable icon requires safe zone of 80% (padding 10% on each side)
  const transform = isMaskable 
    ? `transform="translate(51.2, 51.2) scale(0.80)"` 
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient: Sang trọng, màu xanh lá nông nghiệp công nghệ cao -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#059669" />
      <stop offset="45%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#064e3b" />
    </linearGradient>

    <!-- Ánh sáng tỏa tròn trên đỉnh icon -->
    <radialGradient id="topGlow" cx="50%" cy="25%" r="60%">
      <stop offset="0%" stop-color="#6ee7b7" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#047857" stop-opacity="0" />
    </radialGradient>

    <!-- Gradient cho Thân Ghim Vị trí GIS: Trắng ngọc trai sáng bóng -->
    <linearGradient id="pinBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="65%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>

    <!-- Gradient Lá lớn (Phải): Xanh lá đậm chuyển xanh tươi -->
    <linearGradient id="leafGradRight" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#15803d" />
      <stop offset="50%" stop-color="#16a34a" />
      <stop offset="100%" stop-color="#4ade80" />
    </linearGradient>

    <!-- Gradient Lá nhỏ (Trái): Xanh mầm non tươi sáng -->
    <linearGradient id="leafGradLeft" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#16a34a" />
      <stop offset="50%" stop-color="#22c55e" />
      <stop offset="100%" stop-color="#86efac" />
    </linearGradient>

    <!-- Đổ bóng tự nhiên cho Ghim vị trí -->
    <filter id="pinShadow" x="-20%" y="-10%" width="140%" height="130%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#022c22" flood-opacity="0.45" />
    </filter>

    <!-- Đổ bóng nhẹ cho mầm cây bên trong ghim -->
    <filter id="leafShadow" x="-20%" y="-20%" width="140%" height="140%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.18" />
    </filter>
  </defs>

  <!-- 1. NỀN NGUYÊN KHỐI (Không bo góc trong file để iOS/Android tự động bo chuẩn hệ điều hành) -->
  <rect width="512" height="512" fill="url(#bgGrad)" />
  <rect width="512" height="512" fill="url(#topGlow)" />

  <!-- 2. HỌA TIẾT BẢN ĐỒ GIS & TỌA ĐỘ VÙNG TRỒNG (Mờ nhẹ, tinh tế) -->
  <g opacity="0.14" stroke="#ffffff" fill="none">
    <!-- Vòng tròn radar tọa độ -->
    <circle cx="256" cy="245" r="195" stroke-width="1.5" stroke-dasharray="5 7" />
    <circle cx="256" cy="245" r="145" stroke-width="1.2" />
    <circle cx="256" cy="245" r="85" stroke-width="1" stroke-dasharray="3 5" />
    
    <!-- Đường kinh tuyến / vĩ tuyến cong GIS -->
    <path d="M 60 245 Q 256 295 452 245" stroke-width="1.2" />
    <path d="M 100 160 Q 256 200 412 160" stroke-width="1" />
    <path d="M 100 330 Q 256 390 412 330" stroke-width="1" />
    <path d="M 256 50 L 256 440" stroke-width="1" stroke-dasharray="4 6" />

    <!-- Đa giác tượng trưng thửa đất / vùng trồng MSVT -->
    <polygon points="90,110 160,85 190,140 130,170" stroke-width="1.2" />
    <polygon points="340,95 420,115 400,180 325,150" stroke-width="1.2" />
    <polygon points="350,330 430,310 445,390 380,410" stroke-width="1.2" />
    <polygon points="80,340 145,315 160,390 100,415" stroke-width="1.2" />
  </g>

  <!-- 3. BIỂU TƯỢNG TRUNG TÂM (GHIM VỊ TRÍ GIS + MẦM CÂY NÔNG NGHIỆP) -->
  <g ${transform}>
    <!-- Điểm chạm tọa độ / Sóng radar định vị đáy ghim -->
    <g opacity="0.75">
      <!-- Vòng ngoài sóng radar -->
      <ellipse cx="256" cy="416" rx="64" ry="16" fill="none" stroke="#6ee7b7" stroke-width="2.5" opacity="0.6" />
      <!-- Vòng giữa -->
      <ellipse cx="256" cy="416" rx="38" ry="9.5" fill="none" stroke="#a7f3d0" stroke-width="2" opacity="0.8" />
      <!-- Tâm điểm tọa độ -->
      <ellipse cx="256" cy="416" rx="14" ry="4" fill="#6ee7b7" />
    </g>

    <!-- THÂN GHIM BẢN ĐỒ (Map Location Pin) - Tối ưu tỷ lệ đậm nét, cao cấp -->
    <!-- Tọa độ: Đầu tròn r=112 tại tâm (256, 192), vuốt mềm xuống (256, 400) -->
    <path d="M 256 80 
             C 318 80 368 130 368 192 
             C 368 258 300 338 256 400 
             C 212 338 144 258 144 192 
             C 144 130 194 80 256 80 Z" 
          fill="url(#pinBodyGrad)" 
          filter="url(#pinShadow)" />

    <!-- Viền trong nhẹ tạo hiệu ứng bề mặt khối 3D cao cấp -->
    <path d="M 256 85 
             C 314 85 363 134 363 192 
             C 363 255 298 332 256 392 
             C 214 332 149 255 149 192 
             C 149 134 198 85 256 85 Z" 
          fill="none" 
          stroke="#ffffff" 
          stroke-width="2.5" 
          opacity="0.95" />

    <!-- Vòng hào quang nhẹ bao quanh mầm cây trên mặt ghim -->
    <circle cx="256" cy="192" r="80" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="4 6" opacity="0.35" />

    <!-- MẦM CÂY NÔNG NGHIỆP CÔNG NGHỆ CAO (Bold, Iconic Agricultural Sprout) -->
    <g filter="url(#leafShadow)">
      <!-- Gốc thân cây non mập mạp, vững chắc vươn lên từ đáy đầu ghim -->
      <path d="M 256 256 
               C 255 234 252 212 256 182" 
            fill="none" 
            stroke="#15803d" 
            stroke-width="7" 
            stroke-linecap="round" />

      <!-- LÁ CHÍNH LỚN BÊN PHẢI (Tán lá rộng, vươn cao tràn đầy sức sống) -->
      <!-- Bắt đầu từ gốc nhánh, uốn cong sang phải, đỉnh vuốt nhọn hướng lên -->
      <path d="M 256 220 
               C 268 190 286 160 318 132 
               C 332 178 318 228 266 244 
               C 259 242 256 232 256 220 Z" 
            fill="url(#leafGradRight)" />

      <!-- Gân sáng trên lá phải -->
      <path d="M 256 220 
               C 278 194 298 165 318 132" 
            fill="none" 
            stroke="#bbf7d0" 
            stroke-width="3" 
            stroke-linecap="round" 
            opacity="0.9" />

      <!-- LÁ PHỤ BÊN TRÁI (Lá mầm non căng mọng, uốn lượn mềm mại sang trái) -->
      <!-- Bắt đầu từ gốc nhánh, uốn cong sang trái, đỉnh vuốt nhọn -->
      <path d="M 256 230 
               C 236 200 212 180 192 152 
               C 186 190 208 236 246 250 
               C 252 248 255 240 256 230 Z" 
            fill="url(#leafGradLeft)" />

      <!-- Gân sáng trên lá trái -->
      <path d="M 256 230 
               C 234 204 214 180 192 152" 
            fill="none" 
            stroke="#dcfce7" 
            stroke-width="2.6" 
            stroke-linecap="round" 
            opacity="0.9" />

      <!-- CHỒI NON TRUNG TÂM (Đỉnh sinh trưởng non tơ vươn thẳng) -->
      <path d="M 256 186 
               C 250 160 258 142 268 120 
               C 272 142 270 164 260 184 Z" 
            fill="#86efac" />
      <path d="M 256 186 
               C 252 162 259 146 268 120" 
            fill="none" 
            stroke="#ffffff" 
            stroke-width="1.4" 
            stroke-linecap="round" 
            opacity="0.85" />
    </g>
  </g>
</svg>`;
}

// Xuất file SVG và các kích thước PNG
async function buildIcons() {
  const publicDir = path.join(__dirname, '..', 'frontend', 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  console.log('--- Đang tạo các tài nguyên Logo & Icon WebGIS MSVT ---');

  // 1. Lưu file SVG chính
  const svgStandard = getSvgLogo({ isMaskable: false });
  const svgMaskable = getSvgLogo({ isMaskable: true });
  
  const faviconSvgPath = path.join(publicDir, 'favicon.svg');
  fs.writeFileSync(faviconSvgPath, svgStandard, 'utf8');
  console.log('✅ Đã tạo favicon.svg');

  // 2. Render các định dạng PNG bằng Resvg
  const targets = [
    { name: 'apple-touch-icon.png', size: 180, svg: svgStandard, desc: 'Apple Touch Icon (180x180, iOS Safari)' },
    { name: 'icon-192.png', size: 192, svg: svgStandard, desc: 'PWA Android Standard (192x192)' },
    { name: 'icon-512.png', size: 512, svg: svgStandard, desc: 'PWA Android High-Res (512x512)' },
    { name: 'icon-maskable-512.png', size: 512, svg: svgMaskable, desc: 'Android Adaptive Maskable (512x512 with safe zone)' }
  ];

  for (const t of targets) {
    const resvg = new Resvg(t.svg, {
      fitTo: {
        mode: 'width',
        value: t.size
      }
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const outPath = path.join(publicDir, t.name);
    fs.writeFileSync(outPath, pngBuffer);
    console.log(`✅ Đã tạo ${t.name} (${t.size}x${t.size}) - ${t.desc}`);
  }

  // 3. Sao chép apple-touch-icon-precomposed.png cho các phiên bản Safari cũ
  const applePath = path.join(publicDir, 'apple-touch-icon.png');
  const applePrecomposedPath = path.join(publicDir, 'apple-touch-icon-precomposed.png');
  if (fs.existsSync(applePath)) {
    fs.copyFileSync(applePath, applePrecomposedPath);
    console.log('✅ Đã tạo apple-touch-icon-precomposed.png (hỗ trợ toàn diện iOS Safari)');
  }

  console.log('🎉 Hoàn tất render toàn bộ PNG từ Resvg!');
}

buildIcons().catch(err => {
  console.error('Lỗi tạo icon:', err);
  process.exit(1);
});

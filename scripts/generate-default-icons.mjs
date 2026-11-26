// 상명대가 아닌 학교에서 쓰는 기본 사이트 아이콘(파란 원 + 흰 학사모)을 만든다.
// 학사모 모양: Tabler Icons "school" (MIT 라이선스, https://tabler.io/icons)
// 실행: node scripts/generate-default-icons.mjs  → public/icons/default/
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const BRAND = "#084d98";
const CAP_PATHS = '<path d="M22 9l-10 -4l-10 4l10 4l10 -4v6"/><path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"/>';
const outDir = join(import.meta.dirname, "..", "public", "icons", "default");
mkdirSync(outDir, { recursive: true });

/** shape: circle = 원형(탭 아이콘), square = 꽉 찬 정사각형(iOS·maskable, 기기가 모양을 깎는다) */
function svg({ shape, capRatio }) {
  const size = 512;
  const cap = size * capRatio;
  const scale = cap / 24;
  const offset = (size - cap) / 2;
  const bg =
    shape === "circle"
      ? `<circle cx="256" cy="256" r="256" fill="${BRAND}"/>`
      : `<rect width="512" height="512" fill="${BRAND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}<g transform="translate(${offset} ${offset + cap * 0.04}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CAP_PATHS}</g></svg>`;
}

const circle = svg({ shape: "circle", capRatio: 0.6 });
const square = svg({ shape: "square", capRatio: 0.56 });
const maskable = svg({ shape: "square", capRatio: 0.46 }); // 안전 영역(가운데 80%) 안에 들어가게

writeFileSync(join(outDir, "icon.svg"), circle);
const jobs = [
  [circle, "favicon.png", 64],
  [circle, "icon-192.png", 192],
  [circle, "icon-512.png", 512],
  [maskable, "icon-maskable-512.png", 512],
  [square, "apple-icon.png", 180],
];
for (const [source, name, size] of jobs) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(join(outDir, name));
}
console.log("생성 완료:", ["icon.svg", ...jobs.map((j) => j[1])].join(", "));

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = "C:/Users/PC/Quantum-Imagenes-Productos";
const candidates = path.join(root, "candidatas_gpus");
const outRoot = path.join(root, "procesadas_1000x1000", "gpus");
const originalRoot = path.join(root, "originales", "gpus-finales");

const products = [
  {
    slug: "msi-rtx3070-ventus3x-outlet",
    title: "MSI GeForce RTX 3070 Ventus 3X 8G OUTLET",
    files: ["msi3x-1.webp", "msi3x-2.webp", "msi3x-5.webp"],
  },
  {
    slug: "msi-rtx3070-ventus2x-outlet",
    title: "MSI RTX 3070 Ventus 2X OUTLET",
    files: ["msi2x-1.webp", "msi2x-2.webp", "msi2x-4.webp"],
  },
  {
    slug: "gigabyte-rtx3070ti-eagle-oc-outlet",
    title: "GIGABYTE GeForce RTX 3070 Ti EAGLE OC OUTLET",
    files: ["giga-ng-02.jpg", "giga-ng-04.jpg", "giga-ng-08.jpg"],
  },
  {
    slug: "asrock-rx6900xt-phantom-gaming-outlet",
    title: "ASRock Radeon RX 6900 XT Phantom Gaming OUTLET",
    files: ["asrock-1.jpg", "asrock-4.jpg", "asrock-5.jpg"],
  },
  {
    slug: "asus-tuf-rtx3080-outlet",
    title: "ASUS TUF Gaming GeForce RTX 3080 OUTLET",
    files: ["asus-3.png", "asus-2.png", "asus-1.png"],
  },
];

async function normalizeToPng(inputPath, outputPath) {
  const img = sharp(inputPath, { failOn: "none" }).rotate().ensureAlpha();
  const meta = await img.metadata();
  const raw = await img.raw().toBuffer();
  const width = meta.width;
  const height = meta.height;
  const channels = 4;

  function isBg(i) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2], a = channels >= 4 ? raw[i + 3] : 255;
    const nearWhite = r > 244 && g > 244 && b > 244;
    const nearBlack = r < 5 && g < 5 && b < 5;
    return a <= 12 || nearWhite || nearBlack;
  }

  const bg = new Uint8Array(width * height);
  const q = [];
  function add(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (bg[p]) return;
    if (isBg(p * channels)) {
      bg[p] = 1;
      q.push(p);
    }
  }

  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi], x = p % width, y = Math.floor(p / width);
    add(x + 1, y); add(x - 1, y); add(x, y + 1); add(x, y - 1);
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const si = p * channels, oi = p * 4;
    out[oi] = raw[si];
    out[oi + 1] = raw[si + 1];
    out[oi + 2] = raw[si + 2];
    out[oi + 3] = bg[p] ? 0 : (channels >= 4 ? raw[si + 3] : 255);
    if (out[oi + 3] > 12) {
      const x = p % width, y = Math.floor(p / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) { minX = 0; minY = 0; maxX = width - 1; maxY = height - 1; }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const padX = Math.max(10, Math.round(bw * 0.025));
  const padY = Math.max(10, Math.round(bh * 0.025));
  const left = Math.max(0, minX - padX);
  const top = Math.max(0, minY - padY);
  const cropW = Math.min(width - left, bw + padX * 2);
  const cropH = Math.min(height - top, bh + padY * 2);

  const resized = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 900, height: 900, fit: "inside", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const resizedMeta = await sharp(resized).metadata();
  await sharp({
    create: {
      width: 1000,
      height: 1000,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: resized,
      left: Math.round((1000 - resizedMeta.width) / 2),
      top: Math.round((1000 - resizedMeta.height) / 2),
    }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

await fs.mkdir(outRoot, { recursive: true });
await fs.mkdir(originalRoot, { recursive: true });

for (const product of products) {
  const productOut = path.join(outRoot, product.slug);
  const productOriginal = path.join(originalRoot, product.slug);
  await fs.rm(productOut, { recursive: true, force: true });
  await fs.mkdir(productOut, { recursive: true });
  await fs.mkdir(productOriginal, { recursive: true });

  for (let i = 0; i < product.files.length; i++) {
    const source = path.join(candidates, product.files[i]);
    const originalDest = path.join(productOriginal, `${product.slug}-${i + 1}${path.extname(product.files[i])}`);
    const finalDest = path.join(productOut, `${product.slug}-${i + 1}.png`);
    await fs.copyFile(source, originalDest);
    await normalizeToPng(source, finalDest);
    console.log(`${product.slug} ${i + 1}/3`);
  }
}

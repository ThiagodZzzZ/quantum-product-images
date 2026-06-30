import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("C:/Users/PC/Quantum-Imagenes-Productos");
const inventoryPath = path.join(root, "inventario", "productos_para_imagenes.csv");
const originalsRoot = path.join(root, "originales");
const processedRoot = path.join(root, "procesadas_1000x1000");
const reportsRoot = path.join(root, "reportes");

const USER_AGENT = "Mozilla/5.0 QuantumImageBatch/1.0";
const MAX_PRODUCTS = Number(globalThis.QUANTUM_MAX_PRODUCTS || "0");
const ONLY_CATEGORY = globalThis.QUANTUM_ONLY_CATEGORY || "";
const START_AT = Number(globalThis.QUANTUM_START_AT || "0");

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quote && ch === '"' && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { quote = !quote; continue; }
    if (!quote && ch === ",") { row.push(cur); cur = ""; continue; }
    if (!quote && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(v => v.length)) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const [rawHeaders, ...data] = rows;
  const headers = rawHeaders.map(h => h.replace(/^\uFEFF/, ""));
  return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function slugify(input) {
  return input
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function categoryDir(cat) {
  return cat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function tiendanubeCandidates(fileName) {
  const base = fileName.replace(/\.(png|jpe?g|webp)$/i, "");
  return [
    `https://acdn-us.mitiendanube.com/stores/004/499/130/products/${base}-1024-1024.webp`,
    `https://acdn-us.mitiendanube.com/stores/004/499/130/products/${base}-640-0.webp`,
    `https://acdn-us.mitiendanube.com/stores/004/499/130/products/${base}-480-0.webp`,
    `https://acdn-us.mitiendanube.com/stores/004/499/130/products/${fileName}`,
  ];
}

function imageKeyFromUrl(url) {
  return url
    .split("/").pop()
    .replace(/\?.*$/, "")
    .replace(/-\d+-(?:\d+)\.webp$/i, "")
    .replace(/\.(png|jpe?g|webp)$/i, "");
}

function extractProductImages(html) {
  const groups = new Map();
  function addGroup(key, urls) {
    if (!key || groups.has(key)) return;
    groups.set(key, urls.filter(Boolean));
  }

  const jsonMatch = html.match(/"images":\s*(\[[\s\S]*?\])\s*,\s*"images_count"/);
  if (jsonMatch) {
    try {
      const images = JSON.parse(jsonMatch[1]);
      for (const img of images) {
        if (img?.image) addGroup(imageKeyFromUrl(img.image), tiendanubeCandidates(img.image));
      }
    } catch {}
  }

  if (groups.size === 0) {
    const og = [...html.matchAll(/property=["']og:image["'][^>]+content=["']([^"']+)/gi)].map(m => m[1]);
    for (const u of og) {
      const clean = u.replace(/^http:/, "https:");
      addGroup(imageKeyFromUrl(clean), [clean]);
    }
  }

  return [...groups.values()]
    .map(urls => [...new Set(urls)].filter(u => !/logo|placeholder|payment|shipping/i.test(u)))
    .filter(urls => urls.length)
    .slice(0, 12);
}

async function normalizeToPng(buffer, outputPath) {
  const img = sharp(buffer, { failOn: "none" }).rotate().ensureAlpha();
  const meta = await img.metadata();
  const raw = await img.raw().toBuffer();
  const width = meta.width, height = meta.height;
  const channels = meta.channels || 4;
  const visible = new Uint8Array(width * height);

  function isBg(i) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2], a = channels >= 4 ? raw[i + 3] : 255;
    return a <= 12 || (r > 242 && g > 242 && b > 242) || (r < 4 && g < 4 && b < 4);
  }

  const bg = new Uint8Array(width * height);
  const q = [];
  function add(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (bg[p]) return;
    if (isBg(p * channels)) { bg[p] = 1; q.push(p); }
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
    out[oi] = raw[si]; out[oi + 1] = raw[si + 1]; out[oi + 2] = raw[si + 2];
    out[oi + 3] = bg[p] ? 0 : (channels >= 4 ? raw[si + 3] : 255);
    if (out[oi + 3] > 12) {
      const x = p % width, y = Math.floor(p / width);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      visible[p] = 1;
    }
  }

  if (maxX < 0) { minX = 0; minY = 0; maxX = width - 1; maxY = height - 1; }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const padX = Math.max(8, Math.round(bw * 0.02));
  const padY = Math.max(8, Math.round(bh * 0.02));
  const left = Math.max(0, minX - padX);
  const top = Math.max(0, minY - padY);
  const cropW = Math.min(width - left, bw + padX * 2);
  const cropH = Math.min(height - top, bh + padY * 2);

  await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 900, height: 900, fit: "inside", kernel: "lanczos3" })
    .extend({ top: 50, bottom: 50, left: 50, right: 50, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 1000, height: 1000, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

async function processProduct(item) {
  const cat = categoryDir(item.Categoria);
  const slug = `${String(item.Index).padStart(3, "0")}-${slugify(item.Title)}`;
  const originalDir = path.join(originalsRoot, cat, slug);
  const processedDir = path.join(processedRoot, cat, slug);
  await fs.mkdir(originalDir, { recursive: true });
  await fs.mkdir(processedDir, { recursive: true });

  const result = { categoria: item.Categoria, index: item.Index, title: item.Title, slug, found: 0, processed: 0, status: "pending", notes: "" };
  if (!item.SourceUrl) {
    result.status = "needs_external_search";
    result.notes = "Sin SourceUrl en manifest";
    return result;
  }

  try {
    const html = await fetchText(item.SourceUrl);
    const candidates = extractProductImages(html);
    result.found = candidates.length;
    let variant = 1;
    for (const group of candidates) {
      if (variant > 3) break;
      let done = false;
      for (const url of group) {
        try {
          const buffer = await fetchBuffer(url);
          if (buffer.length < 8000) continue;
          const originalPath = path.join(originalDir, `${variant}.source`);
          const finalPath = path.join(processedDir, `${slug}-${variant}.png`);
          await fs.writeFile(originalPath, buffer);
          await normalizeToPng(buffer, finalPath);
          variant++;
          done = true;
          break;
        } catch {}
      }
      if (!done) continue;
    }
    result.processed = variant - 1;
    result.status = result.processed >= 3 ? "complete" : "needs_more_images";
    if (result.processed < 3) result.notes = `Faltan ${3 - result.processed} imagenes`;
  } catch (err) {
    result.status = "error";
    result.notes = err.message;
  }
  return result;
}

async function main() {
  await fs.mkdir(reportsRoot, { recursive: true });
  const rows = parseCsv(await fs.readFile(inventoryPath, "utf8"))
    .filter(r => r.Included === "True" || r.Included === "true");
  const filtered = rows
    .filter(r => !ONLY_CATEGORY || r.Categoria === ONLY_CATEGORY)
    .slice(START_AT > 0 ? START_AT : 0)
    .slice(0, MAX_PRODUCTS > 0 ? MAX_PRODUCTS : undefined);

  const report = [];
  for (let i = 0; i < filtered.length; i++) {
    const r = await processProduct(filtered[i]);
    report.push(r);
    console.log(`[${START_AT + i + 1}/${START_AT + filtered.length}] ${r.status} ${r.categoria} #${r.index} ${r.processed}/3 - ${r.title}`);
  }

  const rangeSuffix = START_AT || MAX_PRODUCTS ? `-${START_AT + 1}-${START_AT + filtered.length}` : "";
  const jsonPath = path.join(reportsRoot, `batch-report${ONLY_CATEGORY ? "-" + ONLY_CATEGORY : ""}${rangeSuffix}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  const csv = ["categoria,index,title,slug,found,processed,status,notes", ...report.map(r =>
    [r.categoria, r.index, r.title, r.slug, r.found, r.processed, r.status, r.notes]
      .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
  )].join("\n");
  await fs.writeFile(jsonPath.replace(/\.json$/, ".csv"), csv, "utf8");
}

await main();

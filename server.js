const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const productsFile = path.join(dataDir, "products.json");
const ordersFile = path.join(dataDir, "orders.json");
const PORT = Number(process.env.PORT || 4173);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const sessions = new Set();

const seedProducts = [
  { id: "p1", name: "엘린 클래식 트위드 자켓", category: "women", keywords: "여성 의류 자켓", label: "BEST", price: 168000, old: 198000, stock: 12, image: "https://images.unsplash.com/photo-1548624149-f9b185c22e9d?auto=format&fit=crop&w=800&q=80" },
  { id: "p2", name: "소프트 울 니트 가디건", category: "women", keywords: "여성 의류 니트", label: "NEW", price: 89000, old: 112000, stock: 18, image: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=800&q=80" },
  { id: "p3", name: "미니멀 레더 토트백", category: "bag", keywords: "가방 토트 숄더", label: "HOT", price: 146000, old: 169000, stock: 8, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=800&q=80" },
  { id: "p4", name: "데일리 스퀘어 숄더백", category: "bag", keywords: "가방 미니백 크로스", label: "BEST", price: 118000, old: 138000, stock: 9, image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80" },
  { id: "p5", name: "모던 스웨이드 로퍼", category: "shoes", keywords: "슈즈 신발 로퍼", label: "FAST", price: 97000, old: 124000, stock: 14, image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?auto=format&fit=crop&w=800&q=80" },
  { id: "p6", name: "시티 스니커즈 크림", category: "shoes", keywords: "슈즈 신발 스니커즈", label: "NEW", price: 109000, old: 129000, stock: 17, image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=80" },
  { id: "p7", name: "남성 울 블렌드 블레이저", category: "men", keywords: "남성 의류 자켓", label: "BEST", price: 188000, old: 228000, stock: 7, image: "https://images.unsplash.com/photo-1507680434567-5739c80be1ac?auto=format&fit=crop&w=800&q=80" },
  { id: "p8", name: "릴렉스 코튼 셔츠", category: "men", keywords: "남성 의류 셔츠", label: "NEW", price: 69000, old: 82000, stock: 20, image: "https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=800&q=80" }
];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJson(productsFile, seedProducts);
  await ensureJson(ordersFile, []);
}

async function ensureJson(file, fallback) {
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, JSON.stringify(fallback, null, 2), "utf8");
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function sendWithHeaders(res, status, body, headers) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 형식이 올바르지 않습니다."));
      }
    });
  });
}

function requireAdmin(req) {
  if (req.headers["x-admin-pin"] === ADMIN_PIN) return true;
  const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => {
    const [key, ...rest] = part.trim().split("=");
    return [key, rest.join("=")];
  }).filter(([key]) => key));
  return Boolean(cookies.elin_admin_session && sessions.has(cookies.elin_admin_session));
}

function cleanProduct(input) {
  const price = Number(input.price);
  const old = Number(input.old || input.price);
  const stock = Number(input.stock || 0);
  if (!input.name || !input.category || !input.image || !Number.isFinite(price)) {
    throw new Error("상품명, 카테고리, 이미지, 가격은 필수입니다.");
  }
  return {
    id: input.id || crypto.randomUUID(),
    name: String(input.name).trim(),
    category: String(input.category).trim(),
    keywords: String(input.keywords || "").trim(),
    label: String(input.label || "NEW").trim(),
    price,
    old: Number.isFinite(old) ? old : price,
    stock: Number.isFinite(stock) ? stock : 0,
    image: String(input.image).trim()
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.username !== ADMIN_USER || body.password !== ADMIN_PASSWORD) {
      return send(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    return sendWithHeaders(res, 200, { ok: true, username: ADMIN_USER }, {
      "Set-Cookie": `elin_admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
    });
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const cookie = String(req.headers.cookie || "").match(/elin_admin_session=([^;]+)/)?.[1];
    if (cookie) sessions.delete(cookie);
    return sendWithHeaders(res, 200, { ok: true }, {
      "Set-Cookie": "elin_admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
  }

  if (url.pathname === "/api/admin/me" && req.method === "GET") {
    if (!requireAdmin(req)) return send(res, 401, { error: "로그인이 필요합니다." });
    return send(res, 200, { username: ADMIN_USER });
  }

  if (url.pathname === "/api/products" && req.method === "GET") {
    return send(res, 200, await readJson(productsFile));
  }

  if (url.pathname === "/api/products" && req.method === "POST") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 PIN이 필요합니다." });
    const products = await readJson(productsFile);
    const product = cleanProduct(await readBody(req));
    products.unshift(product);
    await writeJson(productsFile, products);
    return send(res, 201, product);
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "PUT") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 PIN이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const products = await readJson(productsFile);
    const index = products.findIndex(product => product.id === id);
    if (index < 0) return send(res, 404, { error: "상품을 찾을 수 없습니다." });
    products[index] = cleanProduct({ ...(await readBody(req)), id });
    await writeJson(productsFile, products);
    return send(res, 200, products[index]);
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "DELETE") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 PIN이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const products = await readJson(productsFile);
    await writeJson(productsFile, products.filter(product => product.id !== id));
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 PIN이 필요합니다." });
    return send(res, 200, await readJson(ordersFile));
  }

  if (url.pathname === "/api/orders" && req.method === "POST") {
    const body = await readBody(req);
    const products = await readJson(productsFile);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!body.customer?.name || !body.customer?.phone || !body.customer?.address || items.length === 0) {
      return send(res, 400, { error: "주문자 정보와 상품이 필요합니다." });
    }

    const normalized = items.map(item => {
      const product = products.find(candidate => candidate.id === item.id);
      if (!product) throw new Error("존재하지 않는 상품이 포함되어 있습니다.");
      const qty = Math.max(1, Number(item.qty || 1));
      if (product.stock < qty) throw new Error(`${product.name} 재고가 부족합니다.`);
      return { id: product.id, name: product.name, price: product.price, image: product.image, qty };
    });

    normalized.forEach(item => {
      const product = products.find(candidate => candidate.id === item.id);
      product.stock -= item.qty;
    });
    await writeJson(productsFile, products);

    const orders = await readJson(ordersFile);
    const order = {
      id: `ELIN-${Date.now()}`,
      status: "주문접수",
      customer: {
        name: String(body.customer.name).trim(),
        phone: String(body.customer.phone).trim(),
        address: String(body.customer.address).trim(),
        memo: String(body.customer.memo || "").trim()
      },
      items: normalized,
      total: normalized.reduce((sum, item) => sum + item.price * item.qty, 0),
      createdAt: new Date().toISOString()
    };
    orders.unshift(order);
    await writeJson(ordersFile, orders);
    return send(res, 201, order);
  }

  if (url.pathname.startsWith("/api/orders/") && req.method === "PATCH") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 PIN이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readBody(req);
    const orders = await readJson(ordersFile);
    const order = orders.find(candidate => candidate.id === id);
    if (!order) return send(res, 404, { error: "주문을 찾을 수 없습니다." });
    order.status = String(body.status || order.status);
    await writeJson(ordersFile, orders);
    return send(res, 200, order);
  }

  return send(res, 404, { error: "API 경로를 찾을 수 없습니다." });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  try {
    const content = await fs.readFile(filePath);
    send(res, 200, content, mime[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    send(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
  }
});

ensureData().then(() => {
  server.listen(PORT, () => {
    console.log(`ELIN shop running at http://localhost:${PORT}`);
    console.log(`Admin PIN: ${ADMIN_PIN}`);
  });
});

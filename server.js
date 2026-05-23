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
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const adminSessions = new Set();
const memberSessions = new Map();

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

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 8_000_000) {
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

function getCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }).filter(([key]) => key));
}

function setCookie(name, value, maxAge = 86400) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function requireAdmin(req) {
  if (req.headers["x-admin-pin"] === ADMIN_PIN) return true;
  const token = getCookies(req).elin_admin_session;
  return Boolean(token && adminSessions.has(token));
}

function currentMember(req) {
  const token = getCookies(req).elin_member_session;
  return token ? memberSessions.get(token) : undefined;
}

function publicMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    username: member.username || "",
    email: member.email,
    name: member.name,
    phone: member.phone || "",
    address: member.address || ""
  };
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.hint || `Supabase request failed: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function cleanProduct(input) {
  const price = Number(input.price);
  const old = Number(input.old || input.price);
  const stock = Number(input.stock || 0);
  const images = Array.isArray(input.images)
    ? input.images
    : String(input.images || input.image || "").split(/\n|,/);
  const cleanImages = images.map(image => String(image || "").trim()).filter(Boolean).slice(0, 10);
  const mainImage = cleanImages[0] || String(input.image || "").trim();
  if (!input.name || !input.category || !mainImage || !Number.isFinite(price)) {
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
    image: mainImage,
    images: cleanImages.length ? cleanImages : [mainImage]
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function listProducts() {
  if (useSupabase) return await supabase("products?select=*&order=created_at.desc");
  return await readJson(productsFile);
}

async function createProduct(input) {
  const product = cleanProduct(input);
  if (useSupabase) {
    const [created] = await supabase("products", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(product)
    });
    return created;
  }
  const products = await readJson(productsFile);
  products.unshift(product);
  await writeJson(productsFile, products);
  return product;
}

async function updateProduct(id, input) {
  const product = cleanProduct({ ...input, id });
  if (useSupabase) {
    const [updated] = await supabase(`products?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(product)
    });
    if (!updated) throw new Error("상품을 찾을 수 없습니다.");
    return updated;
  }
  const products = await readJson(productsFile);
  const index = products.findIndex(item => item.id === id);
  if (index < 0) throw new Error("상품을 찾을 수 없습니다.");
  products[index] = product;
  await writeJson(productsFile, products);
  return product;
}

async function deleteProduct(id) {
  if (useSupabase) {
    await supabase(`products?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  const products = await readJson(productsFile);
  await writeJson(productsFile, products.filter(product => product.id !== id));
}

async function listOrders() {
  const orders = useSupabase ? await supabase("orders?select=*&order=created_at.desc") : await readJson(ordersFile);
  return orders.map(order => ({ ...order, createdAt: order.createdAt || order.created_at }));
}

async function createOrder(body, member) {
  const products = await listProducts();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.customer?.name || !body.customer?.phone || !body.customer?.address || items.length === 0) {
    throw new Error("주문자 정보와 상품이 필요합니다.");
  }

  const normalized = items.map(item => {
    const product = products.find(candidate => candidate.id === item.id);
    if (!product) throw new Error("존재하지 않는 상품이 포함되어 있습니다.");
    const qty = Math.max(1, Number(item.qty || 1));
    if (Number(product.stock) < qty) throw new Error(`${product.name} 재고가 부족합니다.`);
    return {
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty,
      color: String(item.color || "기본").trim(),
      size: String(item.size || "FREE").trim()
    };
  });

  if (useSupabase) {
    for (const item of normalized) {
      const product = products.find(candidate => candidate.id === item.id);
      await supabase(`products?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ stock: Number(product.stock) - item.qty })
      });
    }
  } else {
    normalized.forEach(item => {
      const product = products.find(candidate => candidate.id === item.id);
      product.stock -= item.qty;
    });
    await writeJson(productsFile, products);
  }

  const order = {
    id: `ELIN-${Date.now()}`,
    status: "입금대기",
    customer: {
      name: String(body.customer.name).trim(),
      phone: String(body.customer.phone).trim(),
      address: String(body.customer.address).trim(),
      memo: String(body.customer.memo || "").trim(),
      depositor: String(body.customer.depositor || body.customer.name).trim(),
      bank: String(body.customer.bank || "신한은행 110-000-000000 ELIN").trim(),
      paymentMethod: "무통장입금",
      memberId: member?.id || null,
      email: member?.email || ""
    },
    items: normalized,
    total: normalized.reduce((sum, item) => sum + item.price * item.qty, 0)
  };

  if (useSupabase) {
    const [created] = await supabase("orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(order)
    });
    return { ...created, createdAt: created.created_at };
  }

  const orders = await readJson(ordersFile);
  const localOrder = { ...order, createdAt: new Date().toISOString() };
  orders.unshift(localOrder);
  await writeJson(ordersFile, orders);
  return localOrder;
}

async function updateOrderStatus(id, input) {
  const patch = typeof input === "string" ? { status: input } : {
    status: String(input.status || "입금대기"),
    tracking_company: String(input.tracking_company || "").trim(),
    tracking_number: String(input.tracking_number || "").trim(),
    admin_memo: String(input.admin_memo || "").trim()
  };
  if (useSupabase) {
    const [updated] = await supabase(`orders?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!updated) throw new Error("주문을 찾을 수 없습니다.");
    return { ...updated, createdAt: updated.created_at };
  }
  const orders = await readJson(ordersFile);
  const order = orders.find(candidate => candidate.id === id);
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  Object.assign(order, patch);
  await writeJson(ordersFile, orders);
  return order;
}

async function findMemberByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  if (useSupabase) {
    const members = await supabase(`members?email=eq.${encodeURIComponent(normalized)}&select=*`);
    return members[0] || null;
  }
  const file = path.join(dataDir, "members.json");
  await ensureJson(file, []);
  const members = await readJson(file);
  return members.find(member => member.email === normalized) || null;
}

async function findMemberByUsername(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;
  if (useSupabase) {
    const members = await supabase(`members?username=eq.${encodeURIComponent(normalized)}&select=*`);
    return members[0] || null;
  }
  const file = path.join(dataDir, "members.json");
  await ensureJson(file, []);
  const members = await readJson(file);
  return members.find(member => member.username === normalized) || null;
}

async function createMember(input) {
  const username = String(input.username || "").trim().toLowerCase();
  const email = String(input.email || `${username}@elin.local`).trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  if (!/^[a-z0-9_]{4,20}$/.test(username) || password.length < 4 || !name) {
    throw new Error("아이디는 영문/숫자/_ 조합 4~20자, 비밀번호는 4자 이상이어야 합니다.");
  }
  if (await findMemberByUsername(username)) throw new Error("이미 사용 중인 아이디입니다.");
  const member = {
    id: crypto.randomUUID(),
    username,
    email,
    password_hash: hashPassword(password),
    name,
    phone: String(input.phone || "").trim(),
    address: String(input.address || "").trim()
  };
  if (useSupabase) {
    const [created] = await supabase("members", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(member)
    });
    return created;
  }
  const file = path.join(dataDir, "members.json");
  await ensureJson(file, []);
  const members = await readJson(file);
  members.push(member);
  await writeJson(file, members);
  return member;
}

function startMemberSession(member, res) {
  const token = crypto.randomBytes(24).toString("hex");
  memberSessions.set(token, publicMember(member));
  send(res, 200, { ok: true, member: publicMember(member) }, "application/json; charset=utf-8", {
    "Set-Cookie": setCookie("elin_member_session", token)
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    if (body.username !== ADMIN_USER || body.password !== ADMIN_PASSWORD) {
      return send(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    adminSessions.add(token);
    return send(res, 200, { ok: true, username: ADMIN_USER }, "application/json; charset=utf-8", {
      "Set-Cookie": setCookie("elin_admin_session", token)
    });
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const token = getCookies(req).elin_admin_session;
    if (token) adminSessions.delete(token);
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
      "Set-Cookie": setCookie("elin_admin_session", "", 0)
    });
  }

  if (url.pathname === "/api/admin/me" && req.method === "GET") {
    if (!requireAdmin(req)) return send(res, 401, { error: "로그인이 필요합니다." });
    return send(res, 200, { username: ADMIN_USER });
  }

  if (url.pathname === "/api/auth/signup" && req.method === "POST") {
    const member = await createMember(await readBody(req));
    return startMemberSession(member, res);
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    const member = await findMemberByUsername(body.username);
    if (!member || !verifyPassword(body.password, member.password_hash)) {
      return send(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    return startMemberSession(member, res);
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = getCookies(req).elin_member_session;
    if (token) memberSessions.delete(token);
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
      "Set-Cookie": setCookie("elin_member_session", "", 0)
    });
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    return send(res, 200, { member: publicMember(currentMember(req)) });
  }

  if (url.pathname === "/api/member/orders" && req.method === "GET") {
    const member = currentMember(req);
    if (!member) return send(res, 401, { error: "로그인이 필요합니다." });
    const orders = await listOrders();
    return send(res, 200, orders.filter(order => order.customer?.memberId === member.id));
  }

  if (url.pathname === "/api/products" && req.method === "GET") {
    return send(res, 200, await listProducts());
  }

  if (url.pathname === "/api/products" && req.method === "POST") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 201, await createProduct(await readBody(req)));
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "PUT") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    return send(res, 200, await updateProduct(id, await readBody(req)));
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "DELETE") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await deleteProduct(id);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await listOrders());
  }

  if (url.pathname === "/api/orders" && req.method === "POST") {
    return send(res, 201, await createOrder(await readBody(req), currentMember(req)));
  }

  if (url.pathname.startsWith("/api/orders/") && req.method === "PATCH") {
    if (!requireAdmin(req)) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readBody(req);
    return send(res, 200, await updateOrderStatus(id, body));
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
    if (url.pathname === "/health") return send(res, 200, { ok: true, storage: useSupabase ? "supabase" : "json" });
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    send(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
  }
});

ensureData().then(() => {
  server.listen(PORT, () => {
    console.log(`ELIN shop running at http://localhost:${PORT}`);
    console.log(`Storage: ${useSupabase ? "Supabase" : "local JSON"}`);
  });
});

const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const productsFile = path.join(dataDir, "products.json");
const ordersFile = path.join(dataDir, "orders.json");
const inquiriesFile = path.join(dataDir, "inquiries.json");
const reviewsFile = path.join(dataDir, "reviews.json");
const adminSettingsFile = path.join(dataDir, "admin-settings.json");
const memberPageSettingsFile = path.join(dataDir, "member-page-settings.json");
const customerCenterSettingsFile = path.join(dataDir, "customer-center-settings.json");
const siteSettingsFile = path.join(dataDir, "site-settings.json");
const PORT = Number(process.env.PORT || 4173);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
const MEMBER_SESSION_MAX_AGE = 60 * 20;
const SESSION_SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD || "elin-session";

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
  await ensureJson(inquiriesFile, []);
  await ensureJson(reviewsFile, []);
  await ensureJson(adminSettingsFile, null);
  await ensureJson(memberPageSettingsFile, null);
  await ensureJson(customerCenterSettingsFile, null);
  await ensureJson(siteSettingsFile, null);
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

function setCookie(name, value, maxAge = SESSION_MAX_AGE) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function sessionSignature(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

function createSignedToken(type, data, maxAge = SESSION_MAX_AGE) {
  const expires = Date.now() + maxAge * 1000;
  const payload = Buffer.from(JSON.stringify({ type, data, expires })).toString("base64url");
  return `${payload}.${sessionSignature(payload)}`;
}

function readSignedToken(token, expectedType) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || sessionSignature(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.type !== expectedType || Number(parsed.expires || 0) < Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function adminSettings() {
  const fallback = { username: ADMIN_USER, password: ADMIN_PASSWORD, pin: ADMIN_PIN };
  const localSettings = async () => {
    try {
      const saved = await readJson(adminSettingsFile);
      return saved || fallback;
    } catch {
      return fallback;
    }
  };
  const local = await localSettings();
  if (useSupabase) {
    try {
      const rows = await supabase("admin_settings?select=key,value");
      const values = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
      return {
        username: values.username || local.username,
        password: values.password || local.password,
        pin: values.pin || local.pin
      };
    } catch {
      return local;
    }
  }
  return local;
}

async function saveAdminSettings(settings) {
  if (useSupabase) {
    try {
      await supabase("admin_settings?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([
          { key: "username", value: settings.username },
          { key: "password", value: settings.password },
          { key: "pin", value: settings.pin }
        ])
      });
      const saved = await adminSettings();
      if (saved.username !== settings.username || saved.password !== settings.password || saved.pin !== settings.pin) {
        throw new Error("관리자 정보가 DB에 저장되지 않았습니다. Supabase admin_settings 테이블을 확인해주세요.");
      }
      return;
    } catch (error) {
      throw new Error(error.message || "관리자 정보 저장에 실패했습니다.");
    }
  }
  await writeJson(adminSettingsFile, settings);
}

const defaultMemberPageSettings = {
  pageTitle: "마이페이지",
  introText: "회원 정보와 주문 내역을 확인할 수 있습니다.",
  heroImage: "",
  heroImageAlt: "회원페이지 이미지",
  memberBoxTitle: "회원 정보",
  ordersTitle: "주문내역",
  inquiriesTitle: "1:1 문의내역",
  noticeText: "무통장 입금 주문은 입금 확인 후 배송이 시작됩니다.",
  loginRequiredText: "로그인이 필요합니다.",
  loginLinkText: "로그인하기",
  emptyOrderText: "아직 주문내역이 없습니다.",
  emptyInquiryText: "아직 문의내역이 없습니다.",
  inquiryLinkText: "문의하기",
  supportText: "문의가 필요하면 고객센터로 연락해주세요.",
  supportLinkText: "고객센터",
  supportLinkUrl: "/customer.html",
  showUsername: true,
  showPhone: true,
  showAddress: true,
  showOrderStatus: true,
  showBankInfo: true,
  showTracking: true
};

function normalizeMemberPageSettings(input = {}) {
  const settings = { ...defaultMemberPageSettings, ...(input || {}) };
  for (const key of [
    "pageTitle",
    "introText",
    "heroImage",
    "heroImageAlt",
    "memberBoxTitle",
    "ordersTitle",
    "inquiriesTitle",
    "noticeText",
    "loginRequiredText",
    "loginLinkText",
    "emptyOrderText",
    "emptyInquiryText",
    "inquiryLinkText",
    "supportText",
    "supportLinkText",
    "supportLinkUrl"
  ]) {
    settings[key] = String(settings[key] || "").trim();
  }
  for (const key of ["showUsername", "showPhone", "showAddress", "showOrderStatus", "showBankInfo", "showTracking"]) {
    settings[key] = Boolean(settings[key]);
  }
  return settings;
}

async function memberPageSettings() {
  const localSettings = async () => {
    try {
      const saved = await readJson(memberPageSettingsFile);
      return normalizeMemberPageSettings(saved);
    } catch {
      return normalizeMemberPageSettings();
    }
  };
  const local = await localSettings();
  if (useSupabase) {
    try {
      const rows = await supabase("admin_settings?key=eq.member_page_settings&select=value");
      if (rows?.[0]?.value) return normalizeMemberPageSettings(JSON.parse(rows[0].value));
    } catch {}
  }
  return local;
}

async function saveMemberPageSettings(settings) {
  const normalized = normalizeMemberPageSettings(settings);
  await writeJson(memberPageSettingsFile, normalized);
  if (useSupabase) {
    try {
      await supabase("admin_settings?on_conflict=key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ key: "member_page_settings", value: JSON.stringify(normalized) }])
      });
    } catch {}
  }
  return normalized;
}

const defaultCustomerCenterSettings = {
  title: "고객센터",
  introText: "주문, 입금, 배송, 교환/반품 문의를 남겨주세요. 관리자 페이지에서 접수 내용을 확인하고 답변할 수 있습니다.",
  guideTitle: "이용 안내",
  guideItems: [
    { title: "상담시간", text: "평일 11:00 - 18:00" },
    { title: "점심시간", text: "13:00 - 14:00" },
    { title: "입금계좌", text: "신한은행 110-000-000000 ELIN" },
    { title: "문의 처리", text: "문의 접수 후 관리자 확인 순서대로 답변됩니다." }
  ],
  csHoursTitle: "상담시간",
  csHoursText: "평일 11:00 - 18:00",
  lunchTitle: "점심시간",
  lunchText: "13:00 - 14:00",
  bankTitle: "입금계좌",
  bankText: "신한은행 110-000-000000 ELIN",
  processTitle: "문의 처리",
  processText: "문의 접수 후 관리자 확인 순서대로 답변됩니다.",
  faqTitle: "자주 묻는 질문",
  faqs: [
    { title: "무통장 입금 확인은 어떻게 되나요?", text: "주문서의 입금자명과 실제 입금자명이 같아야 빠르게 확인됩니다. 입금 확인 후 주문 상태가 배송준비로 변경됩니다." },
    { title: "배송은 얼마나 걸리나요?", text: "상품 준비 후 순차 출고됩니다. 입금 확인 후 안내 순서대로 처리됩니다." },
    { title: "교환/반품은 가능한가요?", text: "상품 수령 후 7일 이내 문의를 접수해주세요. 착용 흔적, 오염, 택 제거 등 상품 가치가 훼손된 경우 제한될 수 있습니다." }
  ],
  faq1Title: "무통장 입금 확인은 어떻게 되나요?",
  faq1Text: "주문서의 입금자명과 실제 입금자명이 같아야 빠르게 확인됩니다. 입금 확인 후 주문 상태가 배송준비로 변경됩니다.",
  faq2Title: "배송은 얼마나 걸리나요?",
  faq2Text: "상품 준비 후 순차 출고됩니다. 입금 확인 후 안내 순서대로 처리됩니다.",
  faq3Title: "교환/반품은 가능한가요?",
  faq3Text: "상품 수령 후 7일 이내 문의를 접수해주세요. 착용 흔적, 오염, 택 제거 등 상품 가치가 훼손된 경우 제한될 수 있습니다.",
  loginRequiredText: "문의 접수는 로그인한 회원만 가능합니다.",
  loginLinkText: "로그인하기"
};

function normalizeCustomerCenterSettings(input = {}) {
  const settings = { ...defaultCustomerCenterSettings, ...(input || {}) };
  for (const key of Object.keys(defaultCustomerCenterSettings)) {
    if (key === "guideItems" || key === "faqs") continue;
    settings[key] = String(settings[key] || "").trim();
  }
  const legacyGuideItems = [
    { title: settings.csHoursTitle, text: settings.csHoursText },
    { title: settings.lunchTitle, text: settings.lunchText },
    { title: settings.bankTitle, text: settings.bankText },
    { title: settings.processTitle, text: settings.processText }
  ];
  const legacyFaqs = [
    { title: settings.faq1Title, text: settings.faq1Text },
    { title: settings.faq2Title, text: settings.faq2Text },
    { title: settings.faq3Title, text: settings.faq3Text }
  ];
  const cleanItems = items => (Array.isArray(items) ? items : [])
    .map(item => ({ title: String(item?.title || "").trim(), text: String(item?.text || "").trim() }))
    .filter(item => item.title || item.text)
    .slice(0, 20);
  settings.guideItems = Array.isArray(input.guideItems) ? cleanItems(input.guideItems) : cleanItems(legacyGuideItems);
  settings.faqs = Array.isArray(input.faqs) ? cleanItems(input.faqs) : cleanItems(legacyFaqs);
  return settings;
}

async function customerCenterSettings() {
  const localSettings = async () => {
    try {
      const saved = await readJson(customerCenterSettingsFile);
      return normalizeCustomerCenterSettings(saved);
    } catch {
      return normalizeCustomerCenterSettings();
    }
  };
  const local = await localSettings();
  if (useSupabase) {
    try {
      const rows = await supabase("admin_settings?key=eq.customer_center_settings&select=value");
      if (rows?.[0]?.value) return normalizeCustomerCenterSettings(JSON.parse(rows[0].value));
    } catch {}
  }
  return local;
}

async function saveCustomerCenterSettings(settings) {
  const normalized = normalizeCustomerCenterSettings(settings);
  await writeJson(customerCenterSettingsFile, normalized);
  if (useSupabase) {
    await supabase("admin_settings?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ key: "customer_center_settings", value: JSON.stringify(normalized) }])
    });
  }
  return normalized;
}

const defaultHeroSlides = [
  {
    className: "luxury-watch",
    image: "",
    title: "26SS Celebrity Daily Bag",
    text: "명품관 무드로 선별한 데일리 백과 액세서리 셀렉션.",
    buttonText: "바로가기",
    buttonUrl: "#products"
  },
  {
    className: "luxury-bag",
    image: "",
    title: "Louis Vuitton Gallery",
    text: "쇼윈도에 진열된 명품 백처럼 고급스럽게 구성한 컬렉션.",
    buttonText: "가방 보기",
    buttonUrl: "#products"
  },
  {
    className: "luxury-sneakers",
    image: "",
    title: "Premium Sneakers",
    text: "스니커즈, 슈즈, 데일리 아이템을 한 번에 둘러보세요.",
    buttonText: "스니커즈 보기",
    buttonUrl: "#products"
  },
  {
    className: "luxury-jewelry",
    image: "",
    title: "ROLEX WATCH",
    text: "서브마리너 무드의 클래식한 명품 시계 셀렉션.",
    buttonText: "시계 보기",
    buttonUrl: "#products"
  }
];

const defaultCategoryCards = [
  { title: "WOMEN", text: "아우터 · 니트 · 팬츠", image: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=700&q=80" },
  { title: "MAN", text: "셔츠 · 아우터 · 팬츠", image: "https://images.unsplash.com/photo-1507680434567-5739c80be1ac?auto=format&fit=crop&w=700&q=80" },
  { title: "BAG", text: "토트 · 숄더 · 미니백", image: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=700&q=80" },
  { title: "SHOES", text: "스니커즈 · 로퍼 · 샌들", image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=80" },
  { title: "ACCESSORY", text: "주얼리 · 벨트 · 지갑", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=700&q=80" },
  { title: "WATCH", text: "클래식 · 데일리", image: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=700&q=80" }
];

const defaultSiteSettings = {
  footerBrandTitle: "ELIN",
  footerBrandText: "Online Select Shop\nMon-Fri 11:00 - 18:00",
  footerCompanyTitle: "Company",
  footerCompanyText: "상호명 ELIN · 대표 관리자 · 사업자등록번호 000-00-00000",
  storyTitle: "좋은 상품에는 기준이 있습니다",
  storyText: "ELIN은 빠른 업데이트와 보기 쉬운 상품 구성, 회원 주문조회, 무통장 입금 주문 흐름을 갖춘 온라인 셀렉트샵입니다.\n상품 사진과 설명은 관리자에서 직접 등록하고 관리할 수 있습니다.",
  storyImage: "",
  productGuidePurchaseTitle: "구매 전 안내",
  productGuidePurchaseText: "상품 이미지는 모니터 환경에 따라 색상이 다르게 보일 수 있습니다.\n주문 전 옵션과 배송지를 꼭 확인해주세요.",
  productGuideShippingTitle: "배송 안내",
  productGuideShippingText: "입금 확인 후 영업일 기준 1~3일 내 순차 출고됩니다.",
  productGuideReturnTitle: "교환/반품 안내",
  productGuideReturnText: "상품 수령 후 7일 이내 고객센터로 접수해주세요. 사용 흔적이 있거나 구성품이 누락된 경우 제한될 수 있습니다.",
  productExchangeTitle: "배송 및 교환 안내",
  productExchangeRows: [
    { label: "결제 방식", text: "현재 ELIN은 무통장 입금 방식으로 주문을 받습니다. 주문 후 안내된 계좌로 입금해 주세요." },
    { label: "배송 기간", text: "입금 확인 후 영업일 기준 1~3일 내 출고됩니다. 도서산간 지역은 추가 시간이 소요될 수 있습니다." },
    { label: "교환/반품", text: "상품 수령 후 7일 이내 접수 가능합니다. 착용, 세탁, 훼손, 구성품 누락 시 처리가 어려울 수 있습니다." },
    { label: "고객센터", text: "주문조회 또는 고객센터 메뉴를 통해 문의를 남겨주세요." }
  ],
  productInfoRows: [
    { label: "배송비", text: "기본 3,000원 / 100,000원 이상 무료배송" },
    { label: "결제", text: "무통장 입금 확인 후 순차 출고" },
    { label: "문의", text: "주문 전 상품 상태와 옵션을 확인해주세요." }
  ],
  footerLinks: [
    { label: "이용약관", url: "/terms.html" },
    { label: "개인정보처리방침", url: "/privacy.html" },
    { label: "배송/교환 안내", url: "/customer.html" }
  ],
  heroSlides: defaultHeroSlides,
  categoryCards: defaultCategoryCards
};

function cleanVisualItems(items, fallback, limit, hasButton = false) {
  const hasCustomItems = Array.isArray(items);
  const source = hasCustomItems ? items : fallback;
  return Array.from({ length: limit }, (_, index) => {
    const base = fallback[index] || {};
    const item = source[index] || {};
    const hasItem = hasCustomItems && item && typeof item === "object";
    const clean = {
      ...base,
      title: String(hasItem ? item.title || "" : base.title || "").trim(),
      text: String(hasItem ? item.text || "" : base.text || "").trim(),
      image: String(hasItem ? item.image || "" : base.image || "").trim()
    };
    if (hasButton) {
      clean.className = String(base.className || item.className || "").trim();
      clean.buttonText = String(hasItem ? item.buttonText || "" : base.buttonText || "").trim();
      clean.buttonUrl = String(hasItem ? item.buttonUrl || "" : base.buttonUrl || "").trim();
    }
    return clean;
  });
}

function normalizeSiteSettings(input = {}) {
  const settings = { ...defaultSiteSettings, ...(input || {}) };
  for (const key of [
    "footerBrandTitle",
    "footerBrandText",
    "footerCompanyTitle",
    "footerCompanyText",
    "storyTitle",
    "storyText",
    "storyImage",
    "productGuidePurchaseTitle",
    "productGuidePurchaseText",
    "productGuideShippingTitle",
    "productGuideShippingText",
    "productGuideReturnTitle",
    "productGuideReturnText",
    "productExchangeTitle"
  ]) {
    settings[key] = String(settings[key] || "").trim();
  }
  settings.footerLinks = (Array.isArray(input.footerLinks) ? input.footerLinks : defaultSiteSettings.footerLinks)
    .map(link => ({
      label: String(link?.label || "").trim(),
      url: String(link?.url || "").trim()
    }))
    .filter(link => link.label || link.url)
    .slice(0, 10);
  settings.productInfoRows = Array.from({ length: 3 }, (_, index) => {
    const fallback = defaultSiteSettings.productInfoRows[index] || {};
    const source = Array.isArray(input.productInfoRows) ? input.productInfoRows[index] || {} : fallback;
    return {
      label: String(source.label || fallback.label || "").trim(),
      text: String(source.text || fallback.text || "").trim()
    };
  });
  settings.productExchangeRows = Array.from({ length: 4 }, (_, index) => {
    const fallback = defaultSiteSettings.productExchangeRows[index] || {};
    const source = Array.isArray(input.productExchangeRows) ? input.productExchangeRows[index] || {} : fallback;
    return {
      label: String(source.label || fallback.label || "").trim(),
      text: String(source.text || fallback.text || "").trim()
    };
  });
  settings.heroSlides = cleanVisualItems(input.heroSlides, defaultHeroSlides, 4, true);
  settings.categoryCards = cleanVisualItems(input.categoryCards, defaultCategoryCards, 6);
  return settings;
}

async function siteSettings() {
  const localSettings = async () => {
    try {
      const saved = await readJson(siteSettingsFile);
      return normalizeSiteSettings(saved);
    } catch {
      return normalizeSiteSettings();
    }
  };
  const local = await localSettings();
  if (useSupabase) {
    try {
      const rows = await supabase("admin_settings?key=eq.site_settings&select=value");
      const latest = rows?.[rows.length - 1];
      if (latest?.value) return normalizeSiteSettings(JSON.parse(latest.value));
    } catch {}
  }
  return local;
}

async function saveSiteSettings(settings) {
  const normalized = normalizeSiteSettings(settings);
  await writeJson(siteSettingsFile, normalized);
  if (useSupabase) {
    try {
      await supabase("admin_settings?key=eq.site_settings", { method: "DELETE" });
    } catch {}
    await supabase("admin_settings", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ key: "site_settings", value: JSON.stringify(normalized) }])
    });
  }
  return normalized;
}

async function requireAdmin(req) {
  const settings = await adminSettings();
  if (req.headers["x-admin-pin"] === settings.pin) return true;
  const token = getCookies(req).elin_admin_session;
  if (token && adminSessions.has(token)) return true;
  const signed = readSignedToken(token, "admin");
  return Boolean(signed?.username === settings.username);
}

function currentMember(req) {
  const token = getCookies(req).elin_member_session;
  if (!token) return undefined;
  const memoryMember = memberSessions.get(token);
  if (memoryMember) {
    const lastSeen = Date.parse(memoryMember.lastSeenAt || memoryMember.loginAt || "");
    if (lastSeen && Date.now() - lastSeen > MEMBER_SESSION_MAX_AGE * 1000) {
      memberSessions.delete(token);
      return undefined;
    }
    memoryMember.lastSeenAt = new Date().toISOString();
    return memoryMember;
  }
  const signed = readSignedToken(token, "member");
  if (signed) {
    memberSessions.set(token, {
      ...signed,
      loginAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
  }
  return signed || undefined;
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

function listActiveMembers() {
  const unique = new Map();
  for (const [token, session] of memberSessions.entries()) {
    if (!session?.id) continue;
    const lastSeen = Date.parse(session.lastSeenAt || session.loginAt || "");
    if (lastSeen && Date.now() - lastSeen > MEMBER_SESSION_MAX_AGE * 1000) {
      memberSessions.delete(token);
      continue;
    }
    const existing = unique.get(session.id);
    if (!existing || String(session.lastSeenAt || "").localeCompare(String(existing.lastSeenAt || "")) > 0) {
      unique.set(session.id, {
        id: session.id,
        username: session.username || "",
        email: session.email || "",
        name: session.name || "",
        phone: session.phone || "",
        address: session.address || "",
        loginAt: session.loginAt || "",
        lastSeenAt: session.lastSeenAt || ""
      });
    }
  }
  return [...unique.values()].sort((a, b) => String(b.lastSeenAt || b.loginAt).localeCompare(String(a.lastSeenAt || a.loginAt)));
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
  const stock = Number(input.stock || 9999);
  const images = Array.isArray(input.images)
    ? input.images
    : String(input.images || input.image || "").split(/\n+/);
  const cleanImages = images.map(image => String(image || "").trim()).filter(Boolean).slice(0, 10);
  const parseOptions = (value, fallback) => {
    const items = Array.isArray(value)
      ? value
      : String(value || "").split(/[\n,]+/);
    const clean = items.map(item => String(item || "").trim()).filter(Boolean).slice(0, 30);
    return clean.length ? clean : [fallback];
  };
  const colors = parseOptions(input.colors, "기본");
  const sizes = parseOptions(input.sizes, "FREE");
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
    old: price,
    stock: Number.isFinite(stock) ? stock : 9999,
    colors,
    sizes,
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

async function deleteOrder(id) {
  if (useSupabase) {
    await supabase(`orders?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return;
  }
  const orders = await readJson(ordersFile);
  await writeJson(ordersFile, orders.filter(order => order.id !== id));
}

async function listInquiries() {
  const inquiries = useSupabase ? await supabase("inquiries?select=*&order=created_at.desc") : await readJson(inquiriesFile);
  return inquiries.map(item => ({ ...item, createdAt: item.createdAt || item.created_at }));
}

async function listMemberInquiries(memberId) {
  if (!memberId) return [];
  const inquiries = useSupabase
    ? await supabase(`inquiries?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=created_at.desc`)
    : (await readJson(inquiriesFile)).filter(item => item.member_id === memberId);
  return inquiries.map(item => ({ ...item, createdAt: item.createdAt || item.created_at }));
}

async function createInquiry(input, member) {
  if (!member) {
    throw new Error("로그인한 회원만 문의를 접수할 수 있습니다.");
  }
  const inquiry = {
    id: `QNA-${Date.now()}`,
    status: "접수",
    category: String(input.category || "고객문의").trim(),
    subject: String(input.subject || "").trim(),
    name: String(input.name || member.name || "").trim(),
    phone: String(input.phone || member.phone || "").trim(),
    email: String(input.email || member.email || "").trim(),
    order_id: String(input.order_id || "").trim(),
    message: String(input.message || "").trim(),
    answer: "",
    admin_memo: "",
    member_id: member?.id || null
  };
  if (!inquiry.subject || !inquiry.message) {
    throw new Error("문의 제목과 내용을 입력해주세요.");
  }
  if (useSupabase) {
    const [created] = await supabase("inquiries", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(inquiry)
    });
    return { ...created, createdAt: created.created_at };
  }
  const inquiries = await readJson(inquiriesFile);
  const localInquiry = { ...inquiry, createdAt: new Date().toISOString() };
  inquiries.unshift(localInquiry);
  await writeJson(inquiriesFile, inquiries);
  return localInquiry;
}

async function updateInquiry(id, input) {
  const patch = {
    status: String(input.status || "접수").trim(),
    answer: String(input.answer || "").trim(),
    admin_memo: String(input.admin_memo || "").trim()
  };
  if (useSupabase) {
    const [updated] = await supabase(`inquiries?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!updated) throw new Error("문의를 찾을 수 없습니다.");
    return { ...updated, createdAt: updated.created_at };
  }
  const inquiries = await readJson(inquiriesFile);
  const inquiry = inquiries.find(item => item.id === id);
  if (!inquiry) throw new Error("문의를 찾을 수 없습니다.");
  Object.assign(inquiry, patch);
  await writeJson(inquiriesFile, inquiries);
  return inquiry;
}

async function listReviews() {
  const reviews = await readJson(reviewsFile);
  return reviews.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function createReview(input, member) {
  const rating = Math.max(1, Math.min(5, Number(input.rating || 5)));
  const review = {
    id: `REV-${Date.now()}`,
    rating,
    title: String(input.title || "").trim(),
    content: String(input.content || "").trim(),
    productName: String(input.productName || "").trim(),
    image: String(input.image || "").trim(),
    username: String(input.username || input.name || member?.username || "고객").trim(),
    name: String(input.username || input.name || member?.username || "고객").trim(),
    memberId: member?.id || null
  };
  if (!review.title || !review.content) {
    throw new Error("후기 제목과 내용을 입력해주세요.");
  }
  const reviews = await readJson(reviewsFile);
  const localReview = { ...review, createdAt: new Date().toISOString() };
  reviews.unshift(localReview);
  await writeJson(reviewsFile, reviews);
  return localReview;
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

async function listMembers() {
  const members = useSupabase ? await supabase("members?select=*") : await (async () => {
    const file = path.join(dataDir, "members.json");
    await ensureJson(file, []);
    return await readJson(file);
  })();
  return members
    .map(adminMemberView)
    .sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
}

function adminMemberView(member) {
  return {
    id: member.id,
    username: member.username || "",
    email: member.email || "",
    name: member.name || "",
    phone: member.phone || "",
    address: member.address || "",
    createdAt: member.createdAt || member.created_at || ""
  };
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
  members.push({ ...member, createdAt: new Date().toISOString() });
  await writeJson(file, members);
  return member;
}

async function updateMember(id, input) {
  const username = String(input.username || "").trim().toLowerCase();
  const email = String(input.email || `${username}@elin.local`).trim().toLowerCase();
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const address = String(input.address || "").trim();
  const password = String(input.password || "");
  if (!/^[a-z0-9_]{4,20}$/.test(username) || !name) {
    throw new Error("아이디는 영문/숫자/_ 조합 4~20자, 이름은 필수입니다.");
  }
  if (password && password.length < 4) throw new Error("비밀번호는 4자 이상으로 입력하세요.");
  const existing = await findMemberByUsername(username);
  if (existing && existing.id !== id) throw new Error("이미 사용 중인 아이디입니다.");

  const patch = { username, email, name, phone, address };
  if (password) patch.password_hash = hashPassword(password);

  if (useSupabase) {
    const [updated] = await supabase(`members?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!updated) throw new Error("회원을 찾을 수 없습니다.");
    for (const [token, session] of memberSessions.entries()) {
      if (session.id === id) memberSessions.set(token, { ...session, ...publicMember(updated) });
    }
    return adminMemberView(updated);
  }

  const file = path.join(dataDir, "members.json");
  await ensureJson(file, []);
  const members = await readJson(file);
  const member = members.find(item => item.id === id);
  if (!member) throw new Error("회원을 찾을 수 없습니다.");
  Object.assign(member, patch);
  await writeJson(file, members);
  for (const [token, session] of memberSessions.entries()) {
    if (session.id === id) memberSessions.set(token, { ...session, ...publicMember(member) });
  }
  return adminMemberView(member);
}

async function deleteMember(id) {
  if (useSupabase) {
    await supabase(`members?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  } else {
    const file = path.join(dataDir, "members.json");
    await ensureJson(file, []);
    const members = await readJson(file);
    await writeJson(file, members.filter(member => member.id !== id));
  }
  for (const [token, session] of memberSessions.entries()) {
    if (session.id === id) memberSessions.delete(token);
  }
}

function startMemberSession(member, res) {
  const publicData = publicMember(member);
  const token = createSignedToken("member", publicData, MEMBER_SESSION_MAX_AGE);
  memberSessions.set(token, {
    ...publicData,
    loginAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });
  send(res, 200, { ok: true, member: publicData }, "application/json; charset=utf-8", {
    "Set-Cookie": setCookie("elin_member_session", token, MEMBER_SESSION_MAX_AGE)
  });
}

function refreshMemberSession(member) {
  const publicData = publicMember(member);
  const token = createSignedToken("member", publicData, MEMBER_SESSION_MAX_AGE);
  const now = new Date().toISOString();
  memberSessions.set(token, {
    ...publicData,
    loginAt: member.loginAt || now,
    lastSeenAt: now
  });
  return { "Set-Cookie": setCookie("elin_member_session", token, MEMBER_SESSION_MAX_AGE) };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    const settings = await adminSettings();
    if (body.username !== settings.username || body.password !== settings.password) {
      return send(res, 401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = createSignedToken("admin", { username: settings.username });
    adminSessions.add(token);
    return send(res, 200, { ok: true, username: settings.username }, "application/json; charset=utf-8", {
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
    if (!(await requireAdmin(req))) return send(res, 401, { error: "로그인이 필요합니다." });
    const settings = await adminSettings();
    return send(res, 200, { username: settings.username });
  }

  if (url.pathname === "/api/admin/settings" && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const body = await readBody(req);
    const settings = await adminSettings();
    if (String(body.currentPassword || "") !== settings.password) {
      return send(res, 400, { error: "현재 비밀번호가 맞지 않습니다." });
    }
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    const pin = String(body.pin || "").trim();
    if (!/^[a-zA-Z0-9_]{4,24}$/.test(username)) {
      return send(res, 400, { error: "관리자 아이디는 영문/숫자/_ 조합 4~24자로 입력하세요." });
    }
    if (password.length < 4) return send(res, 400, { error: "비밀번호는 4자 이상으로 입력하세요." });
    if (!/^[0-9]{4,12}$/.test(pin)) return send(res, 400, { error: "PIN은 숫자 4~12자리로 입력하세요." });
    await saveAdminSettings({ username, password, pin });
    return send(res, 200, { ok: true, username });
  }

  if (url.pathname === "/api/admin/member-page-settings" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await memberPageSettings());
  }

  if (url.pathname === "/api/admin/member-page-settings" && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await saveMemberPageSettings(await readBody(req)));
  }

  if (url.pathname === "/api/admin/customer-center-settings" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await customerCenterSettings());
  }

  if (url.pathname === "/api/admin/customer-center-settings" && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await saveCustomerCenterSettings(await readBody(req)));
  }

  if (url.pathname === "/api/admin/site-settings" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await siteSettings());
  }

  if (url.pathname === "/api/admin/site-settings" && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await saveSiteSettings(await readBody(req)));
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
    const member = currentMember(req);
    return send(res, 200, { member: publicMember(member) }, "application/json; charset=utf-8", member ? refreshMemberSession(member) : {});
  }

  if (url.pathname === "/api/member-page-settings" && req.method === "GET") {
    return send(res, 200, await memberPageSettings());
  }

  if (url.pathname === "/api/customer-center-settings" && req.method === "GET") {
    return send(res, 200, await customerCenterSettings());
  }

  if (url.pathname === "/api/site-settings" && req.method === "GET") {
    return send(res, 200, await siteSettings());
  }

  if (url.pathname === "/api/admin/members" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await listMembers());
  }

  if (url.pathname.startsWith("/api/admin/members/") && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    return send(res, 200, await updateMember(id, await readBody(req)));
  }

  if (url.pathname.startsWith("/api/admin/members/") && req.method === "DELETE") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await deleteMember(id);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/active-members" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, listActiveMembers());
  }

  if (url.pathname === "/api/inquiries" && req.method === "POST") {
    const member = currentMember(req);
    return send(res, 201, await createInquiry(await readBody(req), member), "application/json; charset=utf-8", member ? refreshMemberSession(member) : {});
  }

  if (url.pathname === "/api/admin/inquiries" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await listInquiries());
  }

  if (url.pathname.startsWith("/api/admin/inquiries/") && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    return send(res, 200, await updateInquiry(id, await readBody(req)));
  }

  if (url.pathname === "/api/member/orders" && req.method === "GET") {
    const member = currentMember(req);
    if (!member) return send(res, 401, { error: "로그인이 필요합니다." });
    const orders = await listOrders();
    return send(res, 200, orders.filter(order => order.customer?.memberId === member.id), "application/json; charset=utf-8", refreshMemberSession(member));
  }

  if (url.pathname === "/api/member/inquiries" && req.method === "GET") {
    const member = currentMember(req);
    if (!member) return send(res, 401, { error: "로그인이 필요합니다." });
    return send(res, 200, await listMemberInquiries(member.id), "application/json; charset=utf-8", refreshMemberSession(member));
  }

  if (url.pathname === "/api/reviews" && req.method === "GET") {
    return send(res, 200, await listReviews());
  }

  if (url.pathname === "/api/reviews" && req.method === "POST") {
    const member = currentMember(req);
    return send(res, 201, await createReview(await readBody(req), member), "application/json; charset=utf-8", member ? refreshMemberSession(member) : {});
  }

  if (url.pathname === "/api/products" && req.method === "GET") {
    return send(res, 200, await listProducts());
  }

  if (url.pathname === "/api/products" && req.method === "POST") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 201, await createProduct(await readBody(req)));
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "PUT") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    return send(res, 200, await updateProduct(id, await readBody(req)));
  }

  if (url.pathname.startsWith("/api/products/") && req.method === "DELETE") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await deleteProduct(id);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/orders" && req.method === "GET") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    return send(res, 200, await listOrders());
  }

  if (url.pathname === "/api/orders" && req.method === "POST") {
    const member = currentMember(req);
    return send(res, 201, await createOrder(await readBody(req), member), "application/json; charset=utf-8", member ? refreshMemberSession(member) : {});
  }

  if (url.pathname.startsWith("/api/orders/") && req.method === "PATCH") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readBody(req);
    return send(res, 200, await updateOrderStatus(id, body));
  }

  if (url.pathname.startsWith("/api/orders/") && req.method === "DELETE") {
    if (!(await requireAdmin(req))) return send(res, 401, { error: "관리자 로그인이 필요합니다." });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    await deleteOrder(id);
    return send(res, 200, { ok: true });
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


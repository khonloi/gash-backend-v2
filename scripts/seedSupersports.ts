import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Cart } from '../src/models/Cart.js';
import { Order } from '../src/models/Order.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { slugify } from '../src/utils/slugify.js';

interface ShopifyOption {
  name: string;
  values: string[];
}

interface ShopifyVariant {
  id: number;
  title: string;
  sku?: string;
  price: string;
  compare_at_price?: string | null;
  available?: boolean;
  option1?: string | null;
  option2?: string | null;
}

interface ShopifyImage {
  src: string;
  alt?: string | null;
  position?: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: ShopifyVariant[];
  options: ShopifyOption[];
  images: ShopifyImage[];
}

const SUPERSPORTS_PAGES = [
  1, 5, 12, 16, 20, 22, 25, 28, 32, 36, 40, 44, 48, 52, 56, 60,
];
const VND_TO_USD_RATE = 25000;
const VIETNAMESE_CHAR_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

const COLOR_DICTIONARY: Record<string, string> = {
  ĐEN: 'Black',
  TRẮNG: 'White',
  'XANH DƯƠNG': 'Blue',
  'XANH NAVY': 'Navy',
  'XANH LÁ': 'Green',
  'XANH MINT': 'Mint Green',
  'XANH QUÂN ĐỘI': 'Olive Green',
  XÁM: 'Grey',
  ĐỎ: 'Red',
  HỒNG: 'Pink',
  CAM: 'Orange',
  'CAM SAN HÔ': 'Coral Orange',
  VÀNG: 'Yellow',
  'VÀNG CHANH': 'Lime Yellow',
  BE: 'Beige',
  KEM: 'Cream',
  NÂU: 'Brown',
  TÍM: 'Purple',
  BẠC: 'Silver',
  'ĐA SẮC': 'Multi-Color',
  'NHIỀU MÀU': 'Multi-Color',
};

const BRAND_DISPLAY_MAP: Record<string, string> = {
  '2XU': '2XU',
  ADIDAS: 'Adidas',
  HOKA: 'HOKA',
  NIKE: 'Nike',
  'UNDER ARMOUR': 'Under Armour',
  DESCENTE: 'Descente',
  COLUMBIA: 'Columbia',
  PUMA: 'Puma',
  BUFF: 'Buff',
  JOOLA: 'JOOLA',
  SOFSOLE: 'Sofsole',
  SKLZ: 'SKLZ',
  WABOBA: 'Waboba',
  CROCS: 'Crocs',
  MIZUNO: 'Mizuno',
  'ON RUNNING': 'On Running',
  ZOGGS: 'Zoggs',
  "O'NEILL": "O'Neill",
  'NIKE SWIM': 'Nike Swim',
  SPEEDO: 'Speedo',
};

const TAG_DICTIONARY: Record<string, string> = {
  'Chạy bộ': 'Running',
  'Luyện tập': 'Training',
  'Bóng đá': 'Football',
  'Bơi lội': 'Swimming',
  'Thời trang': 'Lifestyle',
  'Ngoài trời': 'Outdoor',
  'Quần áo': 'Apparel',
  'Giày dép': 'Footwear',
  'Phụ kiện': 'Accessories',
  Nam: 'Men',
  Nữ: 'Women',
  'Trẻ em': 'Kids',
  Unisex: 'Unisex',
  Áo: 'Tops',
  'Áo Ba Lỗ': 'Tank Tops',
  'Áo Thun': 'T-Shirts',
  'Áo Khoác': 'Jackets',
  'Giày Chạy Bộ': 'Running Shoes',
  'Giày Đá Bóng': 'Football Boots',
  'Giày Clog': 'Clogs',
  'Dép Quai Ngang': 'Slides',
  'Quần Bơi': 'Swimwear',
  'Kính Bơi': 'Swim Goggles',
  'Mũ Lưỡi Trai': 'Caps',
  'Mũ Xô (Bucket)': 'Bucket Hats',
  'Băng Đô': 'Headbands',
  'Banh Bóng Đá': 'Footballs',
  'Banh Bóng Pickleball': 'Pickleball',
  Golf: 'Golf',
  Tennis: 'Tennis',
  Basketball: 'Basketball',
};

const translationCache = new Map<string, string>();

async function translateViToEn(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!VIETNAMESE_CHAR_REGEX.test(trimmed)) return trimmed;

  const cached = translationCache.get(trimmed);
  if (cached) return cached;

  const chunks: string[] = [];
  if (trimmed.length <= 1600) {
    chunks.push(trimmed);
  } else {
    const lines = trimmed.split('\n');
    let current = '';
    for (const line of lines) {
      if ((current + '\n' + line).length > 1500 && current) {
        chunks.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) chunks.push(current);
  }

  const translatedParts: string[] = [];
  for (const chunk of chunks) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=en&dt=t&q=${encodeURIComponent(chunk)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) {
        translatedParts.push(chunk);
        continue;
      }
      const data = (await res.json()) as [[string, string][]];
      const joined = (data[0] || []).map((seg) => seg[0] || '').join('');
      translatedParts.push(joined || chunk);
    } catch {
      translatedParts.push(chunk);
    }
  }

  const result = translatedParts.join('\n').trim();
  translationCache.set(trimmed, result);
  return result;
}

function cleanBrand(vendor: string): string {
  const upper = vendor.trim().toUpperCase();
  return (
    BRAND_DISPLAY_MAP[upper] ||
    vendor
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function translateColor(colorRaw: string): string {
  const upper = colorRaw.trim().toUpperCase();
  return (
    COLOR_DICTIONARY[upper] ||
    colorRaw
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function polishEnglishTitle(title: string): string {
  return title
    .replace(/\s*-LSLS\b/gi, '')
    .replace(/\bS\/S\b/gi, 'Short Sleeve')
    .replace(/\bSs\b/g, 'Short Sleeve')
    .replace(/\bJibbitz ™\b/gi, 'Jibbitz™')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 195);
}

function mapCategoryAndSubcategory(
  productType: string,
  enTitle: string
): { category: string; subcategory: string } {
  const pt = productType.toLowerCase();
  const titleLower = enTitle.toLowerCase();

  if (pt.includes('chạy bộ') || titleLower.includes('running shoe')) {
    return {
      category: 'Running',
      subcategory: titleLower.includes('trail')
        ? 'Trail Running'
        : 'Road Running',
    };
  }
  if (
    pt.includes('đá bóng') ||
    pt.includes('banh bóng đá') ||
    titleLower.includes('football')
  ) {
    return {
      category: 'Football',
      subcategory: pt.includes('banh')
        ? 'Match & Training Balls'
        : 'Football Boots',
    };
  }
  if (
    pt.includes('bơi') ||
    titleLower.includes('swim') ||
    titleLower.includes('bikini')
  ) {
    return {
      category: 'Swimming',
      subcategory: pt.includes('kính') ? 'Swim Goggles' : 'Swimwear',
    };
  }
  if (pt.includes('dép') || pt.includes('clog')) {
    return {
      category: 'Footwear',
      subcategory: pt.includes('clog') ? 'Clogs' : 'Slides & Sandals',
    };
  }
  if (pt.includes('sneaker') || pt.includes('giày thời trang')) {
    return {
      category: 'Footwear',
      subcategory: 'Lifestyle Sneakers',
    };
  }
  if (pt.includes('leo núi') || titleLower.includes('columbia')) {
    return {
      category: 'Outdoor',
      subcategory: pt.includes('áo khoác')
        ? 'Outdoor Jackets'
        : 'Hiking & Trail Gear',
    };
  }
  if (pt.includes('áo ba lỗ')) {
    return { category: 'Apparel', subcategory: 'Tank Tops & Singlets' };
  }
  if (pt.includes('áo thun')) {
    return { category: 'Apparel', subcategory: 'T-Shirts & Tops' };
  }
  if (pt.includes('áo khoác')) {
    return { category: 'Apparel', subcategory: 'Jackets & Outerwear' };
  }
  if (
    pt.includes('tập gym') ||
    pt.includes('vợt') ||
    pt.includes('pickleball')
  ) {
    return {
      category: 'Training',
      subcategory:
        pt.includes('pickleball') || pt.includes('vợt')
          ? 'Rackets & Pickleball'
          : 'Training Equipment',
    };
  }
  if (pt.includes('mũ')) {
    return {
      category: 'Accessories',
      subcategory: pt.includes('xô') ? 'Bucket Hats' : 'Caps & Visors',
    };
  }
  if (pt.includes('băng đô')) {
    return { category: 'Accessories', subcategory: 'Headbands & Sweatbands' };
  }
  if (pt.includes('jibbitz')) {
    return { category: 'Accessories', subcategory: 'Shoe Charms' };
  }
  if (pt.includes('chăm sóc giày')) {
    return { category: 'Accessories', subcategory: 'Shoe Care' };
  }
  if (pt.includes('găng tay') || titleLower.includes('sleeve')) {
    return { category: 'Training', subcategory: 'Compression & Sleeves' };
  }
  return { category: 'Apparel', subcategory: 'Sportswear' };
}

function buildEnglishHtmlDescription(
  enTitle: string,
  translatedBody: string,
  brand: string,
  category: string
): { description: string; shortDescription: string } {
  const lines = translatedBody
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const upperTitle = enTitle.toUpperCase();
  const paragraphs: string[] = [];
  const bullets: string[] = [];

  for (const line of lines) {
    if (/^(SPECIFICATIONS|SPECS|DETAILS|THÔNG SỐ)\b/i.test(line)) {
      continue;
    }
    if (
      line.toUpperCase() === upperTitle ||
      line.toUpperCase() === upperTitle.replace(/ - [^-]+$/, '')
    ) {
      continue;
    }
    if (line.startsWith('•') || line.startsWith('- ')) {
      const cleanedBullet = line.replace(/^[•\-]\s*/, '').trim();
      if (cleanedBullet.length > 3) bullets.push(cleanedBullet);
    } else if (line.length > 15) {
      paragraphs.push(line);
    }
  }

  const introParagraph =
    paragraphs.slice(0, 2).join(' ') ||
    `Authentic ${brand} ${enTitle} engineered for ${category.toLowerCase()} performance, everyday comfort, and reliable durability.`;

  const defaultBullets = [
    `Genuine ${brand} product sourced directly from Supersports partner catalog`,
    `Category: ${category} high-performance construction`,
    'Breathable, durable materials built for sport and active lifestyles',
  ];

  const finalBullets =
    bullets.length > 0 ? bullets.slice(0, 6) : defaultBullets;

  const html = [
    `<h4><strong>${enTitle}</strong></h4>`,
    `<p>${introParagraph}</p>`,
    '<h4><strong>Key Specifications</strong></h4>',
    '<ul>',
    ...finalBullets.map((b) => `<li>${b}</li>`),
    '</ul>',
  ]
    .join('\n')
    .slice(0, 4900);

  const shortDescription = introParagraph.slice(0, 480);
  return { description: html, shortDescription };
}

function cleanAndTranslateTags(
  rawTags: string[],
  brand: string,
  category: string,
  subcategory: string
): string[] {
  const out = new Set<string>([brand, category, subcategory]);
  for (const tag of rawTags) {
    const t = tag.trim();
    if (!t) continue;
    if (
      /^\d{4,}|campaign|content_done|image_done|non moving|obs|pushads|oneu_|scmarathon|black friday|setup|^co$|^all /i.test(
        t
      )
    ) {
      continue;
    }
    const mapped = TAG_DICTIONARY[t];
    if (mapped) {
      out.add(mapped);
    } else if (!VIETNAMESE_CHAR_REGEX.test(t) && t.length <= 32) {
      out.add(t);
    }
  }
  return [...out].slice(0, 8);
}

async function fetchDiverseSupersportsProducts(): Promise<ShopifyProduct[]> {
  const pool: Array<ShopifyProduct & { _page: number }> = [];

  for (const page of SUPERSPORTS_PAGES) {
    const url = `https://supersports.com.vn/collections/all/products.json?limit=100&page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) continue;
    const data = (await res.json()) as { products?: ShopifyProduct[] };
    const valid = (data.products || []).filter(
      (p) =>
        Array.isArray(p.images) &&
        p.images.length > 0 &&
        Array.isArray(p.variants) &&
        p.variants.length > 0 &&
        Number(p.variants[0]?.price) > 0
    );

    const step = Math.max(1, Math.floor(valid.length / 8));
    let takenOnPage = 0;
    for (let i = 0; i < valid.length && takenOnPage < 8; i += step) {
      pool.push({ ...valid[i], _page: page });
      takenOnPage++;
    }
  }

  // Fallback extra pages if fewer than 100 unique products collected
  for (
    let extraPage = 2;
    pool.length < 130 && extraPage <= 10;
    extraPage += 2
  ) {
    const res = await fetch(
      `https://supersports.com.vn/collections/all/products.json?limit=100&page=${extraPage}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) continue;
    const data = (await res.json()) as { products?: ShopifyProduct[] };
    for (const item of data.products || []) {
      if (
        item.images?.length &&
        item.variants?.length &&
        Number(item.variants[0]?.price) > 0
      ) {
        pool.push({ ...item, _page: extraPage });
      }
    }
  }

  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  const picked: ShopifyProduct[] = [];

  for (const item of pool) {
    const normTitle = item.title.trim().toLowerCase();
    if (seenIds.has(item.id) || seenTitles.has(normTitle)) continue;
    seenIds.add(item.id);
    seenTitles.add(normTitle);
    picked.push(item);
    if (picked.length === 100) break;
  }

  if (picked.length < 100) {
    throw new Error(
      `Expected 100 distinct products, fetched only ${picked.length}`
    );
  }

  return picked;
}

function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('de-DE')} ₫`;
}

async function seedDatabase(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Connecting to MongoDB at ${env.MONGO_URI}...`);
  await mongoose.connect(env.MONGO_URI);

  // eslint-disable-next-line no-console
  console.log(
    'Fetching 100 diverse products from https://supersports.com.vn/collections/all ...'
  );
  const rawProducts = await fetchDiverseSupersportsProducts();
  // eslint-disable-next-line no-console
  console.log(
    `Fetched ${rawProducts.length} raw Supersports products. Translating to English...`
  );

  const usedSkus = new Set<string>();
  const usedSlugs = new Set<string>();
  const translatedProductDocs: Array<Record<string, unknown>> = [];

  // Process translation in batches of 5 to keep translation API responsive
  for (let i = 0; i < rawProducts.length; i += 5) {
    const batch = rawProducts.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (raw, offset) => {
        const index = i + offset;
        const brand = cleanBrand(raw.vendor);

        const rawPlainBody = (raw.body_html || '')
          .replace(/<li[^>]*>/gi, '\n• ')
          .replace(/<\/(p|h1|h2|h3|h4|h5|li|div|ul|ol)>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{2,}/g, '\n')
          .trim();

        const [enTitleRaw, enBodyRaw] = await Promise.all([
          translateViToEn(raw.title),
          translateViToEn(rawPlainBody),
        ]);

        const enName = polishEnglishTitle(
          enTitleRaw || `${brand} Athletic Product ${index + 1}`
        );
        const { category, subcategory } = mapCategoryAndSubcategory(
          raw.product_type,
          enName
        );
        const { description, shortDescription } = buildEnglishHtmlDescription(
          enName,
          enBodyRaw,
          brand,
          category
        );

        const firstVariant = raw.variants[0];
        const vndPrice = Math.max(50000, Number(firstVariant.price) || 500000);
        const vndCompare = Number(firstVariant.compare_at_price) || 0;

        const price = Math.max(8, Math.round(vndPrice / VND_TO_USD_RATE));
        const rawCompareUsd =
          vndCompare > 0 ? Math.round(vndCompare / VND_TO_USD_RATE) : 0;
        const compareAtPrice =
          rawCompareUsd > price ? rawCompareUsd : undefined;
        const costPrice = Math.max(4, Math.round(price * 0.58));

        // Ensure unique uppercase SKU
        let candidateSku = (
          firstVariant.sku ||
          `SS-${brand.replace(/[^A-Z0-9]/gi, '').slice(0, 4)}-${raw.id.toString().slice(-6)}`
        )
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '-');
        if (!candidateSku || candidateSku.length < 3) {
          candidateSku = `SS-${raw.id}`;
        }
        while (usedSkus.has(candidateSku)) {
          candidateSku = `${candidateSku}-${index + 1}`;
        }
        usedSkus.add(candidateSku);

        // Ensure unique lowercase slug
        let candidateSlug = slugify(enName) || raw.handle.toLowerCase();
        while (usedSlugs.has(candidateSlug)) {
          candidateSlug = `${candidateSlug}-${index + 1}`;
        }
        usedSlugs.add(candidateSlug);

        // Images (up to 5)
        const images = raw.images.slice(0, 5).map((img, imgIdx) => ({
          url: img.src,
          altText: `${enName} - View ${imgIdx + 1}`,
          isPrimary: imgIdx === 0,
          displayOrder: imgIdx,
        }));

        // Variants (Color & Size translated)
        const variants: Array<Record<string, unknown>> = [];
        for (const opt of raw.options || []) {
          const isColor = /màu/i.test(opt.name);
          const isSize = /kích/i.test(opt.name);
          const variantName = isColor ? 'Color' : isSize ? 'Size' : 'Option';

          const cleanValues = isColor
            ? [...new Set(opt.values.map(translateColor))]
            : [
                ...new Set(
                  opt.values
                    .map((v) => v.trim())
                    .filter((v) => !/^default/i.test(v))
                ),
              ];

          if (cleanValues.length > 0) {
            variants.push({
              name: variantName,
              options: cleanValues,
              sku: `${candidateSku}-${variantName.slice(0, 3).toUpperCase()}`,
              priceModifier: 0,
              stock: 20 + ((index * 7 + variants.length * 5) % 45),
            });
          }
        }

        const totalQuantity = 25 + ((index * 11) % 75);
        const ratingsAverage = Number(
          (4.2 + ((index * 7) % 9) * 0.1).toFixed(1)
        );
        const ratingsQuantity = 12 + ((index * 13) % 140);

        const attributes: Record<string, string> = {
          Brand: brand,
          Category: category,
          Subcategory: subcategory,
          'Original VND': formatVnd(vndPrice),
          'Source URL': `https://supersports.com.vn/products/${raw.handle}`,
          Authenticity: '100% Genuine Supersports Partner',
        };

        const tags = cleanAndTranslateTags(
          raw.tags || [],
          brand,
          category,
          subcategory
        );

        const doc: Record<string, unknown> = {
          name: enName,
          slug: candidateSlug,
          description,
          shortDescription,
          price,
          costPrice,
          sku: candidateSku,
          quantity: totalQuantity,
          lowStockThreshold: 5,
          category,
          subcategory,
          brand,
          tags,
          images,
          variants,
          attributes,
          status: 'active',
          isFeatured: index % 5 === 0,
          ratingsAverage,
          ratingsQuantity,
        };

        if (compareAtPrice !== undefined) {
          doc.compareAtPrice = compareAtPrice;
        }

        return doc;
      })
    );

    translatedProductDocs.push(...batchResults);
  }

  // eslint-disable-next-line no-console
  console.log(
    'Clearing existing User, Product, Cart, Order, Conversation, Message collections...'
  );
  await Promise.all([
    Message.deleteMany({}),
    Conversation.deleteMany({}),
    Order.deleteMany({}),
    Cart.deleteMany({}),
    Product.deleteMany({}),
    User.deleteMany({}),
  ]);

  // eslint-disable-next-line no-console
  console.log('Inserting 100 translated Supersports products...');
  const insertedProducts = await Product.insertMany(translatedProductDocs, {
    ordered: true,
  });
  // eslint-disable-next-line no-console
  console.log(`Inserted ${insertedProducts.length} products.`);

  // --- SEED 55 USERS ---
  const passwordHash = await bcrypt.hash('Password123!', env.BCRYPT_COST);

  const cities = [
    {
      city: 'Ho Chi Minh City',
      state: 'HCM',
      postalCode: '700000',
      country: 'Vietnam',
    },
    { city: 'Hanoi', state: 'HN', postalCode: '100000', country: 'Vietnam' },
    { city: 'Da Nang', state: 'DN', postalCode: '550000', country: 'Vietnam' },
    { city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' },
    { city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    { city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    { city: 'Seattle', state: 'WA', postalCode: '98101', country: 'US' },
    { city: 'Chicago', state: 'IL', postalCode: '60601', country: 'US' },
  ];

  const streetNames = [
    'Nguyen Hue Blvd',
    'Le Loi Street',
    'Dong Khoi Street',
    'Hai Ba Trung Street',
    'Market Street',
    'Broadway',
    'Congress Avenue',
    'Pike Street',
    'Michigan Avenue',
    'Sunset Boulevard',
  ];

  const seedNames: Array<
    [string, string, 'admin' | 'seller' | 'customer', string]
  > = [
    ['System', 'Admin', 'admin', 'admin@gash.demo'],
    ['Support', 'Seller', 'seller', 'seller@gash.demo'],
    ['Demo', 'Customer', 'customer', 'customer@gash.demo'],
    ['Alex', 'Morgan', 'customer', 'alex.morgan@jocksport.demo'],
    ['Marcus', 'Vance', 'seller', 'marcus.vance@gash.demo'],
    ['Linh', 'Nguyen', 'seller', 'linh.nguyen@gash.demo'],
    ['Minh', 'Tran', 'customer', 'minh.tran@example.com'],
    ['Chloe', 'Bennett', 'customer', 'chloe.bennett@example.com'],
    ['Ethan', 'Brooks', 'customer', 'ethan.brooks@example.com'],
    ['An', 'Pham', 'customer', 'an.pham@example.com'],
    ['Lucas', 'Carter', 'customer', 'lucas.carter@example.com'],
    ['Maya', 'Patel', 'customer', 'maya.patel@example.com'],
    ['Khoa', 'Le', 'customer', 'khoa.le@example.com'],
    ['Hannah', 'Kim', 'customer', 'hannah.kim@example.com'],
    ['Daniel', 'Hayes', 'customer', 'daniel.hayes@example.com'],
    ['Sophia', 'Chen', 'customer', 'sophia.chen@example.com'],
    ['Tuan', 'Vo', 'customer', 'tuan.vo@example.com'],
    ['Olivia', 'Wright', 'customer', 'olivia.wright@example.com'],
    ['Noah', 'Foster', 'customer', 'noah.foster@example.com'],
    ['Vy', 'Hoang', 'customer', 'vy.hoang@example.com'],
    ['Liam', 'Sullivan', 'customer', 'liam.sullivan@example.com'],
    ['Emma', 'Price', 'customer', 'emma.price@example.com'],
    ['Duy', 'Bui', 'customer', 'duy.bui@example.com'],
    ['Aria', 'Reyes', 'customer', 'aria.reyes@example.com'],
    ['Mason', 'Rivera', 'customer', 'mason.rivera@example.com'],
    ['Thao', 'Dang', 'customer', 'thao.dang@example.com'],
    ['Caleb', 'Jordan', 'customer', 'caleb.jordan@example.com'],
    ['Zoe', 'Keller', 'customer', 'zoe.keller@example.com'],
    ['Quang', 'Do', 'customer', 'quang.do@example.com'],
    ['Isabella', 'Cruz', 'customer', 'isabella.cruz@example.com'],
    ['Owen', 'Parker', 'customer', 'owen.parker@example.com'],
    ['Ngoc', 'Ngo', 'customer', 'ngoc.ngo@example.com'],
    ['Julian', 'Morris', 'customer', 'julian.morris@example.com'],
    ['Natalie', 'Ward', 'customer', 'natalie.ward@example.com'],
    ['Huy', 'Duong', 'customer', 'huy.duong@example.com'],
    ['Grace', 'Simmons', 'customer', 'grace.simmons@example.com'],
    ['Henry', 'Butler', 'customer', 'henry.butler@example.com'],
    ['Trang', 'Vu', 'customer', 'trang.vu@example.com'],
    ['Sebastian', 'Ross', 'customer', 'sebastian.ross@example.com'],
    ['Avery', 'Powell', 'customer', 'avery.powell@example.com'],
    ['Bao', 'Ly', 'customer', 'bao.ly@example.com'],
    ['Scarlett', 'Long', 'customer', 'scarlett.long@example.com'],
    ['Leo', 'Hughes', 'customer', 'leo.hughes@example.com'],
    ['Khanh', 'Truong', 'customer', 'khanh.truong@example.com'],
    ['Lily', 'Sanders', 'customer', 'lily.sanders@example.com'],
    ['Dylan', 'Myers', 'customer', 'dylan.myers@example.com'],
    ['Phuong', 'Dao', 'customer', 'phuong.dao@example.com'],
    ['Mila', 'Fisher', 'customer', 'mila.fisher@example.com'],
    ['Carter', 'Henderson', 'customer', 'carter.henderson@example.com'],
    ['Nhi', 'Phan', 'customer', 'nhi.phan@example.com'],
    ['Wyatt', 'Coleman', 'customer', 'wyatt.coleman@example.com'],
    ['Nora', 'Jenkins', 'customer', 'nora.jenkins@example.com'],
    ['Son', 'Huynh', 'customer', 'son.huynh@example.com'],
    ['Elena', 'Perry', 'customer', 'elena.perry@example.com'],
    ['Gabriel', 'Powell', 'customer', 'gabriel.powell@example.com'],
  ];

  const userDocs = seedNames.map(([firstName, lastName, role, email], idx) => {
    const loc = cities[idx % cities.length];
    const street = streetNames[idx % streetNames.length];
    const phone = `+8490${String(1000000 + idx * 13579).slice(0, 7)}`;

    return {
      firstName,
      lastName,
      email,
      password: passwordHash,
      role,
      phone,
      avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(`${firstName} ${lastName}`)}`,
      isActive: true,
      isEmailVerified: true,
      addresses: [
        {
          label: 'Home',
          fullName: `${firstName} ${lastName}`,
          phone,
          addressLine1: `${100 + idx * 7} ${street}`,
          addressLine2: idx % 3 === 0 ? `Suite ${200 + idx}` : undefined,
          city: loc.city,
          state: loc.state,
          postalCode: loc.postalCode,
          country: loc.country,
          isDefault: true,
        },
      ],
    };
  });

  const insertedUsers = await User.insertMany(userDocs, { ordered: true });
  // eslint-disable-next-line no-console
  console.log(`Inserted ${insertedUsers.length} users.`);

  const customerUsers = insertedUsers.filter((u) => u.role === 'customer');
  const staffUsers = insertedUsers.filter(
    (u) => u.role === 'seller' || u.role === 'admin'
  );

  // --- SEED 45 CARTS (1 per distinct user) ---
  const cartUsers = customerUsers.slice(0, 45);
  const cartDocs = cartUsers.map((user, cIdx) => {
    const itemCount = 1 + (cIdx % 5);
    const seenProductInCart = new Set<string>();
    const items: Array<Record<string, unknown>> = [];

    for (let k = 0; k < itemCount; k++) {
      const prod =
        insertedProducts[(cIdx * 3 + k * 7) % insertedProducts.length];
      const pid = prod._id.toString();
      if (seenProductInCart.has(pid)) continue;
      seenProductInCart.add(pid);

      const colorVar = prod.variants?.find((v) => v.name === 'Color');
      const sizeVar = prod.variants?.find((v) => v.name === 'Size');

      items.push({
        product: prod._id,
        quantity: 1 + ((cIdx + k) % 3),
        color: colorVar?.options?.[0] || 'Default',
        size:
          sizeVar?.options?.[k % (sizeVar.options.length || 1)] || 'Standard',
        priceAtAdd: prod.price,
      });
    }

    return {
      user: user._id,
      items,
    };
  });

  const insertedCarts = await Cart.insertMany(cartDocs, { ordered: true });
  // eslint-disable-next-line no-console
  console.log(`Inserted ${insertedCarts.length} carts.`);

  // --- SEED 180 ORDERS ---
  const orderStatuses: Array<
    | 'delivered'
    | 'shipped'
    | 'processing'
    | 'confirmed'
    | 'pending'
    | 'cancelled'
    | 'refunded'
  > = [
    'delivered',
    'delivered',
    'delivered',
    'delivered',
    'delivered',
    'shipped',
    'shipped',
    'processing',
    'confirmed',
    'pending',
    'cancelled',
    'refunded',
  ];
  const paymentMethods: Array<
    'credit_card' | 'apple_pay' | 'paypal' | 'cod' | 'momo' | 'vnpay'
  > = ['credit_card', 'apple_pay', 'paypal', 'cod', 'momo', 'vnpay'];

  const now = Date.now();
  const orderDocs: Array<Record<string, unknown>> = [];

  for (let oIdx = 0; oIdx < 180; oIdx++) {
    const user = customerUsers[oIdx % customerUsers.length];
    const addr = user.addresses[0];
    const status = orderStatuses[oIdx % orderStatuses.length];
    const paymentMethod = paymentMethods[oIdx % paymentMethods.length];

    let paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded' = 'paid';
    if (status === 'refunded') paymentStatus = 'refunded';
    else if (status === 'cancelled')
      paymentStatus = oIdx % 2 === 0 ? 'refunded' : 'failed';
    else if (status === 'pending' && paymentMethod === 'cod')
      paymentStatus = 'pending';
    else if (status === 'pending')
      paymentStatus = oIdx % 3 === 0 ? 'pending' : 'paid';

    const lineCount = 1 + (oIdx % 4);
    const items: Array<Record<string, unknown>> = [];
    let subtotal = 0;

    for (let k = 0; k < lineCount; k++) {
      const prod =
        insertedProducts[(oIdx * 5 + k * 11) % insertedProducts.length];
      const qty = 1 + ((oIdx + k) % 2);
      const colorVar = prod.variants?.find((v) => v.name === 'Color');
      const sizeVar = prod.variants?.find((v) => v.name === 'Size');

      subtotal += prod.price * qty;
      items.push({
        product: prod._id,
        name: prod.name,
        sku: prod.sku,
        price: prod.price,
        quantity: qty,
        color: colorVar?.options?.[0] || 'Default',
        size:
          sizeVar?.options?.[k % (sizeVar.options.length || 1)] || 'Standard',
        imageUrl: prod.images?.[0]?.url || '',
      });
    }

    const shippingMethod = oIdx % 4 === 0 ? 'express' : 'standard';
    const shippingFee =
      shippingMethod === 'express' ? 25 : subtotal >= 120 ? 0 : 10;
    const total = subtotal + shippingFee;

    const daysAgo = 180 - Math.floor((oIdx / 180) * 180);
    const createdAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const dateStamp = createdAt.toISOString().slice(2, 10).replace(/-/g, '');
    const orderNumber = `GS-${dateStamp}-${String(oIdx + 1).padStart(4, '0')}`;

    const doc: Record<string, unknown> = {
      orderNumber,
      user: user._id,
      items,
      shippingAddress: {
        fullName: addr.fullName,
        phone: addr.phone || user.phone || '+84901234567',
        addressLine1: addr.addressLine1,
        addressLine2: addr.addressLine2,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        country: addr.country,
      },
      shippingMethod,
      shippingFee,
      subtotal,
      total,
      paymentMethod,
      paymentStatus,
      status,
      contactEmail: user.email,
      contactPhone: user.phone,
      notes:
        oIdx % 6 === 0
          ? 'Deliver during business hours, please call ahead.'
          : undefined,
      createdAt,
      updatedAt: createdAt,
    };

    if (status === 'shipped' || status === 'delivered') {
      doc.shippedAt = new Date(createdAt.getTime() + 18 * 60 * 60 * 1000);
    }
    if (status === 'delivered') {
      doc.deliveredAt = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000);
    }
    if (status === 'cancelled') {
      doc.cancelledAt = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000);
      doc.cancelReason = 'Customer requested size change before dispatch.';
    }

    orderDocs.push(doc);
  }

  const insertedOrders = await Order.insertMany(orderDocs, { ordered: true });
  // eslint-disable-next-line no-console
  console.log(`Inserted ${insertedOrders.length} orders.`);

  // --- SEED 30 CHAT CONVERSATIONS & 120 MESSAGES ---
  const conversationModes: Array<'ai' | 'support' | 'seller'> = [
    'ai',
    'support',
    'seller',
    'support',
    'ai',
  ];
  const conversationStatuses: Array<
    'bot_active' | 'queued' | 'assigned' | 'resolved' | 'closed'
  > = ['bot_active', 'queued', 'assigned', 'resolved', 'closed'];

  const conversationDocs: Array<Record<string, unknown>> = [];
  for (let cIdx = 0; cIdx < 30; cIdx++) {
    const user = customerUsers[cIdx % customerUsers.length];
    const mode = conversationModes[cIdx % conversationModes.length];
    const status =
      mode === 'ai'
        ? cIdx % 3 === 0
          ? 'resolved'
          : 'bot_active'
        : conversationStatuses[1 + (cIdx % 4)];
    const assignedAgent =
      status === 'assigned' || status === 'resolved'
        ? staffUsers[cIdx % staffUsers.length]._id
        : undefined;
    const prod = insertedProducts[(cIdx * 4) % insertedProducts.length];
    const lastMessageAt = new Date(now - cIdx * 3 * 60 * 60 * 1000);

    conversationDocs.push({
      user: user._id,
      assignedAgent,
      mode,
      status,
      subject: `Inquiry about ${prod.name.slice(0, 80)}`,
      lastMessageAt,
      lastMessagePreview: `Checking sizing & delivery ETA for ${prod.brand} gear.`,
      unreadCountCustomer: cIdx % 4 === 0 ? 1 : 0,
      unreadCountAgent: status === 'queued' ? 2 : 0,
      handoffReason:
        mode !== 'ai'
          ? 'Customer requested live sizing consultation and order check'
          : undefined,
      closedAt: status === 'closed' ? lastMessageAt : undefined,
    });
  }

  const insertedConversations = await Conversation.insertMany(
    conversationDocs,
    {
      ordered: true,
    }
  );

  const messageDocs: Array<Record<string, unknown>> = [];
  for (let cIdx = 0; cIdx < insertedConversations.length; cIdx++) {
    const conv = insertedConversations[cIdx];
    const prod = insertedProducts[(cIdx * 4) % insertedProducts.length];
    const relatedOrder = insertedOrders[(cIdx * 6) % insertedOrders.length];
    const baseTime =
      (conv.lastMessageAt || new Date()).getTime() - 25 * 60 * 1000;

    messageDocs.push(
      {
        conversation: conv._id,
        senderType: 'customer',
        senderUser: conv.user,
        content: `Hi! Could you tell me if the ${prod.name} runs true to size?`,
        contextCards: [
          {
            cardType: 'product',
            product: prod._id,
            note: `Listed at $${prod.price} USD`,
          },
        ],
        isRead: true,
        readAt: new Date(baseTime + 2 * 60 * 1000),
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime),
      },
      {
        conversation: conv._id,
        senderType: 'ai',
        content: `Hello! The ${prod.name} (${prod.brand}) fits true to standard sizing. We currently have ${prod.quantity} units in stock starting at $${prod.price}. Would you like recommendations for paired ${prod.category.toLowerCase()} gear?`,
        contextCards: [
          {
            cardType: 'product',
            product: prod._id,
            note: `In stock (${prod.quantity} available)`,
          },
        ],
        isRead: true,
        readAt: new Date(baseTime + 5 * 60 * 1000),
        aiMetadata: {
          model: 'gemini-2.5-flash',
          toolCalls: ['searchCatalog'],
        },
        createdAt: new Date(baseTime + 3 * 60 * 1000),
        updatedAt: new Date(baseTime + 3 * 60 * 1000),
      },
      {
        conversation: conv._id,
        senderType: 'customer',
        senderUser: conv.user,
        content: `Thanks! Can you also check the status of my recent order ${relatedOrder.orderNumber}?`,
        contextCards: [
          {
            cardType: 'order',
            order: relatedOrder._id,
            note: `Order ${relatedOrder.orderNumber} ($${relatedOrder.total})`,
          },
        ],
        isRead: true,
        createdAt: new Date(baseTime + 10 * 60 * 1000),
        updatedAt: new Date(baseTime + 10 * 60 * 1000),
      },
      {
        conversation: conv._id,
        senderType: conv.mode === 'ai' ? 'ai' : 'agent',
        senderUser: conv.assignedAgent,
        content: `Your order ${relatedOrder.orderNumber} is currently marked as "${relatedOrder.status}" (${relatedOrder.shippingMethod} shipping, total $${relatedOrder.total}). Let us know if you need any changes!`,
        contextCards: [
          {
            cardType: 'order',
            order: relatedOrder._id,
            note: `Status: ${relatedOrder.status}`,
          },
        ],
        isRead: cIdx % 4 !== 0,
        createdAt: new Date(baseTime + 15 * 60 * 1000),
        updatedAt: new Date(baseTime + 15 * 60 * 1000),
      }
    );
  }

  const insertedMessages = await Message.insertMany(messageDocs, {
    ordered: true,
  });
  // eslint-disable-next-line no-console
  console.log(
    `Inserted ${insertedConversations.length} conversations and ${insertedMessages.length} messages.`
  );

  await mongoose.disconnect();
  // eslint-disable-next-line no-console
  console.log('Seed completed cleanly and MongoDB connection closed.');
}

seedDatabase().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

/**
 * 登録済み商品の価格を一括取得するスクリプト
 */

import { chromium } from 'playwright';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import fs from 'fs';
import path from 'path';

// 監視対象の商品リスト（data/products.json から読み込み）
const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const PRICES_FILE = path.join(process.cwd(), 'data', 'prices.json');

// グレード定義
const GRADES = [
  { code: '01', name: 'S', label: '未使用品' },
  { code: '02', name: 'A', label: '美品' },
  { code: '03', name: 'B', label: '良品' },
  { code: '04', name: 'C', label: '可' },
  { code: '05', name: 'D', label: '難あり' },
];

/**
 * URLからスラッグを抽出
 */
function extractSlug(url) {
  const match = url.match(/\/smartphone\/([^\/\?]+)/);
  return match ? match[1] : null;
}

/**
 * 単一商品の価格を取得
 */
async function fetchPriceWithPage(page, url) {
  const slug = extractSlug(url);
  if (!slug) {
    throw new Error('Invalid URL format');
  }

  console.log(`[GEO] Fetching: ${slug}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async (grades) => {
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : null;

      const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
      let productInfo = null;
      if (jsonLdScript) {
        try {
          const jsonLd = JSON.parse(jsonLdScript.textContent || '{}');
          productInfo = {
            name: jsonLd.name || '',
            brand: jsonLd.brand?.name || '',
            productId: jsonLd.productID || '',
            description: jsonLd.description || '',
            image: jsonLd.image || '',
            availability: jsonLd.offers?.availability?.includes('InStock') ? 'InStock' : 'OutOfStock',
          };
        } catch (e) {}
      }

      let productSummaryId = null;
      const dataIdEl = document.querySelector('[data-id]');
      if (dataIdEl) {
        productSummaryId = dataIdEl.getAttribute('data-id');
      }
      if (!productSummaryId) {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const match = script.textContent?.match(/product_summary_id['":\s]+(\d+)/);
          if (match) {
            productSummaryId = match[1];
            break;
          }
        }
      }

      let colors = [];
      const colorElements = document.querySelectorAll('.color-item, .color-option, [class*="color"]');
      colorElements.forEach(el => {
        const colorName = el.textContent?.trim() || el.getAttribute('data-color') || '';
        if (colorName && colorName.length < 20) {
          colors.push(colorName);
        }
      });

      if (colors.length === 0) {
        const pageText = document.body.innerText;
        const commonColors = ['ブラック', 'ホワイト', 'クリーム', 'グリーン', 'ブルー', 'レッド', 'ピンク', 'パープル', 'シルバー', 'ゴールド'];
        colors = commonColors.filter(c => pageText.includes(c));
      }

      if (colors.length === 0) {
        colors = ['ブラック'];
      }

      const prices = [];
      
      if (csrfToken && productSummaryId) {
        for (const grade of grades) {
          for (const color of colors) {
            try {
              const formData = new FormData();
              formData.append('product_summary_id', productSummaryId);
              formData.append('sell_type', '2');
              formData.append('contract_type', '1');
              formData.append('status', grade.code);
              formData.append('color', color);

              const response = await fetch('/uqmobile/device/get_max_campaign_apply_device_price', {
                method: 'POST',
                headers: {
                  'X-CSRF-Token': csrfToken,
                  'X-Requested-With': 'XMLHttpRequest',
                },
                body: formData,
              });

              if (response.ok) {
                const data = await response.json();
                if (data && (data.product_price || data.mnp_price || data.new_price)) {
                  prices.push({
                    grade: grade.name,
                    gradeLabel: grade.label,
                    color: color,
                    productPrice: data.product_price || null,
                    mnpPrice: data.mnp_price?.min_price || null,
                    newPrice: data.new_price?.min_price || null,
                    changePrice: data.change_price?.min_price || null,
                  });
                  break;
                }
              }
            } catch (e) {}
          }
        }
      }

      return { productInfo, productSummaryId, colors, prices };
    }, GRADES);

    let minMnpPrice = null;
    if (result.prices.length > 0) {
      const mnpPrices = result.prices.map(p => p.mnpPrice).filter(p => p !== null);
      if (mnpPrices.length > 0) {
        minMnpPrice = Math.min(...mnpPrices);
      }
    }

    return {
      url,
      slug,
      fetchedAt: new Date().toISOString(),
      productInfo: result.productInfo,
      productSummaryId: result.productSummaryId,
      minMnpPrice,
      prices: result.prices,
    };

  } catch (error) {
    console.error(`[GEO] Error fetching ${slug}:`, error.message);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  // 商品リストを読み込み
  if (!fs.existsSync(PRODUCTS_FILE)) {
    console.error('Error: data/products.json not found');
    console.log('Creating sample products.json...');
    
    const sampleProducts = [
      'https://mvno.geo-mobile.jp/uqmobile/smartphone/GalaxyS23_SC51D',
      'https://mvno.geo-mobile.jp/uqmobile/smartphone/Google_Pixel_7a',
    ];
    
    fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(sampleProducts, null, 2));
  }

  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  console.log(`[GEO] Found ${products.length} products to fetch`);

  // フィンガープリント生成
  const fingerprintGenerator = new FingerprintGenerator();
  const { fingerprint } = fingerprintGenerator.getFingerprint({
    browsers: ['chrome'],
    operatingSystems: ['linux'],
  });

  // ブラウザ起動
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: fingerprint.navigator.userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'ja-JP',
  });

  const fingerprintInjector = new FingerprintInjector();
  await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);

  const page = await context.newPage();

  // 既存の価格データを読み込み
  let prices = {};
  if (fs.existsSync(PRICES_FILE)) {
    prices = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf-8'));
  }

  // 各商品の価格を取得
  for (const url of products) {
    const result = await fetchPriceWithPage(page, url);
    if (result) {
      prices[result.slug] = result;
      console.log(`[GEO] ✓ ${result.slug}: MNP最安 ¥${result.minMnpPrice?.toLocaleString() || 'N/A'}`);
    }
    
    // レート制限対策
    await page.waitForTimeout(3000);
  }

  await browser.close();

  // 結果を保存
  fs.writeFileSync(PRICES_FILE, JSON.stringify(prices, null, 2));
  console.log(`\n[GEO] Saved ${Object.keys(prices).length} products to data/prices.json`);

  // 最終更新日時を記録
  const metaFile = path.join(process.cwd(), 'data', 'meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    productCount: Object.keys(prices).length,
  }, null, 2));
}

main().catch(console.error);

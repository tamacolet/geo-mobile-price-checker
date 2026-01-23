/**
 * GEOモバイル価格取得スクリプト
 * Playwright + fingerprint-injector を使用してAkamai Bot Managerを回避
 */

import { chromium } from 'playwright';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';
import fs from 'fs';
import path from 'path';

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
 * 価格を取得
 */
async function fetchPrice(url) {
  const slug = extractSlug(url);
  if (!slug) {
    throw new Error('Invalid URL format');
  }

  console.log(`[GEO] Fetching price for: ${slug}`);

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

  // フィンガープリント注入
  const fingerprintInjector = new FingerprintInjector();
  await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);

  const page = await context.newPage();

  try {
    // 商品ページにアクセス
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // ページ内でデータを取得
    const result = await page.evaluate(async (grades) => {
      // CSRFトークン取得
      const csrfMeta = document.querySelector('meta[name="csrf-token"]');
      const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : null;

      // JSON-LDから基本情報取得
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
        } catch (e) {
          console.error('JSON-LD parse error:', e);
        }
      }

      // product_summary_id を取得
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

      // 色を取得
      let colors = [];
      const colorElements = document.querySelectorAll('.color-item, .color-option, [class*="color"]');
      colorElements.forEach(el => {
        const colorName = el.textContent?.trim() || el.getAttribute('data-color') || '';
        if (colorName && colorName.length < 20) {
          colors.push(colorName);
        }
      });

      // 色が見つからない場合のフォールバック
      if (colors.length === 0) {
        const pageText = document.body.innerText;
        const commonColors = ['ブラック', 'ホワイト', 'クリーム', 'グリーン', 'ブルー', 'レッド', 'ピンク', 'パープル', 'シルバー', 'ゴールド'];
        colors = commonColors.filter(c => pageText.includes(c));
      }

      if (colors.length === 0) {
        colors = ['ブラック']; // デフォルト
      }

      // 価格APIを呼び出し
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
                  break; // この色で成功したら次のグレードへ
                }
              }
            } catch (e) {
              console.error(`API error for grade ${grade.name}:`, e);
            }
          }
        }
      }

      return {
        productInfo,
        productSummaryId,
        colors,
        prices,
      };
    }, GRADES);

    // 最安価格を計算
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

  } finally {
    await browser.close();
  }
}

/**
 * メイン処理
 */
async function main() {
  const url = process.argv[2];
  
  if (!url) {
    console.error('Usage: node fetch-price.mjs <URL>');
    process.exit(1);
  }

  try {
    const result = await fetchPrice(url);
    
    // 結果を出力
    console.log(JSON.stringify(result, null, 2));
    
    // data/prices.json に保存
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const pricesFile = path.join(dataDir, 'prices.json');
    let prices = {};
    if (fs.existsSync(pricesFile)) {
      prices = JSON.parse(fs.readFileSync(pricesFile, 'utf-8'));
    }
    
    prices[result.slug] = result;
    fs.writeFileSync(pricesFile, JSON.stringify(prices, null, 2));
    
    console.log(`\n[GEO] Saved to data/prices.json`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

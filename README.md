# GEOモバイル価格チェッカー@たまコイン 🥚💰

GEOモバイルの**在庫切れ商品でも価格情報を取得**できるツールです。

## 🌟 特徴

- **在庫切れ商品の価格も取得可能** - 通常は非表示になる価格情報を取得
- **グレード別価格表示** - S/A/B/C/D の各グレードの価格を一覧表示
- **契約タイプ別価格** - MNP/新規/機種変更の価格を比較
- **定期自動更新** - GitHub Actionsで毎日2回自動更新
- **完全無料** - GitHub Actions + GitHub Pages で運用

## 🚀 使い方

### 1. キャッシュされた価格を確認

[GitHub Pages](https://tamacolet.github.io/geo-mobile-price-checker/) にアクセスして、キャッシュされた商品の価格を確認できます。

### 2. 新しい商品の価格を取得

1. [Actions](../../actions/workflows/manual.yml) タブを開く
2. 「Run workflow」をクリック
3. GEOモバイルの商品URLを入力
4. 「Run workflow」を実行
5. 1〜2分後にページをリロード

### 3. 監視リストに追加

手動実行時に「監視リストに追加する」にチェックを入れると、定期更新の対象になります。

## 📁 ファイル構成

```
.
├── .github/workflows/
│   ├── scheduled.yml    # 定期実行（毎日9:00/21:00 JST）
│   ├── manual.yml       # 手動実行
│   └── deploy.yml       # GitHub Pages デプロイ
├── scripts/
│   ├── fetch-price.mjs  # 単一商品の価格取得
│   └── fetch-all.mjs    # 全商品の価格取得
├── data/
│   ├── products.json    # 監視対象の商品リスト
│   ├── prices.json      # 取得した価格データ
│   └── meta.json        # メタ情報（最終更新日時など）
├── docs/
│   ├── index.html       # GitHub Pages フロントエンド
│   └── favicon.png      # アイコン
└── package.json
```

## 🔧 技術的な仕組み

### Akamai Bot Manager の回避

GEOモバイルは Akamai Bot Manager で保護されているため、通常のHTTPリクエストはブロックされます。

このツールでは以下の技術を使用して回避しています：

1. **Playwright** - ヘッドレスブラウザで実際のブラウザと同様に動作
2. **fingerprint-injector** - ブラウザのフィンガープリントを偽装
3. **fingerprint-generator** - 実際のブラウザに近いフィンガープリントを生成

### 価格APIの発見

GEOモバイルの内部APIを解析し、以下のエンドポイントを発見しました：

```
POST /uqmobile/device/get_max_campaign_apply_device_price
```

パラメータ:
- `product_summary_id`: 商品ID
- `sell_type`: 販売タイプ
- `contract_type`: 契約タイプ
- `status`: グレード（01=S, 02=A, 03=B, 04=C, 05=D）
- `color`: 色名

## 📝 セットアップ

### 1. リポジトリをフォーク

このリポジトリをフォークしてください。

### 2. GitHub Pages を有効化

1. Settings → Pages
2. Source: Deploy from a branch
3. Branch: main, /docs

### 3. Actions の権限を設定

1. Settings → Actions → General
2. Workflow permissions: Read and write permissions

### 4. 初回実行

Actions タブから「定期価格更新」を手動実行して、初期データを取得します。

## ⚠️ 注意事項

- このツールはGEOモバイルの公式サービスではありません
- 過度なアクセスは避けてください
- 価格情報は参考値です。正確な情報は公式サイトでご確認ください

## 📄 ライセンス

MIT License

## 🔗 関連リンク

- [紹介記事](https://tamacoin.net/archives/4043)
- [GEOモバイル公式](https://mvno.geo-mobile.jp/)

# HandMotion Lab / HandCamera v0.3

公開URL: https://daijirohaba.github.io/mediapipe-hand-motion/

GitHub: https://github.com/DaijiroHaba/mediapipe-hand-motion

Chrome/EdgeでURLを開いて使うブラウザ内処理の手指解析アプリです。配布者のPC起動、Python/Node.jsのインストール、ログインは不要です。

体験・学習・探索的研究の参考として利用できます。まず「手指ランドマーク」の入力を「合成動作デモ」にすると、カメラなしで相対3Dを体験できます。

## 4つの入口

| 画面 | 内容 | 撮影・保存 |
|---|---|---|
| [手指ランドマーク](index.html) | 単眼の手指点・相対3D・XYZ・座標ZIP | カメラ1台、動画、合成デモ。動画録画なし |
| [複数カメラ](multicamera.html) | 2〜3台の同時表示、個別WebM録画、表示時刻診断 | 明示操作時だけ録画。骨格は動画へ焼き込まない |
| [校正3D統合](fusion.html) | 各カメラの手指推定、校正、複数視点からのXYZ(mm) | 同じ片手を2〜3台で観察。動画録画なし。座標保存は明示ON |
| [撮影・校正ガイド](camera_setup_20261005/guide.html) | 配置図、校正操作、作成済みPDF | カメラ不要 |

## 説明書と印刷物

- [図付き説明書PDF・3ページ](camera_setup_20261005/CAMERA_SETUP_GUIDE_JA.pdf)
- [校正板PDF・A4・1ページ](camera_setup_20261005/CHARUCO_A4_25mm.pdf)
- [校正3Dの詳細](https://github.com/DaijiroHaba/mediapipe-hand-motion/blob/main/README_FUSION.md)
- [共有用の案内文](SHARE_MESSAGE_JA.txt)

校正板の模様を作る必要はありません。A4・100%／実際のサイズで印刷し、1マス25mmと確認線100mmを実測して硬い平板へ貼ります。配置図はAI生成の説明画像で、その模様を校正に使いません。

## 使い方

1. USB/PCカメラまたは動画を選択します。
2. 手の数、sample fps、必要に応じて手元の解析範囲を指定します。
3. 推定開始。カメラは利用者の許可後に起動します。
4. 停止後、座標CSV、QC、Summaryを結果ZIPで保存します。

相対3Dはドラッグ・スライダーで360度回せます。XYZ軸、原点、参照点を選び、推定形状を確認できます。mm換算値はモデル推定値で、実測の押し込み量ではありません。映像の反転は初期OFFで、3Dには適用されません。

「合成動作デモ」は人工データです。推定精度の証明には使用できません。最大3,000処理フレームで停止します。非表示タブでは計測を停止します。ブラウザが復号できる動画形式が対象で、端末性能によって速度が変わります。

## 公開範囲とデータ

このサイトとソースコードは公開され、インターネット上の誰でもアクセスできます。URLを渡した相手だけに限定する認証はありません。検索等で見つかる可能性があります。

映像・座標は利用者のブラウザ内で処理します。アプリに動画/座標をサーバーへ送る機能はなく、他の利用者の映像も見られません。手指推定画面のZIPには動画を含めません。追加の「複数カメラ」画面では、明示操作でカメラ別WebMと時刻ログを保存します。音声は取得しません。GitHub PagesにはIPアドレス等の通常のサイトアクセスログが残ります。

「複数カメラ」は2〜3台の選択・同時表示・個別録画・表示時刻診断を行う撮影画面です。手指推定と幾何3Dは別の「校正3D統合」で行います。[複数カメラの使い方](https://github.com/DaijiroHaba/mediapipe-hand-motion/blob/main/README_MULTICAMERA.md)も参照できます。全画面で音声は取得しません。

公開物に研究動画、座標CSV、結果ZIP、監査ログ、テスト映像は含めません。利用者がダウンロードしたデータの保存・同期・共有は利用者側の管理対象です。

## 精度と次の開発

モデルはGoogle MediaPipe Hand Landmarkerのままです。手袋・反射・接触遮蔽で精度が向上したとは実証していません。追加したのはROI、QC、座標記録、3D確認機能です。

校正3Dでは複数視点の2D座標から幾何的にXYZを求めます。ただし実機精度・露光同期は未検証です。表示時刻差が小さくても同時露光の証明にはなりません。医学的診断・臨床判断の代替には使わず、研究では独立した既知寸法・変位と時間対応で妥当性を確認してください。参加者の同意、用途、保存先、共有範囲は所属機関の手順で確認します。

押し込み量と圧の統合は未実装です。詳細は [高精度化戦略](https://github.com/DaijiroHaba/mediapipe-hand-motion/blob/main/STRATEGY.md) と [学習方法・Claude提案への対応](https://github.com/DaijiroHaba/mediapipe-hand-motion/blob/main/LEARNING_GUIDE.md)。

同じリポジトリ名とPagesの公開元を維持すれば、内容を更新してもURLは同じです。旧表示が残る場合は必要な結果を保存し、再読み込みしてください。

ライブラリ・モデルの出典とハッシュは `DEPENDENCIES.json`。各ライセンスは `vendor/` に保持しています。

OpenCVの出典・ハッシュは `vendor/OPENCV_DEPENDENCY.json`。公開ファイル一覧とSHA-256は `public-manifest.json`。研究で使用する場合は利用日・GitHubコミットSHA・モデル・ブラウザ・機器・校正JSON・パラメータを記録してください。

参考: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[公開設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

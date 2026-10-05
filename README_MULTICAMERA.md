# 複数カメラ P1: 撮影・時刻診断

2〜3台のUSB/PCカメラを選び、同じ画面で表示・カメラ別録画する追加画面です。映像処理は各自のブラウザ内で行います。音声、外部送信、手指推定、校正、3D融合、光信号検出、同期補正はこの画面では行いません。従来の手指推定は「手指ランドマーク」画面から利用します。

## 開き方

既存のstart_app.cmdで起動し、上部「複数カメラ」を選びます。既に起動中なら http://localhost:8793/multicamera.html を開けます。8793が使用済みで別ポートに起動した場合は起動表示のURL末尾に /multicamera.html を付けてください。HTTPS配信にも対応する静的ファイルです。file://での直接起動はサポート対象外です。

## 撮影手順

1. USBカメラ等を2〜3台接続します。「カメラを確認」を押し、ブラウザのカメラ利用を許可します。機器名を取得するため一時的に既定カメラを開き、すぐ解放します。
2. A/B/Cの枠へ異なるカメラを選びます。Cは任意。最初は640×480・30fpsで取得可否を確認し、手指の画素数を確保できる解像度へ調整します。機種によって要求値と実際の設定は異なります。
3. 「映像開始」で選択した映像を表示します。重複選択・1台だけの選択は拒否します。機器を変更する場合は「全停止」します。
4. 保存する場合だけ「録画開始」。選択した全カメラを別々のWebMとして記録します。初期状態は録画OFFです。音声は取得しません。
5. 必要なら「手動イベントを記録」で操作時刻の目印を残します。これは光信号の検出・露光同期ではありません。
6. 「録画停止」で動画を確定し、「動画・ログZIP」または個別の動画とログJSONを保存します。「全停止」は録画も確定してカメラを解放します。
7. 次の録画の前に保存済み結果を確認し、「結果を破棄」。明示確認後にメモリを解放します。既存結果を無断で上書きしません。

録画上限は10/30/60/120秒、初期値30秒。動画チャンク合計約128MiBで終了します（最後のチャンクで上限を超える場合あり）。ZIP作成・動画エンコードを含む総メモリ上限ではありません。端末の空きメモリが少ない場合は10秒・低解像度から試してください。カメラ切断、録画エラー、5秒以上映像更新なし、タブ非表示でも停止します。

## 同期画面の読み方

- **露光同期: 未検証** が常に表示されます。数値が小さくても撮影同期の合格を意味しません。
- **観測fps** はプレビューのcallback頻度で、センサーfpsや録画fpsの実測値ではありません。
- **直近の近接フレーム差** は、先頭の選択カメラの最新presentationTimeに近い、もう一方の直近120観測のpresentationTimeとの差（相手−基準）です。表示時計上の対応であり、露光時刻差ではありません。
- **差の中央値** は直近最大100比較の絶対値の中央値です。1対1のフレーム割当や時計補正は行いません。比較対象のフレームが複数回使われる場合があります。
- **captureTime** は取得できる場合にCSVへ記録します。時計基準・露光との対応は実機未確認で、比較値には使用しません。
- 時刻欠落は空欄/nullとし、0秒と区別します。映像が古くなった場合は差を更新なしと表示します。

同時開始の命令・表示・録画と、同時露光は別です。通常カメラでは光信号等による実測が次工程になります。今回のP1は取得と診断の準備であり、P2の撮影時刻整列を完了していません。

## ZIP構成

```text
videos/camera_A.webm
videos/camera_B.webm
videos/camera_C.webm                 # 選択した場合
timing/camera_A_observations.csv
timing/camera_B_observations.csv
timing/camera_C_observations.csv      # 選択した場合
manifest.json
README_RESULTS_ja.txt
```

動画はブラウザのMediaRecorderが生成するWebMです。標準APIとローカル処理での互換性を優先し、MP4への変換は行いません。動画にはランドマークや画面UIを焼き込まず、元ストリームを保存します。

CSVはUTF-8 BOM付きです。observation_id、host_callback_ms、presentation_time_ms、media_pts_s、capture_time_ms、presented_frames、画像寸法、timestamp_kindを記録します。host_*はperformance.timeOrigin基準のブラウザ時刻です。captureTime等はAPIが提供した値をそのまま保持します。

**CSVはプレビューの観測ログです。録画を復号したフレームとの1対1対応は未検証です。** observation_idやpresented_framesを録画フレーム番号として利用しないでください。MediaRecorderのチャンクtimecode・到着時刻も露光時刻ではありません。manifestは recorded_frame_mapping=NOT_VERIFIED、exposure_sync=UNVERIFIED を記録します。

録画エラー時も取得できた動画を保存します。video_status=ERROR_OR_PARTIAL、errors、stop_reasonを確認してください。通常完了はRECORDED_NOT_DECODE_VERIFIEDで、アプリ内では復号確認を行っていません。空動画はZIPへ入れず、manifestにEMPTY_RECORDINGを残します。ZIPが作れない場合は個別動画とログJSONで保存できます。

## 実機で次に確認すること

同一USB経路の帯域・給電、ドライバの同時利用、カメラ固定、全視点の共通視野、反射、実際の保存動画の再生を確認します。別端子でも帯域が共有される場合があり、給電ハブだけでは帯域は増えません。

次工程は保存動画フレームと時刻の対応確認、光信号による同期残差評価、カメラ校正、独立した既知変位の検証です。3D座標や押し込み量の精度はまだ評価していません。人物を撮影する際は同意・保存先・利用範囲を確認し、研究動画やZIPを公開GitHubへ入れないでください。

## 開発検証

`node --test tests/multicamera-core.test.mjs` と `tests/multicamera-browser.mjs` を用います。ブラウザ試験は3つの合成canvas映像と実際のMediaRecorderで検証し、実カメラや研究データは使用しません。結果はtest-output/multicamera/results.json。物理的な同期・USB性能は別途検証が必要です。

API根拠: https://www.w3.org/TR/mediastream-recording/ と https://wicg.github.io/video-rvfc/ 。

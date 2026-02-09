// ============================================
// replay.js - ポーリングベース版
// ============================================
// 【概要】
// ユーザーの操作履歴を1秒周期でポーリング取得し、タイムラインを再生するシステム
// 
// 【通信フロー】
// 1. 「履歴取得」ボタン → /api/history/info → 総イベント数を取得
// 2. 「再生開始」ボタン → 1秒周期ループ開始
//    - /api/history?index=0 →表示
//    → 1秒待機
//    - /api/history?index=1 → 表示
//    → 1秒待機 ...
// 
// 【巻き戻し・早送り】
// - 巻き戻し: isReverse = true → index=5→4→3... の逆方向ポーリング
// - 早送り: isReverse = false → index=1→2→3... の正方向ポーリング
// 
// 【ボタン制御】
// - 再生中：巻き戻し・早送りボタンを有効化（マニュアル操作可能）
// - 停止中：すべての操作ボタンを無効化

let totalEvents = 0;           // 総イベント数（初期化時に /api/history/info から取得）
let isRunning = false;         // 再生・巻き戻し・早送りの実行フラグ（ポーリング中 = true）
let currentIndex = -1;         // 現在表示中のイベントインデックス（0～totalEvents-1）
let isReverse = false;         // 逆方向フラグ：true = 巻き戻し中、false = 再生/早送り中

let pollIntervalId = null;     // 1秒周期ポーリング予約用（setTimeout）
let countdownIntervalId = null; // カウントダウン表示用（setInterval）更新は100ms単位

let serverEpochMs = 0;         // サーバーが計測した時刻（/info から取得）
let clientEpochMsAtInit = 0;   // 「履歴取得」実行時のクライアント側時刻

/**
 * log(msg)
 * ログを左ペインの #log DOM に追加する
 * - メッセージを1行追加
 * - スクロール位置を自動的に最下部に移動
 */
function log(msg) {
  const $log = $("#log");
  $log.append(msg + "\n");
  $log.scrollTop($log[0].scrollHeight);
}

/**
 * fmt(epochMs)
 * ミリ秒単位の絶対時刻 (epochMs) をローカル時刻の文字列に変換
 * 例: 1707467000000 → "2026/2/9 10:30:00"
 */
function fmt(epochMs) {
  try {
    return new Date(epochMs).toLocaleString();
  } catch (e) {
    return String(epochMs);
  }
}

/**
 * clearTimers()
 * 実行中のポーリング・カウントダウンタイマーをすべてクリア
 * 再生停止時、または次のアクション開始時に呼び出す
 */
function clearTimers() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

/**
 * updateButtonStates()
 * 再生状態に応じて各操作ボタンの有効・無効状態を更新
 * - 再生中: 巻き戻し・早送りボタンを有効（マニュアル操作可能）
 * - 停止中: すべてのボタンを無効
 * - 範囲チェック: 最初/最後の位置に応じてボタンを無効化
 */
function updateButtonStates() {
  if (isRunning) {
    // 再生中：巻き戻し・早送りボタンを有効に
    $("#btnRewind").prop("disabled", currentIndex <= 0);
    $("#btnForward").prop("disabled", currentIndex >= totalEvents - 1);
    $("#btnFastRewind").prop("disabled", currentIndex <= 1);
    $("#btnFastForward").prop("disabled", currentIndex >= totalEvents - 2);
  } else {
    // 停止中：すべての操作ボタンを無効に
    $("#btnRewind").prop("disabled", true);
    $("#btnForward").prop("disabled", true);
    $("#btnFastRewind").prop("disabled", true);
    $("#btnFastForward").prop("disabled", true);
  }
}

/**
 * stopReplay(reason)
 * 再生・巻き戻し・早送りを停止する
 * - フラグをすべてリセット
 * - タイマーをクリア
 * - ボタン状態を更新
 * - ログに理由を出力
 */
function stopReplay(reason) {
  isRunning = false;
  isReverse = false;
  clearTimers();

  $("#btnStart").prop("disabled", totalEvents === 0);
  $("#btnStop").prop("disabled", true);
  $("#countdown").text("---");
  
  updateButtonStates();

  if (reason) log("停止: " + reason);
}

/**
 * fetchAndDisplayEvent(index)
 * 指定インデックスのイベントを非同期で取得・表示する（ポーリング中核関数）
 * 
 * 【処理フロー】
 * 1. index値をバリデーション（0～totalEvents-1）
 * 2. /api/history?index=X にGET送信
 * 3. レスポンス受信後、UIを更新
 *    - 左ペイン: ラベル＆URL＆時刻を表示
 *    - 右ペイン: iframe のsrc を変更（ページ遷移）
 * 4. 最後/最初に達したかチェック → 達したら停止
 * 5. 1000ms(1秒) 後に次のイベントをポーリング
 *    - isReverse=false (再生/早送り): index → index+1
 *    - isReverse=true (巻き戻し): index → index-1
 */
function fetchAndDisplayEvent(index) {
  if (!isRunning) return;

  if (index < 0 || index >= totalEvents) {
    stopReplay("範囲外");
    return;
  }

  $.ajax({
    url: "./api/history",
    method: "GET",
    data: { index: index },
    dataType: "json",
    cache: false,
    timeout: 5000
  })
    .done(function (ev) {
      currentIndex = index;

      // 表示（左ペイン）
      $("#current").text(`${ev.label}  ${ev.url}  (${fmt(ev.epochMs)})`);
      $("#eventIndex").text(index + 1);
      $("#totalEvents").text(totalEvents);
      
      // iframe遷移（右ペイン）
      $("#viewer").attr("src", ev.url);

      log(`表示: [${index}] ${ev.label}  epochMs=${ev.epochMs} (${fmt(ev.epochMs)}) -> ${ev.url}`);

      updateButtonStates();

      // 範囲チェック：最後または最初に達したか
      if (!isReverse && index >= totalEvents - 1) {
        $("#countdown").text("END");
        stopReplay("最後まで再生しました");
        return;
      }
      if (isReverse && index <= 0) {
        $("#countdown").text("START");
        stopReplay("最初まで戻りました");
        return;
      }

      // 次ポーリングまでの待機（カウントダウン表示）
      let remain = 1000; // 1秒 = 1000ms
      $("#countdown").text(remain);

      if (countdownIntervalId) clearInterval(countdownIntervalId);
      countdownIntervalId = setInterval(() => {
        remain -= 100;
        if (remain < 0) remain = 0;
        $("#countdown").text(remain);
      }, 100);

      // 次のイベントを1秒後にポーリング
      pollIntervalId = setTimeout(() => {
        if (countdownIntervalId) {
          clearInterval(countdownIntervalId);
          countdownIntervalId = null;
        }
        const nextIndex = isReverse ? index - 1 : index + 1;
        fetchAndDisplayEvent(nextIndex);
      }, 1000);
    })
    .fail(function (xhr, status, err) {
      log("取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
      stopReplay("API呼び出しエラー");
    });
}

/**
 * startReplay()
 * 再生を開始する
 * - 開始日時が指定されている場合は /api/history/find でindexを取得
 * - 指定なしの場合は index=0 から開始
 * - フラグ設定: isRunning=true, isReverse=false
 * - UI更新: ボタン有効・無効状態を更新
 * - ポーリング開始: fetchAndDisplayEvent(index) を呼び出し
 */
function startReplay() {
  if (totalEvents === 0) {
    log("履歴がありません。先に「履歴取得」を押してください。");
    return;
  }

  // 入力フィールドから開始日時を取得
  const startDateTimeStr = $("#startDateTime").val().trim();
  let startSeconds = 0;
  
  // 秒数フィールドから値を取得（存在する場合）
  const secondsVal = $("#startSeconds").val();
  if (secondsVal !== undefined && secondsVal !== null && secondsVal !== "") {
    startSeconds = parseInt(secondsVal);
    if (Number.isNaN(startSeconds) || startSeconds < 0) {
      startSeconds = 0;
    }
  }
  
  log("startReplay called - dateTime: " + startDateTimeStr + ", seconds: " + startSeconds);
  
  if (!startDateTimeStr) {
    // 開始日時が指定されていない場合は index=0 から開始
    log("開始日時が指定されていません。index=0 から開始します");
    startPlaybackFromIndex(0);
    return;
  }

  // datetime-local形式 (YYYY-MM-DDTHH:mm) をローカルタイムゾーン として Date に変換
  // 注意: new Date(datetimeLocalString) は UTC として解釈されるため、手動でローカルタイムゾーン に変換
  const parts = startDateTimeStr.split('T');
  const dateParts = parts[0].split('-'); // YYYY-MM-DD
  const timeParts = parts[1].split(':'); // HH:mm
  
  const year = parseInt(dateParts[0]);
  const month = parseInt(dateParts[1]);
  const day = parseInt(dateParts[2]);
  const hour = parseInt(timeParts[0]);
  const minute = parseInt(timeParts[1]);
  
  // ローカルタイムゾーンで Date オブジェクトを生成
  const dateObj = new Date(year, month - 1, day, hour, minute, startSeconds);
  
  if (Number.isNaN(dateObj.getTime())) {
    log("⚠ 開始日時の形式が不正です");
    return;
  }

  let startEpochMs = dateObj.getTime();
  
  // ★重要★ サーバー時刻軸に補正
  // クライアント側の入力値をサーバーの時刻ズレに合わせて調整
  const timeDiffMs = serverEpochMs - clientEpochMsAtInit;
  startEpochMs = startEpochMs + timeDiffMs;
  
  log("===== 時刻補正情報 =====");
  log("ユーザー入力時刻: " + fmt(dateObj.getTime()) + " (クライアント側)");
  log("サーバー時刻: " + fmt(serverEpochMs));
  log("時刻オフセット: " + timeDiffMs + " ms");
  log("補正後の検索時刻: " + fmt(startEpochMs) + " (サーバー時刻軸)");
  log("開始時刻を検索中... epochMs=" + startEpochMs + " (" + fmt(startEpochMs) + ")");

  // サーバー側に /api/history/find?epochMs=XXX でindexを取得
  $.ajax({
    url: "./api/history/find",
    method: "GET",
    data: { epochMs: startEpochMs },
    dataType: "json",
    cache: false,
    timeout: 5000
  })
    .done(function (data) {
      const startIndex = data.index;
      log("開始位置取得成功: index=" + startIndex + ", epochMs=" + startEpochMs + " (" + fmt(startEpochMs) + ")");
      startPlaybackFromIndex(startIndex);
    })
    .fail(function (xhr, status, err) {
      log("開始位置取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
      log("フォールバック: index=0 から開始します");
      startPlaybackFromIndex(0);
    });
}

/**
 * startPlaybackFromIndex(index)
 * 指定インデックスから再生を開始する（内部用ヘルパー関数）
 * - フラグ設定: isRunning=true, isReverse=false
 * - UI更新: ボタン有効・無効状態を更新
 * - ポーリング開始: fetchAndDisplayEvent(index) を呼び出し
 */
function startPlaybackFromIndex(startIndex) {
  // 状態更新
  isRunning = true;
  isReverse = false;
  currentIndex = startIndex;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("再生開始: startIndex=" + startIndex);

  fetchAndDisplayEvent(startIndex);
}

/**
 * rewind()
 * 1つ前のイベントへ巻き戻す
 * - current index が 0以下 → 無処理
 * - isReverse = true に設定（逆方向ポーリング）
 * - fetchAndDisplayEvent(currentIndex - 1) を呼び出し
 * - 1つ前を現在地として、そこから1秒待機開始
 */
function rewind() {
  if (currentIndex <= 0) return;
  
  isRunning = true;
  isReverse = true;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("巻き戻し開始");

  fetchAndDisplayEvent(currentIndex - 1);
}

/**
 * forward()
 * 1つ先のイベントへ早送りする
 * - currentIndex >= totalEvents-1 → 無処理
 * - isReverse = false に設定（正方向ポーリング）
 * - fetchAndDisplayEvent(currentIndex + 1) を呼び出し
 */
function forward() {
  if (currentIndex >= totalEvents - 1) return;
  
  isRunning = true;
  isReverse = false;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("早送り開始");

  fetchAndDisplayEvent(currentIndex + 1);
}

/**
 * fastRewind()
 * 2つ前のイベントへ高速巻き戻す
 * - currentIndex <= 1 → 無処理
 * - isReverse = true に設定
 * - fetchAndDisplayEvent(currentIndex - 2) を呼び出し
 */
function fastRewind() {
  if (currentIndex <= 1) return;
  
  isRunning = true;
  isReverse = true;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("2倍速巻き戻し開始");

  fetchAndDisplayEvent(currentIndex - 2);
}

/**
 * fastForward()
 * 2つ先のイベントへ高速早送りする
 * - currentIndex >= totalEvents-2 → 無処理
 * - isReverse = false に設定
 * - fetchAndDisplayEvent(currentIndex + 2) を呼び出し
 */
function fastForward() {
  if (currentIndex >= totalEvents - 2) return;
  
  isRunning = true;
  isReverse = false;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("2倍速早送り開始");

  fetchAndDisplayEvent(currentIndex + 2);
}

// ============================================
// ボタンイベントハンドラー - ユーザー操作の起点
// ============================================

/**
 * 「履歴取得」ボタンクリック
 * - /api/history/info へアクセス
 * - 総イベント数を取得・保持
 * - サーバー時刻を保存（クライアント時刻のズレ補正用）
 * - 「再生開始」ボタンを有効化
 */
$("#btnLoad").on("click", function () {
  log("履歴情報取得中...");

  $.ajax({
    url: "./api/history/info",
    method: "GET",
    dataType: "json",
    cache: false,
    timeout: 5000
  })
    .done(function (data) {
      totalEvents = data.totalEvents;
      serverEpochMs = data.generatedAtEpochMs;      // サーバー時刻を保存
      clientEpochMsAtInit = new Date().getTime();   // クライアント現在時刻を保存
      
      const timeDiffMs = serverEpochMs - clientEpochMsAtInit;
      log("取得しました。総イベント数: " + totalEvents);
      log("サーバー時刻: " + fmt(serverEpochMs) + " (オフセット: " + timeDiffMs + "ms)");

      $("#btnStart").prop("disabled", false);
      updateButtonStates();
    })
    .fail(function (xhr, status, err) {
      log("取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
    });
});

/**
 * 「再生開始」ボタンクリック
 * startReplay() を呼び出す
 */
$("#btnStart").on("click", startReplay);

/**
 * 「停止」ボタンクリック
 * ユーザーが再生中断を指示
 */
$("#btnStop").on("click", function () {
  stopReplay("ユーザー操作");
});

/**
 * 操作ボタンイベント
 * - 巻き戻し: rewind()
 * - 早送り: forward()
 * - 2倍速巻き戻し: fastRewind()
 * - 2倍速早送り: fastForward()
 */
$("#btnRewind").on("click", rewind);

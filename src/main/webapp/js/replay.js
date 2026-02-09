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

let isRunning = false;         // 再生・巻き戻し・早送りの実行フラグ（ポーリング中 = true）
let currentIndex = -1;         // 現在表示中のイベントインデックス
let isReverse = false;         // 逆方向フラグ：true = 巻き戻し中、false = 再生/早送り中
let lastDisplayedEpochMs = 0;  // 最後に表示したイベントのepochMs
let lastFetchedEvent = null;   // ポーリングで取得したが未表示のイベント

let pollIntervalId = null;     // 1秒周期ポーリング予約用（setInterval）
let displayTimerIdId = null;   // 画面表示切り替え予約用（setTimeout）
let countdownIntervalId = null; // カウントダウン表示用（setInterval）更新は100ms単位

let serverEpochMs = 0;         // サーバーが計測した時刻（初回イベント取得時に取得）
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
 * 実行中のポーリング・表示切り替え・カウントダウンタイマーをすべてクリア
 * 再生停止時、または次のアクション開始時に呼び出す
 */
function clearTimers() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (displayTimerIdId) {
    clearTimeout(displayTimerIdId);
    displayTimerIdId = null;
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
 */
function updateButtonStates() {
  if (isRunning) {
    // 再生中：巻き戻し・早送りボタンを有効に
    $("#btnRewind").prop("disabled", currentIndex <= 0);
    $("#btnForward").prop("disabled", false);
    $("#btnFastRewind").prop("disabled", currentIndex <= 1);
    $("#btnFastForward").prop("disabled", false);
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

  $("#btnStart").prop("disabled", false);
  $("#btnStop").prop("disabled", true);
  $("#countdown").text("---");
  
  updateButtonStates();

  if (reason) log("停止: " + reason);
}

/**
 * pollNextEvent(index)
 * 1秒ごとにサーバーからイベントをポーリング
 * 【重要】イベント取得のみ、表示はしない（バッファに保持）
 * 表示タイミングは scheduleEventDisplay() で別途制御
 */
function pollNextEvent(index) {
  if (!isRunning) return;

  if (index < 0) {
    stopReplay("範囲外");
    return;
  }

  $.ajax({
    url: "./api/replay/history",
    method: "GET",
    data: { 
      index: index
    },
    dataType: "json",
    cache: false,
    timeout: 5000
  })
    .done(function (ev) {
      // イベント取得成功 → バッファに保持するだけ（表示はしない）
      log(`ポーリング成功: [${index}] ${ev.label}  epochMs=${ev.epochMs} (${fmt(ev.epochMs)})`);

      // 最後のイベントかチェック
      if (ev.nextEpochMs === undefined || ev.nextEpochMs === null) {
        log("最後のイベントをポーリング");
        lastFetchedEvent = { event: ev, index: index };
      } else {
        lastFetchedEvent = { event: ev, index: index };
      }
      
      // 表示タイミングをチェック
      scheduleEventDisplay();
    })
    .fail(function (xhr, status, err) {
      // ポーリング失敗（データなし）
      if (xhr.status === 400) {
        log(`イベント [${index}] が見つかりません`);
      } else {
        log(`ポーリング失敗: status=${xhr.status}`);
      }
    });
}

/**
 * displayEvent(ev, index)
 * イベントを画面に表示する
 */
function displayEvent(ev, index) {
  currentIndex = index;
  lastDisplayedEpochMs = ev.epochMs;

  // 表示（左ペイン）
  $("#current").text(`${ev.label}  ${ev.url}  (${fmt(ev.epochMs)})`);
  $("#eventIndex").text(index + 1);
  
  // iframe遷移（右ペイン）
  $("#viewer").attr("src", ev.url);

  log(`表示: [${index}] ${ev.label} -> ${ev.url}`);
  updateButtonStates();
}

/**
 * scheduleEventDisplay()
 * 
 * 【重要な処理】
 * ポーリングで取得したイベント（lastFetchedEvent）が
 * 実際に表示するべき時刻に達したかを確認
 * 
 * 達していれば → 画面に表示
 * 達していなければ → 待機タイマーをセット
 */
function scheduleEventDisplay() {
  if (!lastFetchedEvent) return;
  
  const ev = lastFetchedEvent.event;
  const index = lastFetchedEvent.index;
  const targetTime = ev.epochMs;  // このイベントを表示すべき時刻
  const nowMs = new Date().getTime();
  const timeDiff = targetTime - nowMs;
  
  if (timeDiff <= 100) {  // 100ms以内なら表示
    // 表示時刻到達 → 画面に表示
    displayEvent(ev, index);
    lastDisplayedEpochMs = ev.epochMs;
    lastFetchedEvent = null;  // バッファクリア
    
    log(`表示時刻到達、画面遷移: [${index}] ${ev.label}`);
    
    // 次のイベント表示予約（あれば）
    if (ev.nextEpochMs) {
      const nextWaitMs = ev.nextEpochMs - nowMs;
      if (displayTimerIdId) clearTimeout(displayTimerIdId);
      displayTimerIdId = setTimeout(() => {
        scheduleEventDisplay();
      }, Math.max(100, nextWaitMs));
      
      // カウントダウン表示
      let remain = nextWaitMs;
      $("#countdown").text(Math.ceil(remain / 1000) + "秒");
      if (countdownIntervalId) clearInterval(countdownIntervalId);
      countdownIntervalId = setInterval(() => {
        remain -= 100;
        if (remain < 0) remain = 0;
        $("#countdown").text(Math.ceil(remain / 1000) + "秒");
      }, 100);
    } else {
      // 最後のイベント
      $("#countdown").text("---");
      stopReplay("最後まで再生しました");
    }
  } else {
    // 待機中 → 表示時刻になるまで待つ
    log(`イベント [${index}] バッファ保持中、次表示時刻まで ${Math.ceil(timeDiff / 1000)}秒待機`);
    
    if (displayTimerIdId) clearTimeout(displayTimerIdId);
    displayTimerIdId = setTimeout(() => {
      scheduleEventDisplay();
    }, Math.max(100, timeDiff));
    
    // カウントダウン表示
    let remain = timeDiff;
    $("#countdown").text(Math.ceil(remain / 1000) + "秒");
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    countdownIntervalId = setInterval(() => {
      remain -= 100;
      if (remain < 0) remain = 0;
      $("#countdown").text(Math.ceil(remain / 1000) + "秒");
    }, 100);
  }
}

/**
 * fetchAndDisplayEvent(index)
 * 【非推奨 - 以前のシングルポーリング方式】
 * 代わりに pollNextEvent() を使用
 * （displayEventWithDelay() は削除）
 */
function fetchAndDisplayEvent(index) {
  // 互換性のため残すが、実際には使用されない
  pollNextEvent(index);
}

/**
 * startReplay()
 * 再生開始メインルーチン（最初のイベントから開始）
 * 
 * 【処理フロー】
 * 1. サーバー疎通がなければ先に取得
 * 2. index=0 から再生開始（常に最初から）
 */
function startReplay() {
  // サーバー疎通がなければまずサーバーから初期情報を取得
  if (!serverEpochMs) {
    log("サーバーと疎通中...");
    
    $.ajax({
      url: "./api/replay/history",
      method: "GET",
      data: { 
        index: 0
      },
      dataType: "json",
      cache: false,
      timeout: 5000
    })
      .done(function (data) {
        // サーバー時刻を保存
        serverEpochMs = new Date().getTime();
        clientEpochMsAtInit = new Date().getTime();
        
        log("サーバー疎通確立: " + fmt(serverEpochMs));
        
        // 再帰的に startReplay() を呼び出して処理を続行
        startReplay();
      })
      .fail(function (xhr, status, err) {
        log("❌ サーバー疎通失敗: " + status + " / HTTP " + xhr.status + " / " + err);
      });
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
  
  if (!startDateTimeStr) {
    // 開始日時が指定されていない場合は index=0 から開始
    log("開始日時が指定されていません。index=0 から開始します");
    startPlaybackFromIndex(0);
    return;
  }

  // datetime-local形式 (YYYY-MM-DDTHH:mm) をローカルタイムゾーン として Date に変換
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

  // サーバー側に /api/replay/history/find?epochMs=XXX でindexを取得
  $.ajax({
    url: "./api/replay/history/find",
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
      log("❌ 開始位置取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
      if (xhr.status === 400) {
        log("⚠ 指定時刻のイベントが見つかりません");
      }
    });
}

/**
 * startPlaybackFromIndex(index)
 * 指定インデックスから再生を開始する（内部用ヘルパー関数）
 * 
 * 【処理フロー】
 * 1. フラグ設定: isRunning=true, isReverse=false, currentIndex=startIndex
 * 2. UI更新: ボタン有効・無効状態を更新
 * 3. 【重要】1秒ごとの定期ポーリングを開始
 *    - setInterval() で pollNextEvent(currentIndex) を実行
 *    - currentIndex は毎回、前のループで自動更新される
 * 4. 初回イベント表示
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

  // 【重要】1秒ごとのポーリングを開始
  // setInterval で毎秒 pollNextEvent() を実行
  pollIntervalId = setInterval(() => {
    if (isRunning) {
      const nextIndex = isReverse ? currentIndex - 1 : currentIndex + 1;
      pollNextEvent(nextIndex);
    }
  }, 1000);

  // 初回イベント表示
  pollNextEvent(startIndex);
}

/**
 * rewind()
 * 1つ前のイベントへ巻き戻す
 * - current index が 0以下 → 無処理
 * - isReverse = true に設定（逆方向ポーリング）
 * - startPlaybackFromIndex() と同じ方式で1秒ごとのポーリングを開始
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

  // 1秒ごとのポーリングを開始
  pollIntervalId = setInterval(() => {
    if (isRunning) {
      const nextIndex = isReverse ? currentIndex - 1 : currentIndex + 1;
      pollNextEvent(nextIndex);
    }
  }, 1000);

  // 初回イベント表示
  pollNextEvent(currentIndex - 1);
}

/**
 * forward()
 * 1つ先のイベントへ早送りする
 * - isReverse = false に設定（正方向ポーリング）
 * - startPlaybackFromIndex() と同じ方式で1秒ごとのポーリングを開始
 */
function forward() {
  isRunning = true;
  isReverse = false;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("早送り開始");

  // 1秒ごとのポーリングを開始
  pollIntervalId = setInterval(() => {
    if (isRunning) {
      const nextIndex = isReverse ? currentIndex - 1 : currentIndex + 1;
      pollNextEvent(nextIndex);
    }
  }, 1000);

  // 初回イベント表示
  pollNextEvent(currentIndex + 1);
}

/**
 * fastRewind()
 * 2つ前のイベントへ高速巻き戻す
 * - currentIndex <= 1 → 無処理
 * - isReverse = true に設定
 * - startPlaybackFromIndex() と同じ方式で1秒ごとのポーリングを開始
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

  // 1秒ごとのポーリングを開始
  pollIntervalId = setInterval(() => {
    if (isRunning) {
      const nextIndex = isReverse ? currentIndex - 1 : currentIndex + 1;
      pollNextEvent(nextIndex);
    }
  }, 1000);

  // 初回イベント表示
  pollNextEvent(currentIndex - 2);
}

/**
 * fastForward()
 * 2つ先のイベントへ高速早送りする
 * - isReverse = false に設定
 * - startPlaybackFromIndex() と同じ方式で1秒ごとのポーリングを開始
 */
function fastForward() {
  isRunning = true;
  isReverse = false;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);
  
  updateButtonStates();

  log("2倍速早送り開始");

  // 1秒ごとのポーリングを開始
  pollIntervalId = setInterval(() => {
    if (isRunning) {
      const nextIndex = isReverse ? currentIndex - 1 : currentIndex + 1;
      pollNextEvent(nextIndex);
    }
  }, 1000);

  // 初回イベント表示
  pollNextEvent(currentIndex + 2);
}

// ============================================
// ボタンイベントハンドラー - ユーザー操作の起点
// ============================================

/**
 * 「履歴取得」ボタンは不要：再生開始時に自動取得されます
 * （以前のハンドラは削除）
 */

/**
 * 「再生開始」ボタンクリック
 * startReplay() を呼び出す
 * - サーバー疎通がなければ自動取得してから再生開始
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

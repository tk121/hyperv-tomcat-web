// replay.js (ポーリングベース版)
// - /myapp/api/history/info で総イベント数を取得
// - /myapp/api/history?index=X で個別のイベント1つを取得
// - 1秒周期でポーリングして次のデータを表示
// - 巻き戻し・早送りは逆方向のポーリング

let totalEvents = 0;           // 総イベント数
let isRunning = false;         // 再生中フラグ
let currentIndex = -1;         // 現在表示中のイベントインデックス
let isReverse = false;         // 逆方向フラグ（巻き戻し時用）

let pollIntervalId = null;     // 1秒周期ポーリング(setInterval)
let countdownIntervalId = null; // カウントダウン表示(setInterval)

function log(msg) {
  const $log = $("#log");
  $log.append(msg + "\n");
  $log.scrollTop($log[0].scrollHeight);
}

// epochMs -> 表示用文字列（ローカル時刻）
function fmt(epochMs) {
  try {
    return new Date(epochMs).toLocaleString();
  } catch (e) {
    return String(epochMs);
  }
}

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

// ボタンの有効・無効状態を更新
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

// stopボタンや最後まで再生したときに呼ぶ
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

// i番目のイベントを取得して表示
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

function startReplay() {
  if (totalEvents === 0) {
    log("履歴がありません。先に「履歴取得」を押してください。");
    return;
  }

  // 入力フィールドから開始時刻を取得して開始インデックスを決定
  // 簡略化のため、今は最初から再生（実装は後で可能）
  const startIndex = 0;

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

// 巻き戻し（前のイベント）- 逆方向ポーリング開始
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

// 早送り（次のイベント）- 正方向ポーリング開始
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

// 2倍速巻き戻し（2つ前へ）
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

// 2倍速早送り（2つ先へ）
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

// ボタンイベント
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
      log("取得しました。総イベント数: " + totalEvents);

      $("#btnStart").prop("disabled", false);
      updateButtonStates();
    })
    .fail(function (xhr, status, err) {
      log("取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
    });
});

$("#btnStart").on("click", startReplay);

$("#btnStop").on("click", function () {
  stopReplay("ユーザー操作");
});

$("#btnRewind").on("click", rewind);
$("#btnForward").on("click", forward);
$("#btnFastRewind").on("click", fastRewind);
$("#btnFastForward").on("click", fastForward);

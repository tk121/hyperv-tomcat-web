// replay.js (epochMs版)
// - /myapp/api/history から履歴(JSON)を取得
// - events[i].epochMs の差分で待ち時間を計算して iframe を遷移
// - 後で「開始時刻から再生」を実装しやすいように startEpochMs を扱える形にしている

let historyData = null;
let isRunning = false;

let stepTimeoutId = null;    // 次の遷移予約(setTimeout)
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
  if (stepTimeoutId) {
    clearTimeout(stepTimeoutId);
    stepTimeoutId = null;
  }
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

// stopボタンや最後まで再生したときに呼ぶ
function stopReplay(reason) {
  isRunning = false;
  clearTimers();

  $("#btnStart").prop("disabled", historyData == null);
  $("#btnStop").prop("disabled", true);
  $("#countdown").text("---");

  if (reason) log("停止: " + reason);
}

// startEpochMs(任意) 以降の最初のイベントのindexを返す
function findStartIndex(events, startEpochMs) {
  if (startEpochMs == null) return 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].epochMs >= startEpochMs) return i;
  }
  // 指定時刻以降のイベントが無ければ最後
  return Math.max(0, events.length - 1);
}

// i番目のイベントを表示し、次までの差分時間で次の表示を予約
function playFromIndex(events, i) {
  if (!isRunning) return;

  if (i < 0 || i >= events.length) {
    stopReplay("範囲外");
    return;
  }

  const ev = events[i];

  // 表示（左ペイン）
  $("#current").text(`${ev.label}  ${ev.url}  (${fmt(ev.epochMs)})`);
  // iframe遷移（右ペイン）
  $("#viewer").attr("src", ev.url);

  log(`表示: [${i}] ${ev.label}  epochMs=${ev.epochMs} (${fmt(ev.epochMs)}) -> ${ev.url}`);

  // 最後のイベントなら終了
  if (i >= events.length - 1) {
    $("#countdown").text("END");
    stopReplay("最後まで再生しました");
    return;
  }

  // 次のイベントまでの待ち時間 = 次epochMs - 今epochMs
  let waitMs = events[i + 1].epochMs - ev.epochMs;

  // 異常値対策（同一時刻/逆転など）
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    waitMs = 0;
  }

  // カウントダウン表示（100ms単位）
  let remain = waitMs;
  $("#countdown").text(remain);

  if (countdownIntervalId) clearInterval(countdownIntervalId);
  countdownIntervalId = setInterval(() => {
    remain -= 100;
    if (remain < 0) remain = 0;
    $("#countdown").text(remain);
  }, 100);

  // 次の表示を予約
  stepTimeoutId = setTimeout(() => {
    if (countdownIntervalId) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
    }
    playFromIndex(events, i + 1);
  }, waitMs);
}

function startReplay() {
  if (!historyData || !Array.isArray(historyData.events) || historyData.events.length === 0) {
    log("履歴がありません。先に「履歴取得」を押してください。");
    return;
  }

  // epochMsで昇順に並べる
  const events = historyData.events.slice().sort((a, b) => a.epochMs - b.epochMs);

  // 将来拡張：開始時刻指定（いまは未入力なら先頭から）
  // HTML側で input を用意したらここで読める：
  // const startEpochMs = Number($("#startEpochMs").val()) || null;
  const startEpochMs = null;

  const startIndex = findStartIndex(events, startEpochMs);

  // 状態更新
  isRunning = true;
  clearTimers();

  $("#btnStart").prop("disabled", true);
  $("#btnStop").prop("disabled", false);

  log("再生開始: startIndex=" + startIndex + (startEpochMs ? (" startEpochMs=" + startEpochMs) : ""));

  playFromIndex(events, startIndex);
}

// ボタンイベント
$("#btnLoad").on("click", function () {
  log("履歴取得中...");

  $.ajax({
    url: "./api/history",   // /myapp/api/history
    method: "GET",
    dataType: "json",
    cache: false,
    timeout: 5000
  })
    .done(function (data) {
      historyData = data;

      // 軽く検証（epochMsが数値か）
      const ok = Array.isArray(data.events) && data.events.every(e => typeof e.epochMs === "number" && typeof e.url === "string");
      log("取得しました。検証=" + (ok ? "OK" : "NG(形式要確認)"));
      log(JSON.stringify(data, null, 2));

      $("#btnStart").prop("disabled", false);
    })
    .fail(function (xhr, status, err) {
      log("取得失敗: " + status + " / HTTP " + xhr.status + " / " + err);
    });
});

$("#btnStart").on("click", startReplay);

$("#btnStop").on("click", function () {
  stopReplay("ユーザー操作");
});

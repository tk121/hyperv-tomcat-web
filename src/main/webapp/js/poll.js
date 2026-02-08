function poll() {
  $.ajax({
    url: "./api/time",     // /myapp/api/time
    method: "GET",
    dataType: "json",
    cache: false,          // キャッシュ抑止
    timeout: 5000          // 任意：5秒でタイムアウト
  })
  .done(function (data) {
    $("#time").text(data.now);
    $("#raw").text(JSON.stringify(data, null, 2));
  })
  .fail(function (xhr, status, err) {
    $("#raw").text("error: " + status + " / HTTP " + xhr.status + " / " + err);
  });
}

poll();                 // 最初に1回
setInterval(poll, 4000); // 4秒ごと

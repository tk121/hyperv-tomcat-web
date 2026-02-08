package demo;

import java.io.IOException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class HistoryServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("application/json");

        // 例：今を基準に「0ms / +5000ms / +12000ms」のイベントを作る（ミリ秒精度の絶対時刻）
        long t0 = System.currentTimeMillis();

        // 文字列連結で簡単に返す（DB実装の前段階なのでシンプル優先）
        String json =
            "{"
          + "\"generatedAtEpochMs\":" + t0 + ","
          + "\"events\":["
          +   "{\"epochMs\":" + (t0 + 0)     + ",\"url\":\"/myapp/pages/url_a.html\",\"label\":\"URL_A\"},"
          +   "{\"epochMs\":" + (t0 + 5000)  + ",\"url\":\"/myapp/pages/url_b.html\",\"label\":\"URL_B\"},"
          +   "{\"epochMs\":" + (t0 + 12000) + ",\"url\":\"/myapp/pages/url_c.html\",\"label\":\"URL_C\"}"
          + "]"
          + "}";

        resp.getWriter().write(json);
    }
}

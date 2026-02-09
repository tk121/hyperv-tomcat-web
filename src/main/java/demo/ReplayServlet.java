package demo;

import java.io.IOException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/**
 * ReplayServlet
 * ユーザーの操作履歴を1イベントずつポーリングで返すサーブレット
 * 
 * 機能：
 * - /myapp/api/history/info : 総イベント数を返す（初期化時に1回呼び出し）
 * - /myapp/api/history?index=N : N番目のイベント1つを返す（1秒周期でポーリング）
 * - 再生、巻き戻し、早送りに対応
 */
public class ReplayServlet extends HttpServlet {
    
    // テスト用イベントデータ（クラス変数に保持）
    // BASE_TIME：現在時刻から1分前を基準として、そこからのミリ秒オフセットを保持
    private static final long BASE_TIME = System.currentTimeMillis() - 60000;
    
    /**
     * EVENTSの配列構造：
     * [0] : id          イベント識別子（0から順番）
     * [1] : epochMs     タイムスタンプ（ミリ秒精度の絶対時刻）
     * [2] : url         遷移先ページURL
     * [3] : label       ページラベル（URL_A, URL_B, etc）
     * [4] : action      ユーザー操作（navigate, click, formSubmit, backBtn等）
     */
    private static final String[][] EVENTS = {
        {"0", String.valueOf(BASE_TIME + 0),      "/myapp/pages/url_a.html", "URL_A", "navigate"},
        {"1", String.valueOf(BASE_TIME + 2000),   "/myapp/pages/url_b.html", "URL_B", "click"},
        {"2", String.valueOf(BASE_TIME + 3500),   "/myapp/pages/url_c.html", "URL_C", "click"},
        {"3", String.valueOf(BASE_TIME + 8000),   "/myapp/pages/url_d.html", "URL_D", "backBtn"},
        {"4", String.valueOf(BASE_TIME + 15000),  "/myapp/pages/url_e.html", "URL_E", "formSubmit"},
        {"5", String.valueOf(BASE_TIME + 18000),  "/myapp/pages/url_f.html", "URL_F", "tabClick"},
        {"6", String.valueOf(BASE_TIME + 20500),  "/myapp/pages/url_g.html", "URL_G", "linkClick"},
        {"7", String.valueOf(BASE_TIME + 21800),  "/myapp/pages/url_h.html", "URL_H", "buttonClick"},
        {"8", String.valueOf(BASE_TIME + 23100),  "/myapp/pages/url_i.html", "URL_I", "linkClick"},
        {"9", String.valueOf(BASE_TIME + 28000),  "/myapp/pages/url_j.html", "URL_J", "formSubmit"},
        {"10", String.valueOf(BASE_TIME + 32000), "/myapp/pages/url_k.html", "URL_K", "backBtn"},
        {"11", String.valueOf(BASE_TIME + 35000), "/myapp/pages/url_l.html", "URL_L", "click"},
        {"12", String.valueOf(BASE_TIME + 38500), "/myapp/pages/url_m.html", "URL_M", "navigate"},
        {"13", String.valueOf(BASE_TIME + 42000), "/myapp/pages/url_a.html", "URL_A", "linkClick"},
        {"14", String.valueOf(BASE_TIME + 45000), "/myapp/pages/url_b.html", "URL_B", "buttonClick"},
        {"15", String.valueOf(BASE_TIME + 50000), "/myapp/pages/url_c.html", "URL_C", "navigate"},
        {"16", String.valueOf(BASE_TIME + 55000), "/myapp/pages/url_d.html", "URL_D", "click"},
        {"17", String.valueOf(BASE_TIME + 60000), "/myapp/pages/url_e.html", "URL_E", "linkClick"},
        {"18", String.valueOf(BASE_TIME + 65000), "/myapp/pages/url_f.html", "URL_F", "formSubmit"},
        {"19", String.valueOf(BASE_TIME + 70000), "/myapp/pages/url_g.html", "URL_G", "buttonClick"}
    };
    
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("application/json");

        String path = req.getRequestURI();
        
        // リクエストパスを確認して、処理を分岐
        // /info : 総イベント数情報を返す（初期化・統計用）
        // /find : 指定epochMs以降の最初のイベントindexを返す（開始位置決定用）
        // それ以外 : 指定インデックスのイベント1つを返す（ポーリング用）
        if (path.endsWith("/info")) {
            // ===== /info パターン：イベント総数を返す =====
            // JavaScript側の初期化時に1回呼び出され、全体のイベント数を取得
            // これにより、JS側でボタン状態制御やループ終了判定が可能
            String json = "{\"totalEvents\":" + EVENTS.length + ",\"generatedAtEpochMs\":" + System.currentTimeMillis() + "}";
            resp.getWriter().write(json);
        } else if (path.endsWith("/find")) {
            // ===== /find パターン：指定epochMs以降の最初のイベントindexを返す =====
            // JavaScript側が開始時刻を指定した場合に呼び出され、開始インデックスを取得
            // 例：/api/history/find?epochMs=1707467000000
            String epochMsStr = req.getParameter("epochMs");
            if (epochMsStr == null) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"epochMs parameter required\"}");
                return;
            }
            
            try {
                long targetEpochMs = Long.parseLong(epochMsStr);
                // 指定時刻以前の最後（最も新しい）のイベントインデックスを検索
                int foundIndex = -1;
                for (int i = EVENTS.length - 1; i >= 0; i--) {
                    long eventEpochMs = Long.parseLong(EVENTS[i][1]);
                    if (eventEpochMs <= targetEpochMs) {
                        foundIndex = i;
                        break;
                    }
                }
                
                // 見つからない場合は最初のイベント、見つかった場合はそのindex
                if (foundIndex == -1) {
                    foundIndex = 0;
                }
                
                String json = "{\"index\":" + foundIndex + "}";
                resp.getWriter().write(json);
            } catch (NumberFormatException e) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"invalid epochMs format\"}");
            }
        } else {
            // ===== インデックスポーリング：指定インデックスのイベント1つを返す =====
            // JS側が1秒周期で呼び出し、1イベントずつ取得
            // 再生時は index=0,1,2,... と増やす（順方向）
            // 巻き戻し時は index=5,4,3,... と減らす（逆方向）
            String indexStr = req.getParameter("index");
            // indexパラメータの検証
            if (indexStr == null) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"index parameter required\"}");
                return;
            }
            
            try {
                // インデックス値を整数に変換
                int index = Integer.parseInt(indexStr);
                // 範囲チェック（負数 or 総数以上はエラー）
                if (index < 0 || index >= EVENTS.length) {
                    resp.setStatus(400);
                    resp.getWriter().write("{\"error\":\"index out of range\"}");
                    return;
                }
                
                // 指定インデックスのイベントデータを取得し、JSON形式で返す
                String[] event = EVENTS[index];
                String json = "{"
                    + "\"id\":" + event[0]
                    + ",\"epochMs\":" + event[1]
                    + ",\"url\":\"" + event[2] + "\""
                    + ",\"label\":\"" + event[3] + "\""
                    + ",\"action\":\"" + event[4] + "\""
                    + "}";
                resp.getWriter().write(json);
            } catch (NumberFormatException e) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"invalid index format\"}");
            }
        }
    }
}

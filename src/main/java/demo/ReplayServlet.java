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
 * - /myapp/api/history/find : 指定時刻の開始インデックスを返す
 * - /myapp/api/history?index=N&endEpochMs=M : N番目のイベント1つを返す（1秒周期でポーリング）
 *   └ 終了時刻Mを超えたイベントには isLastEvent: true を付与
 * - 再生、巻き戻し、早送りに対応
 */
public class ReplayServlet extends HttpServlet {
    
    // テスト用イベントデータ（クラス変数に保持）
    // BASE_TIME：現在時刻から5分前を基準．前後5分間（合計10分間）のイベントを保持
    private static final long BASE_TIME = System.currentTimeMillis() - 300000;
    
    /**
     * EVENTSの配列構造：
     * [0] : id          イベント識別子（0から順番）
     * [1] : epochMs     タイムスタンプ（ミリ秒精度の絶対時刻）
     * [2] : url         遷移先ページURL
     * [3] : label       ページラベル（URL_A, URL_B, etc）
     * [4] : action      ユーザー操作（navigate, click, formSubmit, backBtn等）
     * 
     * 仕様：
     * - 現在時刻 - 5分 から 現在時刻 + 5分 までの10分間のデータ
     * - 全30イベント
     * - イベント間の時間差は最低5秒
     */
    private static final String[][] EVENTS = {
        {"0", String.valueOf(BASE_TIME + 0),          "/myapp/pages/url_a.html", "URL_A", "navigate"},
        {"1", String.valueOf(BASE_TIME + 5000),      "/myapp/pages/url_b.html", "URL_B", "click"},
        {"2", String.valueOf(BASE_TIME + 10000),      "/myapp/pages/url_c.html", "URL_C", "click"},
        {"3", String.valueOf(BASE_TIME + 15000),      "/myapp/pages/url_d.html", "URL_D", "backBtn"},
        {"4", String.valueOf(BASE_TIME + 20000),      "/myapp/pages/url_e.html", "URL_E", "formSubmit"},
        {"5", String.valueOf(BASE_TIME + 25000),      "/myapp/pages/url_f.html", "URL_F", "tabClick"},
        {"6", String.valueOf(BASE_TIME + 30000),      "/myapp/pages/url_g.html", "URL_G", "linkClick"},
        {"7", String.valueOf(BASE_TIME + 35000),      "/myapp/pages/url_h.html", "URL_H", "buttonClick"},
        {"8", String.valueOf(BASE_TIME + 45000),     "/myapp/pages/url_i.html", "URL_I", "linkClick"},
        {"9", String.valueOf(BASE_TIME + 50000),     "/myapp/pages/url_j.html", "URL_J", "formSubmit"},
        {"10", String.valueOf(BASE_TIME + 55000),    "/myapp/pages/url_k.html", "URL_K", "backBtn"},
        {"11", String.valueOf(BASE_TIME + 60000),    "/myapp/pages/url_l.html", "URL_L", "click"},
        {"12", String.valueOf(BASE_TIME + 65000),    "/myapp/pages/url_m.html", "URL_M", "navigate"},
        {"13", String.valueOf(BASE_TIME + 70000),    "/myapp/pages/url_a.html", "URL_A", "linkClick"},
        {"14", String.valueOf(BASE_TIME + 75000),    "/myapp/pages/url_b.html", "URL_B", "buttonClick"},
        {"15", String.valueOf(BASE_TIME + 80000),    "/myapp/pages/url_c.html", "URL_C", "navigate"},
        {"16", String.valueOf(BASE_TIME + 224000),    "/myapp/pages/url_d.html", "URL_D", "click"},
        {"17", String.valueOf(BASE_TIME + 240000),    "/myapp/pages/url_e.html", "URL_E", "linkClick"},
        {"18", String.valueOf(BASE_TIME + 256000),    "/myapp/pages/url_f.html", "URL_F", "formSubmit"},
        {"19", String.valueOf(BASE_TIME + 272000),    "/myapp/pages/url_g.html", "URL_G", "buttonClick"},
        {"20", String.valueOf(BASE_TIME + 288000),    "/myapp/pages/url_h.html", "URL_H", "click"},
        {"21", String.valueOf(BASE_TIME + 305000),    "/myapp/pages/url_i.html", "URL_I", "navigate"},
        {"22", String.valueOf(BASE_TIME + 322000),    "/myapp/pages/url_j.html", "URL_J", "linkClick"},
        {"23", String.valueOf(BASE_TIME + 339000),    "/myapp/pages/url_k.html", "URL_K", "formSubmit"},
        {"24", String.valueOf(BASE_TIME + 356000),    "/myapp/pages/url_l.html", "URL_L", "click"},
        {"25", String.valueOf(BASE_TIME + 373000),    "/myapp/pages/url_m.html", "URL_M", "buttonClick"},
        {"26", String.valueOf(BASE_TIME + 390000),    "/myapp/pages/url_a.html", "URL_A", "navigate"},
        {"27", String.valueOf(BASE_TIME + 407000),    "/myapp/pages/url_b.html", "URL_B", "linkClick"},
        {"28", String.valueOf(BASE_TIME + 424000),    "/myapp/pages/url_c.html", "URL_C", "click"},
        {"29", String.valueOf(BASE_TIME + 441000),    "/myapp/pages/url_d.html", "URL_D", "formSubmit"}
    };
    
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("application/json");

        String path = req.getRequestURI();
        
        // リクエストパスを確認して、処理を分岐
        // /find : 指定epochMs以前の最後のイベントインデックスを返す（開始位置決定用）
        // それ以外 : 指定インデックスのイベント1つを返す（ポーリング用）
        if (path.endsWith("/find")) {
            // ===== /find パターン：指定時刻以前の最後のイベントインデックスを返す =====
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
            // ===== イベントポーリング：指定インデックスのイベント1つを返す =====
            // JS側で呼び出し、1イベントずつ取得
            // 再生時は index=0,1,2,... と増やす（順方向）
            // 巻き戻し時は index=5,4,3,... と減らす（逆方向）
            // レスポンスに次のイベント時刻も含める（JS側で待機時間を計算可能にする）
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
                
                // 指定インデックスのイベントデータを取得
                String[] event = EVENTS[index];
                
                // JSON形式でイベントを組み立て
                String json = "{"
                    + "\"id\":" + event[0]
                    + ",\"epochMs\":" + event[1]
                    + ",\"url\":\"" + event[2] + "\""
                    + ",\"label\":\"" + event[3] + "\""
                    + ",\"action\":\"" + event[4] + "\"";
                
                // 次のイベント(index+1)が存在すれば、その時刻をレスポンスに含める
                if (index + 1 < EVENTS.length) {
                    String[] nextEvent = EVENTS[index + 1];
                    json += ",\"nextEpochMs\":" + nextEvent[1];
                }
                
                json += "}";
                resp.getWriter().write(json);
            } catch (NumberFormatException e) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"invalid index format\"}");
            }
        }
    }
}

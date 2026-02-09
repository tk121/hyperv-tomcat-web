package demo;

import java.io.IOException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class ReplayServlet extends HttpServlet {
    
    // テスト用イベントデータ（クラス変数に保持）
    private static final long BASE_TIME = System.currentTimeMillis() - 60000;
    private static final String[][] EVENTS = {
        {"0", String.valueOf(BASE_TIME + 0),      "/myapp/pages/url_a.html", "URL_A", "navigate"},
        {"1", String.valueOf(BASE_TIME + 2000),   "/myapp/pages/url_b.html", "URL_B", "click"},
        {"2", String.valueOf(BASE_TIME + 3500),   "/myapp/pages/url_c.html", "URL_C", "click"},
        {"3", String.valueOf(BASE_TIME + 8000),   "/myapp/pages/url_a.html", "URL_A", "backBtn"},
        {"4", String.valueOf(BASE_TIME + 15000),  "/myapp/pages/url_b.html", "URL_B", "formSubmit"},
        {"5", String.valueOf(BASE_TIME + 18000),  "/myapp/pages/url_c.html", "URL_C", "tabClick"},
        {"6", String.valueOf(BASE_TIME + 20500),  "/myapp/pages/url_a.html", "URL_A", "linkClick"},
        {"7", String.valueOf(BASE_TIME + 21800),  "/myapp/pages/url_b.html", "URL_B", "buttonClick"},
        {"8", String.valueOf(BASE_TIME + 23100),  "/myapp/pages/url_c.html", "URL_C", "linkClick"},
        {"9", String.valueOf(BASE_TIME + 28000),  "/myapp/pages/url_a.html", "URL_A", "formSubmit"},
        {"10", String.valueOf(BASE_TIME + 32000), "/myapp/pages/url_b.html", "URL_B", "backBtn"},
        {"11", String.valueOf(BASE_TIME + 35000), "/myapp/pages/url_c.html", "URL_C", "click"},
        {"12", String.valueOf(BASE_TIME + 38500), "/myapp/pages/url_a.html", "URL_A", "navigate"},
        {"13", String.valueOf(BASE_TIME + 42000), "/myapp/pages/url_b.html", "URL_B", "linkClick"},
        {"14", String.valueOf(BASE_TIME + 45000), "/myapp/pages/url_c.html", "URL_C", "buttonClick"},
        {"15", String.valueOf(BASE_TIME + 50000), "/myapp/pages/url_a.html", "URL_A", "navigate"}
    };
    
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("application/json");

        String path = req.getRequestURI();
        
        if (path.endsWith("/info")) {
            // イベント総数を返す
            String json = "{\"totalEvents\":" + EVENTS.length + ",\"generatedAtEpochMs\":" + System.currentTimeMillis() + "}";
            resp.getWriter().write(json);
        } else {
            // index パラメータで指定されたイベント1つを返す
            String indexStr = req.getParameter("index");
            if (indexStr == null) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"index parameter required\"}");
                return;
            }
            
            try {
                int index = Integer.parseInt(indexStr);
                if (index < 0 || index >= EVENTS.length) {
                    resp.setStatus(400);
                    resp.getWriter().write("{\"error\":\"index out of range\"}");
                    return;
                }
                
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

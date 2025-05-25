import axios from "axios";
import RSS from "rss";
import express from "express";

const app = express();
const port = process.env.PORT || 3000;
const host = "127.0.0.1";

// 首页路由 - 显示导航页面
app.get("/", (req, res) => {
  res.send(`
    <h1>VNDB RSS 订阅服务</h1>
    <p>本页面由非官方维护，如果对你有所帮助，快来一起成为 VNDB 编辑者吧~~☆</p>
    <ul>
      <li><a href="/uo-ch">民间汉化</a></li>
      <li><a href="/uo-en">Fan TL</a></li>
      <li><a href="/offi-ch">官方中文</a></li>
      <li><a href="/offi-en">Official TL</a></li>
    </ul>
  `);
});

/**
 * 处理 VNDB 的 notes 字段
 * @param {string|null} notes - 原始 notes 内容
 * @returns {string} 处理后的 HTML
 */
function formatNotes(notes) {
  if (notes == null) return ""; // 处理 null/undefined

  // VNDB 格式标记转 HTML
  return notes
    .replace(/\[b\](.*?)\[\/b\]/g, "<strong>$1</strong>") // 加粗
    .replace(/\[i\](.*?)\[\/i\]/g, "<em>$1</em>") // 斜体
    .replace(/\[u\](.*?)\[\/u\]/g, "<u>$1</u>") // 下划线
    .replace(/\[s\](.*?)\[\/s\]/g, "<del>$1</del>") // 删除线
    .replace(/\[url=(.*?)\](.*?)\[\/url\]/g, '<a href="$1">$2</a>') // 链接
    .replace(
      /\[spoiler\](.*?)\[\/spoiler\]/g,
      '<span class="spoiler">$1</span>'
    ) // 剧透
    .replace(/\[quote\](.*?)\[\/quote\]/g, "<blockquote>$1</blockquote>") // 引用
    .replace(/\[code\](.*?)\[\/code\]/g, "<pre><code>$1</code></pre>") // 代码块
    .replace(/\[raw\](.*?)\[\/raw\]/g, "$1") // 原始文本（移除标记）
    .replace(/\n/g, "<br/>"); // 换行符转HTML
}

// 通用 RSS 生成函数
async function generateRSS(req, filters, title, description) {
  const feed = new RSS({
    title: title,
    description: description,
    site_url: "https://vndb.org",
    feed_url: `http://${host}:${port}${req.baseUrl}`,
    language: "zh",
  });

  try {
    const response = await axios.post(
      "https://api.vndb.org/kana/release",
      {
        filters: filters,
        // 请求字段
        fields: "id,title,alttitle,released,extlinks{url,label,name,id},notes",
        sort: "released",
        reverse: true,
        results: 50, // 每类返回20条结果
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Token e59o-brd5z-z8o85-5i7e-n69mc-xccto-oc3e", // 替换为你的真实token
        },
      }
    );

    response.data.results.forEach((item) => {
      let customTitle;

      // 使用map遍历并格式化每个链接，然后用join('</br>')添加换行
      const linksText =
        item.extlinks
          ?.map((link) => `<a href="${link.url}">${link.label}</a> `)
          .join("</br></br>") || "";
      console.log(linksText);

      // 判断路由是否为中文/日文路由
      if (
        req.path === "/uo-ch" ||
        req.path === "/offi-ch" ||
        req.path === "/offi-jp"
      ) {
        // 设置标题优先级高的为alttitle，这是由于title默认是罗马音或英语，alttitle一般为译名
        customTitle = `${item.alttitle || item.title}`;
      } else {
        // 非中文路由使用title
        customTitle = `${item.title}`;
      }

      feed.item({
        title: customTitle,
        url: `https://vndb.org/${item.id}`,
        date: new Date(item.released),
        description: `${customTitle} </br></br>${linksText}</br></br>${formatNotes(
          item.notes
        )}`,
      });
    });

    return feed.xml({ indent: true });
  } catch (error) {
    console.error("错误详情:", {
      status: error.response?.status,
      message: error.response?.data,
      request: error.config?.data,
    });
    throw error;
  }
}

// 民间汉化作品
app.get("/uo-ch", async (req, res) => {
  try {
    const filters = [
      "and",
      ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
      ["freeware", "=", 1],
      ["official", "!=", 1], // 非官方
      ["released", "<=", "today"],
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "民间汉化",
      "免费且非官方的中文视觉小说"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// fan-translated‌
app.get("/uo-en", async (req, res) => {
  try {
    const filters = [
      "and",
      ["lang", "=", "en"],
      ["freeware", "=", 1],
      ["official", "!=", 1], // 非官方
      ["released", "<=", "today"],
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "Fan TL",
      "Unofficial English translated free visual novels"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 官方中文作品
app.get("/offi-ch", async (req, res) => {
  try {
    const filters = [
      "and",
      ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "官方中文",
      "有官中的视觉小说（含付费作品）"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 官方英文作品
app.get("/offi-en", async (req, res) => {
  try {
    const filters = [
      "and",
      ["lang", "=", "en"],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "Official TL",
      "Official English visual novels (including commercial)"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 公式日本語
app.get("/offi-jp", async (req, res) => {
  try {
    const filters = [
      "and",
      ["lang", "!=", "en"],
      ["lang", "!=", "zh-Hans"],
      ["lang", "!=", "zh-Hant"],
      ["olang", "=", "ja"],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "Official TL",
      "Official English visual novels (including commercial)"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 启动服务器
app.listen(port, host, () => {
  console.log(`服务器运行在 http://${host}:${port}`);
  console.log("可用路由:");
  console.log(`- 首页: http://${host}:${port}/`);
  console.log(`- 非官方中文: http://${host}:${port}/uo-ch`);
  console.log(`- 非官方英文: http://${host}:${port}/uo-en`);
  console.log(`- 官方中文: http://${host}:${port}/offi-ch`);
  console.log(`- 官方英文: http://${host}:${port}/offi-en`);
});

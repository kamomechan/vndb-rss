import axios from "axios";
import RSS from "rss";
import express from "express";

const app = express();
const port = process.env.PORT || 3000;
const host = "127.0.0.1";

// 缓存配置
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存时间
const cache = {
  "/uo-ch": { data: null, expiresAt: 0 },
  "/uo-en": { data: null, expiresAt: 0 },
  "/offi-ch": { data: null, expiresAt: 0 },
  "/offi-en": { data: null, expiresAt: 0 },
  "/offi-jp": { data: null, expiresAt: 0 },
};

/**
 * 生成格式化链接文本
 * @param {Array} extlinks - 链接数组，格式为[{url: string, label?: string}]
 * @param {string} [defaultLabel="link"] - 默认链接文本
 * @param {string} [separator="</br></br>"] - 链接分隔符
 * @returns {string} 格式化后的HTML链接文本
 */
function generateLinksText(
  extlinks = [],
  defaultLabel = "link",
  separator = "</br></br>"
) {
  // 参数校验
  if (!Array.isArray(extlinks) || extlinks.length === 0) {
    return "";
  }

  // 过滤并处理有效链接
  const validLinks = extlinks
    .filter((link) => link?.url?.trim())
    .map(
      (link) =>
        `<a href="${encodeURI(link.url)}">${link.label || defaultLabel}</a>`
    );

  return validLinks.length > 0 ? validLinks.join(separator) + separator : "";
}

/**
 * 处理 VNDB 的 notes 字段
 * @param {string|null} notes - 原始 notes 内容
 * @returns {string} 处理后的 HTML
 */
function generateFormatNotes(notes) {
  if (notes == null) return ""; // 处理 null/undefined

  // VNDB 格式标记转 HTML
  const formattedNotes = notes
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

  // 最后引用
  return `<blockquote>${formattedNotes}</blockquote>`;
}

// 通用 RSS 生成函数
async function generateRSS(req, filters, title, description) {
  const currentPath = req.path;
  const now = Date.now();
  // 检查缓存是否有效
  if (cache[currentPath].data && cache[currentPath].expiresAt > now) {
    return cache[currentPath].data;
  }

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
        fields:
          "id,title,alttitle,released,extlinks{url,label},platforms,notes",
        sort: "released",
        reverse: true,
        results: 5, // 每类返回20条结果
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
      let linksText = generateLinksText(item.extlinks);
      let formatNotes = generateFormatNotes(item.notes);

      // 根据路由类型匹配语言
      const langText = (() => {
        switch (req.path) {
          case "/uo-ch":
            return "[民间汉化]";
          case "/uo-en":
            return "[Fan TL]";
          case "/offi-ch":
            return "[官方中文]";
          case "/offi-en":
            return "[Official TL]";
          case "/offi-jp":
            return "[公式日本語]";
          default:
            return ""; // 默认返回空字符串
        }
      })();

      //拼接rid链接
      let ridLink = `(<a href="https://vndb.org/${item.id}">${item.id}</a>)`;

      // 遍历支持平台
      const platformsText =
        (item.platforms?.map((platform) => `[${platform}]`).join(" ") || "") +
        "</br></br>";

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
        description: `${langText} ${ridLink} ${customTitle} ${platformsText}${linksText}${formatNotes}`,
      });
    });

    // 更新缓存
    const xml = feed.xml({ indent: true });
    cache[currentPath] = {
      data: xml,
      expiresAt: now + CACHE_TTL,
    };
    return xml;
  } catch (error) {
    console.error("错误详情:", {
      status: error.response?.status,
      message: error.response?.data,
      request: error.config?.data,
    });
    // 尝试返回过期缓存（如果有）
    if (cache[currentPath].data) {
      console.warn("使用过期缓存作为降级方案");
      return cache[currentPath].data;
    }
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
      ["medium", "=", "in"], //筛选internet download版
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
      ["medium", "=", "in"], //筛选internet download版
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
      ["medium", "=", "in"], //筛选internet download版
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

// Official TL
app.get("/offi-en", async (req, res) => {
  try {
    const filters = [
      "and",
      ["lang", "=", "en"],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
      ["medium", "=", "in"], //筛选internet download版
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
      ["vn", "=", ["olang", "=", "ja"]],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
      ["medium", "=", "in"], //筛选internet download版
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "公式日本語",
      "Official Japanese visual novels (including commercial)"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

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
          <li><a href="/offi-jp">公式日本語</a></li>
        </ul>
      `);
});

// 启动服务器
app.listen(port, host, () => {
  console.log(`服务器运行在 http://${host}:${port}`);
  console.log("可用路由:");
  console.log(`- 首页: http://${host}:${port}/`);
  console.log(`- 民间汉化: http://${host}:${port}/uo-ch`);
  console.log(`- Fan TL: http://${host}:${port}/uo-en`);
  console.log(`- 官方中文: http://${host}:${port}/offi-ch`);
  console.log(`- Official TL: http://${host}:${port}/offi-en`);
  console.log(`- 公式日本語: http://${host}:${port}/offi-jp`);
});

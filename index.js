import "dotenv/config";
import axios from "axios";
import RSS from "rss";
import express from "express";
import { join } from "path";
import { readFileSync } from "fs";

const app = express();
const port = Number(process.env.PORT);
const host = process.env.HOST;

// 缓存配置
const CACHE_TTL = Number(process.env.CACHE_TIME);
const cache = {
  "/official": { data: null, expiresAt: 0 },
  "/unofficial": { data: null, expiresAt: 0 },
  "/offi-jp": { data: null, expiresAt: 0 },
};

/**
 * 根据路由和语言信息获取对应的标签文本
 * @param {string} path - 请求路径 (如 "/official", "/unofficial", "/offi-jp")
 * @param {Array} languages - 语言数组，包含对象 { lang: string }
 * @returns {string} 对应的标签文本
 */
function generateLanguageLabel(path, languages) {
  // 提取所有存在的语言代码
  const langCodes = languages.map((langObj) => langObj.lang);
  const hasEn = langCodes.includes("en");
  const hasZh = langCodes.includes("zh-Hans") || langCodes.includes("zh-Hant");
  const hasJp = langCodes.includes("ja");

  // 特殊处理日语路由
  if (path === "/offi-jp") {
    return "[公式日本語]";
  }

  // 官方版本路由
  if (path === "/official") {
    if (hasEn && hasZh) return "[Official TL/官方中文]";
    if (hasEn) return "[Official TL]";
    if (hasZh) return "[官方中文]";
    return ""; // 如果没有匹配语言
  }

  // 非官方版本路由
  if (path === "/unofficial") {
    if (hasEn && hasZh) return "[Fan TL/民间汉化]";
    if (hasEn) return "[Fan TL]";
    if (hasZh) return "[民间汉化]";
    return ""; // 如果没有匹配语言
  }

  return legacyMap[path] || "";
}

/**
 * 生成格式化链接文本
 * @param {Array} extlinks - 链接数组，格式为[{url: string, label?: string}]
 * @param {string} [defaultLabel="link"] - 默认链接文本
 * @param {string} [separator="<br><br>"] - 链接分隔符
 * @returns {string} 格式化后的HTML链接文本
 */
function generateLinksText(
  extlinks = [],
  defaultLabel = "link",
  separator = "<br><br>"
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
    .replace(/\n/g, "<br>"); // 换行符转HTML

  // 最后引用
  return `<blockquote>${formattedNotes}</blockquote>`;
}

/**
 * 获取安全图片的HTML标签
 * @param {Array} images - 图像数组
 * @returns {string} 格式化后的HTML图片标签或多个标签
 */
const generateImageTags = (images) => {
  // 1. 基础空值检查
  if (!Array.isArray(images)) {
    console.debug("images不是数组");
    return "";
  }

  // 2. 过滤并映射有效图片
  const validImages = images
    .filter((image) => {
      // 2.1 检查image对象有效性
      if (!image || typeof image !== "object") {
        return false;
      }

      // 2.2 验证sexual和violence投票值
      // sexual和violence值说明：
      // 0 = 安全
      // 1 = 可疑
      // 2 = 明确成人/暴力内容
      if (process.env.SAFETY_MODE !== "NSFW") {
        if (
          typeof image.sexual !== "number" ||
          typeof image.violence !== "number" ||
          typeof image.votecount !== "number" ||
          image.sexual !== 0 ||
          image.violence !== 0 ||
          image.votecount < 3
        ) {
          console.log(
            "忽略非安全图片，sexual:",
            image.sexual,
            "violence:",
            image.violence,
            "votecount:",
            image.votecount,
            image.url
          );
          return false;
        }
      }

      // 2.3 验证URL有效性
      if (
        !image.url ||
        !/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(image.url.trim())
      ) {
        console.debug("忽略无效URL:", image.url);
        return false;
      }

      return true;
    })
    .map((image) => {
      // 3. 生成HTML标签
      const url = image.url.trim();
      return `<img src="${url}" alt="Visual Novel Image" class="vndb-image">`;
    });

  // 4. 返回结果
  return validImages.join("<br>"); // 用换行符分隔多个图片
};

// 过滤自定义标签
function generateTagFilters(
  envTagValue = process.env.RECLUDE_TAG,
  operator = "!=",
  filterKey = "dtag"
) {
  // 处理未定义或空值，按逗号分隔后过滤无效项
  const tags = (envTagValue || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag); // 移除空字符串

  // 如果没有标签，返回空数组（不影响 filters 结构）
  if (tags.length === 0) return [];

  // 否则返回完整条件 [["vn", "=", ["and", ...]]]
  return [
    ["vn", "=", ["and", ...tags.map((tag) => [filterKey, operator, tag])]],
  ];
}

// 过滤自定义版本
function generateVersionFilters(
  envVersionValue = process.env.RECLUDE_VERSION,
  operator = "!=",
  filterKey = "rtype"
) {
  // 处理未定义或空值，按逗号分隔后过滤无效项
  const versions = (envVersionValue || "")
    .split(",")
    .map((version) => version.trim())
    .filter((version) => version); // 过滤掉空字符串

  // 如果没有有效值，返回空数组
  if (versions.length === 0) return [];

  // 否则返回完整条件
  return [
    ["and", ...versions.map((version) => [filterKey, operator, version])],
  ];
}

// OPML 生成函数
function generateOPML() {
  const feeds = [
    { title: "民间汉化/Fan TL", xmlUrl: `https://${host}/unofficial` },
    { title: "官方中文/Official TL", xmlUrl: `https://${host}/official` },
    { title: "公式日本語", xmlUrl: `https://${host}/offi-jp` },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
  <opml version="2.0">
    <head>
      <title>VNDB RSS 订阅合集</title>
      <dateCreated>${new Date().toUTCString()}</dateCreated>
    </head>
    <body>
      ${feeds
        .map(
          (feed) => `
      <outline
        type="rss"
        text="${feed.title}"
        title="${feed.title}"
        xmlUrl="${feed.xmlUrl}"
        htmlUrl="${host}"/>
      `
        )
        .join("")}
    </body>
  </opml>`;
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
          "id,title,alttitle,released,extlinks{url,label},platforms,notes,languages{lang},images{url,sexual,violence,votecount}",
        sort: "released",
        reverse: true,
        results: Number(process.env.FEED_NUMBER), // 路由返回的条目
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Token ${process.env.TOKEN}`, // 替换为你的真实token
        },
      }
    );

    response.data.results.forEach((item) => {
      let linksText = generateLinksText(item.extlinks);
      let formatNotes = generateFormatNotes(item.notes);

      // 根据路由类型匹配语言
      const langText = generateLanguageLabel(req.path, item.languages);

      // 判断路由是否为中文或日文路由，若是则设置标题优先级高的为alttitle，这是由于title默认是罗马音或英语，alttitle一般为译名或原名
      const shouldUseAltTitle =
        // 包含"官方中文"但不包含"/"（即不包含"官方中文/Official TL"）
        (langText.includes("官方中文") && !langText.includes("/")) ||
        // 包含"民间汉化"但不包含"/"（即不包含"民间汉化/Fan TL"）
        (langText.includes("民间汉化") && !langText.includes("/")) ||
        // 包含"公式日本語"
        langText.includes("公式日本語");

      // 设置标题
      const customTitle = shouldUseAltTitle
        ? `${item.alttitle || item.title}` // 优先使用 alttitle（如果不存在则回退到 title）
        : `${item.title}`; // 直接使用 title

      //拼接rid链接
      let ridLink = `(<a href="https://vndb.org/${item.id}">${item.id}</a>)`;

      // 遍历支持平台
      const platformsText =
        (item.platforms?.map((platform) => `[${platform}]`).join(" ") || "") +
        "<br><br>";

      //设置图片url
      const imgURL = generateImageTags(item.images);

      feed.item({
        title: customTitle,
        url: `https://vndb.org/${item.id}`,
        date: new Date(item.released),
        description: `${langText} ${ridLink} ${customTitle} ${platformsText}${linksText}${formatNotes}${imgURL}`,
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

// 民间汉化/Fan TL
app.get("/unofficial", async (req, res) => {
  try {
    const filters = [
      "and",
      [
        "or",
        ["lang", "=", "zh-Hans"],
        ["lang", "=", "zh-Hant"],
        ["lang", "=", "en"],
      ],
      ["freeware", "=", 1],
      ["official", "!=", 1], // 非官方
      ["released", "<=", "today"],
      ["medium", "=", "in"], //筛选internet download版
      ...generateTagFilters(), // 展开二维数组,过滤自定义标签
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "民间汉化/Fan TL",
      "免费且非官方的中文视觉小说/Unofficial English translated free visual novels"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 官方中文/Official TL
app.get("/official", async (req, res) => {
  try {
    const filters = [
      "and",
      [
        "or",
        ["lang", "=", "zh-Hans"],
        ["lang", "=", "zh-Hant"],
        ["lang", "=", "en"],
      ],
      ["official", "=", 1], // 官方
      ["released", "<=", "today"],
      ["medium", "=", "in"], //筛选internet download版
      ...generateTagFilters(), // 展开二维数组,过滤自定义标签
      ...generateVersionFilters(), //过滤自定义版本
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "官方中文/Official TL",
      "有官中的视觉小说(含付费作品)/Official English visual novels (including commercial)"
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
      ["medium", "=", "in"], //筛选 internet download版
      ...generateTagFilters(), // 展开二维数组,过滤自定义标签
      ...generateVersionFilters(), //过滤自定义版本
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

// 新增 OPML 导出路由
app.get("/export-opml", (req, res) => {
  const opmlContent = generateOPML();
  res.type("application/xml");
  res.send(opmlContent);
});

// 首页路由 - 显示导航页面
app.get("/", (req, res) => {
  try {
    const htmlPath = join(process.cwd(), "views/home.html");
    const htmlContent = readFileSync(htmlPath, "utf-8");
    res.send(htmlContent);
  } catch (err) {
    console.error("加载HTML文件失败:", err);
    res.status(500).send("页面加载错误");
  }
});

// 启动服务器
app.listen(port, host, () => {
  console.log(`服务器运行在 http://${host}:${port}`);
  console.log("可用路由:");
  console.log(`- 首页: http://${host}:${port}/`);
  console.log(`- 民间汉化/Fan TL: http://${host}:${port}/unofficial`);
  console.log(`- 官方中文/Official TL: http://${host}:${port}/official`);
  console.log(`- 公式日本語: http://${host}:${port}/offi-jp`);
  console.log(`- 导出OPML: http://${host}:${port}/export-opml`);
});

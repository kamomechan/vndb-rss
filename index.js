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
      <li><a href="/offi-jp">公式日本語</a></li>
    </ul>
  `);
});

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
        fields: "id,title,alttitle,released,extlinks{url,label},platforms",
        sort: "released",
        reverse: true,
        results: 3, // 每类返回20条结果
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
      // 使用示例
      console.log(langText); // 根据路由输出对应的标签

      // 使用map遍历并格式化每个链接，然后用join('</br>')添加换行
      const linksText =
        item.extlinks
          ?.map((link) => `<a href="${link.url}">${link.label}</a> `)
          .join("</br></br>") || "";
      console.log(linksText);

      //遍历平台
      const platformsText =
        item.platforms
          ?.map((platform) => `[${platform}]`) // 为每个平台添加方括号
          ?.join(" ") || // 用空格连接
        ""; // 空值保护
      console.log(platformsText); // 示例输出: "[Windows] [Linux] [Android] [Mac OS]"

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
        description: `${langText} ${customTitle} ${platformsText}</br></br>${linksText}</br></br>`,
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
      "公式日本語",
      "Official Japanese visual novels (including commercial)"
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
  console.log(`- 民间汉化: http://${host}:${port}/uo-ch`);
  console.log(`- Fan TL: http://${host}:${port}/uo-en`);
  console.log(`- 官方中文: http://${host}:${port}/offi-ch`);
  console.log(`- Official TL: http://${host}:${port}/offi-en`);
  console.log(`- 公式日本語: http://${host}:${port}/offi-jp`);
});

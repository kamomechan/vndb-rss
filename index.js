import axios from "axios";
import RSS from "rss";
import express from "express";

const app = express();
const port = process.env.PORT || 3000;
const host = "127.0.0.1";

async function generateRSS() {
  const feed = new RSS({
    title: "民间汉化",
    description: "筛选免费且非官方的汉化",
    site_url: "https://vndb.org",
    feed_url: "https://rss.tia-chan.top", // 替换为你的实际网址
    language: "zh",
  });

  try {
    const response = await axios.post(
      "https://api.vndb.org/kana/release",
      {
        filters: [
          "and",
          ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
          ["official", "!=", 1],
          ["freeware", "=", 1],
          ["released", "<=", "today"],
        ],
        fields: "id,title,released,vns.title,vns.alttitle",
        sort: "released",
        reverse: true,
        results: 10,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Token e59o-brd5z-z8o85-5i7e-n69mc-xccto-oc3e", // 替换真实 token
        },
      }
    );

    response.data.results.forEach((item) => {
      feed.item({
        title: `${item.vns?.title || item.title}${
          item.vns?.alttitle ? ` (${item.vns.alttitle})` : ""
        }`,
        url: `https://vndb.org/${item.id}`,
        date: new Date(item.released),
        description: `类型: ${item.title} <br/> 发布日期: ${item.released}`,
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

// 首页直接显示 RSS XML 内容
app.get("/", async (req, res) => {
  try {
    const rssXml = await generateRSS();
    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("生成 RSS 时出错");
  }
});

// 启动服务器
app.listen(port, host, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
});

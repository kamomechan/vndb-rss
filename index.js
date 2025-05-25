import axios from "axios";
import RSS from "rss";

async function generateRSS() {
  const feed = new RSS({
    title: "VNDB 免费中文作品",
    site_url: "https://vndb.org",
  });

  try {
    const response = await axios.post(
      "https://api.vndb.org/kana/release",
      {
        // 修正后的有效 filters 结构
        filters: [
          "and",
          ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
          ["freeware", "=", true],
          ["official", "=", 1],
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
        description: `类型: ${item.title} | 发布日期: ${item.released}`,
      });
    });

    console.log(feed.xml({ indent: true }));
  } catch (error) {
    console.error("错误详情:", {
      status: error.response?.status,
      message: error.response?.data,
      request: error.config?.data,
    });
  }
}

generateRSS();

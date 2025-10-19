import axios from "axios";
import RSS from "rss";
import express, { type Request, type Response } from "express";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const domain = process.env.DOMAIN;
const baseUrl = domain || `http://${host}:${port}`;

// cache config
const CACHE_TTL = Number(process.env.CACHE_TIME) || 300000;
const cache = {
  "/uo-ch": { data: "", expiresAt: 0 },
  "/uo-en": { data: "", expiresAt: 0 },
  "/offi-ch": { data: "", expiresAt: 0 },
  "/offi-en": { data: "", expiresAt: 0 },
  "/offi-jp": { data: "", expiresAt: 0 },
};

// Add type annotations for the VNDB API response fields
interface ExtlinksItem {
  url: string;
  label: string;
  // ...
}
interface LanguageItem {
  lang: string;
  // ...
}
interface ImageItem {
  url: string;
  sexual: number;
  violence: number;
  votecount: number;
}

// Other type annotations
type PathType = keyof typeof cache;

function generateLanguageLabel(path: PathType) {
  switch (path) {
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
      return "";
  }
}

function generateLinksText(extlinks: ExtlinksItem[], separator = "<br><br>") {
  // narrow
  if (extlinks.length === 0) {
    return "";
  }

  // hyperlink
  const validLinks = extlinks.map(
    (link) => `<a href="${link.url}">${link.label}</a>`
  );

  return validLinks.join(separator) + separator;
}

function generateFormatNotes(notes: string | null) {
  // narrow
  if (notes == null) return "";

  // BBCode to HTML conversion. https://vndb.org/d9#4
  const formattedNotes = notes
    .replace(/\[b\](.*?)\[\/b\]/g, "<strong>$1</strong>") // bold
    .replace(/\[i\](.*?)\[\/i\]/g, "<em>$1</em>") // italic
    .replace(/\[u\](.*?)\[\/u\]/g, "<u>$1</u>") // Underlined
    .replace(/\[s\](.*?)\[\/s\]/g, "<del>$1</del>") // strike through text
    .replace(/\[url=(.*?)\](.*?)\[\/url\]/g, function (match, url, text) {
      // Relative to absolute url conversion
      if (url.startsWith("/")) {
        url = "https://vndb.org" + url;
      }
      return `<a href="${url}">${text}</a>`;
    }) // link
    .replace(
      /\[spoiler\](.*?)\[\/spoiler\]/g,
      '<span class="spoiler">$1</span>'
    ) // spoiler
    .replace(/\[quote\](.*?)\[\/quote\]/g, "<blockquote>$1</blockquote>") // quote
    .replace(/\[code\](.*?)\[\/code\]/g, "<pre><code>$1</code></pre>") // code block
    .replace(/\[raw\](.*?)\[\/raw\]/g, "$1") // remove tag
    .replace(
      /(\s)([cdprsuv]\d+(?:\.\d+)?)/g,
      `$1<a href="https://vndb.org/$2">$2</a>`
    ) // VNDBID
    .replace(/(\s)(https?:\/\/.+?)(\s|$)/g, `$1<a href="$2">link</a>$3`) // reduce link length
    .replace(/\n/g, "<br>"); // line feed

  return `<blockquote>${formattedNotes}</blockquote>`;
}

const generateImageTags = (images: ImageItem[]) => {
  // narrow
  if (images.length === 0) {
    return "";
  }
  if (process.env.DISPLAY_IMAGE === "false") {
    return "";
  }

  const validImages = images
    .filter((image) => {
      // Check 'sexual','violence' and 'votecount' value.
      // Explanation of 'sexual' and 'violence' value:
      // 0 = Safe/Tame
      // 1 = Suggestive/Violent
      // 2 = Explicit/Brutal
      const SAFETY_MODE = process.env.SAFETY_MODE || "SFW";
      if (SAFETY_MODE !== "NSFW") {
        if (image.sexual >= 1 || image.violence >= 1 || image.votecount < 1) {
          console.log(`Exclude image:${image.url}`);
          return false;
        }
      }
      return true;
    })
    .map((image) => {
      const url = image.url.trim();
      return `<img src="${url}" alt="Visual Novel Image" class="vndb-image">`;
    });

  return validImages.join("<br>");
};

function generateCustomFilters(
  envValue: string | undefined,
  operator: "=" | "!=",
  filterKey: string,
  needsVN: boolean,
  logicalOperator: "and" | "or"
) {
  // narrow
  if (!envValue) {
    return [];
  }

  const values = envValue.split(",").map((value) => value.trim());

  return needsVN
    ? [
        [
          "vn",
          "=",
          [
            logicalOperator,
            ...values.map((value) => [filterKey, operator, value]),
          ],
        ],
      ]
    : [
        [
          logicalOperator,
          ...values.map((value) => [filterKey, operator, value]),
        ],
      ];
}

function generateOPML() {
  const feeds = [
    { title: "Official TL", xmlUrl: `${baseUrl}/offi-en` },
    { title: "Fan TL", xmlUrl: `${baseUrl}/uo-en` },
    { title: "民间汉化", xmlUrl: `${baseUrl}/uo-ch` },
    { title: "官方中文", xmlUrl: `${baseUrl}/offi-ch` },
    { title: "公式日本語", xmlUrl: `${baseUrl}/offi-jp` },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
  <opml version="2.0">
    <head>
      <title>VNDB RSS Subscription</title>
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
        xmlUrl="${feed.xmlUrl}"/>
      `
        )
        .join("")}
    </body>
  </opml>`;
}

async function generateRSS(
  req: Request,
  filters: Array<any>,
  title: string,
  description: string
) {
  const reqPath = req.path;
  const currentPath = reqPath as PathType;
  const now = Date.now();
  // Check if the cache entry exists and is not expired
  if (cache[currentPath].data && cache[currentPath].expiresAt > now) {
    return cache[currentPath].data;
  }

  const feed = new RSS({
    title: title,
    description: description,
    site_url: "https://vndb.org",
    feed_url: `${baseUrl}${currentPath}`,
    language: "zh",
  });

  try {
    const response = await axios.post(
      "https://api.vndb.org/kana/release",
      {
        filters: filters,
        fields:
          "id,title,alttitle,released,extlinks{url,label},platforms,notes,images{url,sexual,violence,votecount}",
        sort: "released",
        reverse: true,
        results: Number(process.env.FEED_NUMBER) || 20, // Number of entries returned.
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(process.env.TOKEN
            ? { Authorization: `Token ${process.env.TOKEN}` }
            : {}),
        },
      }
    );

    // Each entry
    response.data.results.forEach((item: any) => {
      const linksText = generateLinksText(item.extlinks);
      const formatNotes = generateFormatNotes(item.notes);

      const langText = generateLanguageLabel(currentPath);
      // Determine if the entry supports Chinese or Japanese. If so, set the title
      // with the higher priority (original/translated name) as 'alttitle'.
      // This is because 'title' defaults to Romaji or English, while 'alttitle' is
      // generally reserved for the original or local translation.

      // Specifically: Official TL(translation) entries usually have an English title, so we use 'title'.
      // Fan TL(translation) entries (from the English-speaking community) often use the Romaji title,
      // so we prioritize 'alttitle' for the translated/original name.
      let customTitle;
      // set title
      if (
        currentPath === "/uo-ch" ||
        currentPath === "/offi-ch" ||
        currentPath === "/offi-jp" ||
        currentPath === "/uo-en"
      ) {
        customTitle = `${item.alttitle || item.title}`; // The 'alttitle' may be null
      } else {
        customTitle = `${item.title}`;
      }

      // set VNDBID
      const ridLink = `<a href="https://vndb.org/${item.id}">${customTitle}</a>`;

      // set platforms
      const platformsText =
        (item.platforms
          ?.map((platform: string) => `[${platform}]`)
          ?.join(" ") || "") + "<br><br>";

      // set image
      const imgURL = generateImageTags(item.images);

      feed.item({
        title: customTitle,
        url: `https://vndb.org/${item.id}`,
        date: new Date(item.released),
        description: `${langText} ${ridLink} ${platformsText}${linksText}${formatNotes}${imgURL}`,
      });
    });

    // Update cache
    const xml = feed.xml({ indent: true });
    cache[currentPath] = {
      data: xml,
      expiresAt: now + CACHE_TTL,
    };
    return xml;
  } catch (error) {
    console.error("error", {
      status: error.response?.status,
      message: error.response?.data,
    });
    // Attempt to return stale cache (if available).
    if (cache[currentPath].data) {
      console.warn("error: return stale cache");
      return cache[currentPath].data;
    }
    throw error;
  }
}

// 民间汉化
app.get("/uo-ch", async (req: Request, res: Response) => {
  try {
    const filters = [
      "and",
      ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
      ["freeware", "=", 1],
      ["official", "!=", 1],
      ["released", "<=", "today"],
      // Customize to include the 'medium' field
      ...generateCustomFilters(
        process.env.INCLUDE_MEDIA,
        "=",
        "medium",
        false,
        "or"
      ),
      // Customize to exclude the 'dtag' field
      ...generateCustomFilters(
        process.env.EXCLUDE_TAG,
        "!=",
        "dtag",
        true,
        "and"
      ),
      // Customize to include the 'platform' field
      ...generateCustomFilters(
        process.env.INCLUDE_PLATFORM,
        "=",
        "platform",
        false,
        "or"
      ),
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "民间汉化",
      "社区翻译的视觉小说"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("Generate RSS error");
  }
});

// Fan TL
app.get("/uo-en", async (req: Request, res: Response) => {
  try {
    const filters = [
      "and",
      ["lang", "=", "en"],
      ["freeware", "=", 1],
      ["official", "!=", 1],
      ["released", "<=", "today"],
      ...generateCustomFilters(
        process.env.INCLUDE_MEDIA,
        "=",
        "medium",
        false,
        "or"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_TAG,
        "!=",
        "dtag",
        true,
        "and"
      ),
      ...generateCustomFilters(
        process.env.INCLUDE_PLATFORM,
        "=",
        "platform",
        false,
        "or"
      ),
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "Fan TL",
      "Fan translated visual novels"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("Generate RSS error");
  }
});

// 官方中文
app.get("/offi-ch", async (req: Request, res: Response) => {
  try {
    const filters = [
      "and",
      ["or", ["lang", "=", "zh-Hans"], ["lang", "=", "zh-Hant"]],
      ["official", "=", 1],
      ["released", "<=", "today"],
      ...generateCustomFilters(
        process.env.INCLUDE_MEDIA,
        "=",
        "medium",
        false,
        "or"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_TAG,
        "!=",
        "dtag",
        true,
        "and"
      ),
      // Customize to exclude 'rtype' field.
      ...generateCustomFilters(
        process.env.EXCLUDE_VERSION,
        "!=",
        "rtype",
        false,
        "and"
      ),
      ...generateCustomFilters(
        process.env.INCLUDE_PLATFORM,
        "=",
        "platform",
        false,
        "or"
      ),
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "官方中文",
      "官方中文视觉小说"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("Generate RSS error");
  }
});

// Official TL
app.get("/offi-en", async (req: Request, res: Response) => {
  try {
    const filters = [
      "and",
      ["lang", "=", "en"],
      ["official", "=", 1],
      ["released", "<=", "today"],
      ...generateCustomFilters(
        process.env.INCLUDE_MEDIA,
        "=",
        "medium",
        false,
        "or"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_TAG,
        "!=",
        "dtag",
        true,
        "and"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_VERSION,
        "!=",
        "rtype",
        false,
        "and"
      ),
      ...generateCustomFilters(
        process.env.INCLUDE_PLATFORM,
        "=",
        "platform",
        false,
        "or"
      ),
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "Official TL",
      "Official English visual novels"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("Generate RSS error");
  }
});

// 公式日本語
app.get("/offi-jp", async (req: Request, res: Response) => {
  try {
    const filters = [
      "and",
      ["lang", "!=", "en"],
      ["lang", "!=", "zh-Hans"],
      ["lang", "!=", "zh-Hant"],
      ["lang", "=", "ja"],
      ["vn", "=", ["olang", "=", "ja"]],
      ["official", "=", 1],
      ["released", "<=", "today"],
      ...generateCustomFilters(
        process.env.INCLUDE_MEDIA,
        "=",
        "medium",
        false,
        "or"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_TAG,
        "!=",
        "dtag",
        true,
        "and"
      ),
      ...generateCustomFilters(
        process.env.EXCLUDE_VERSION,
        "!=",
        "rtype",
        false,
        "and"
      ),
      ...generateCustomFilters(
        process.env.INCLUDE_PLATFORM,
        "=",
        "platform",
        false,
        "or"
      ),
    ];

    const rssXml = await generateRSS(
      req,
      filters,
      "公式日本語",
      "Official Japanese visual novels"
    );

    res.type("application/xml");
    res.send(rssXml);
  } catch (error) {
    res.status(500).send("Generate RSS error");
  }
});

// Export OPML route
app.get("/export-opml", (req: Request, res: Response) => {
  const opmlContent = generateOPML();
  res.type("application/xml");
  res.send(opmlContent);
});

// Homepage route
app.get("/", (req: Request, res: Response) => {
  try {
    const htmlPath = join(process.cwd(), "views/home.html");
    const htmlContent = readFileSync(htmlPath, { encoding: "utf-8" });
    res.send(htmlContent);
  } catch (err) {
    console.error("Homepage load error", err);
    res.status(500).send("Homepage load error");
  }
});

// launcher
app.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
  console.log("Available routes:");
  console.log(`- Homepage: http://${host}:${port}/`);
  console.log(`- Official TL: http://${host}:${port}/offi-en`);
  console.log(`- Fan TL: http://${host}:${port}/uo-en`);
  console.log(`- 官方中文: http://${host}:${port}/offi-ch`);
  console.log(`- 民间汉化: http://${host}:${port}/uo-ch`);
  console.log(`- 公式日本語: http://${host}:${port}/offi-jp`);
  console.log(`- Export OPML: http://${host}:${port}/export-opml`);
});

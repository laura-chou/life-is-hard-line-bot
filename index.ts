const flexTemplateString = `{
  "type": "bubble",
  "size": "mega",
  "body": {
    "type": "box",
    "layout": "vertical",
    "backgroundColor": "#FFFFFF",
    "cornerRadius": "xl",
    "paddingAll": "xxl",
    "contents": [
      {
        "type": "text",
        "text": "{{TITLE}}",
        "weight": "bold",
        "size": "xl",
        "align": "center",
        "color": "#1C1B1F",
        "wrap": true
      },
      {
        "type": "text",
        "text": "{{CHINESE_TEXT}}",
        "wrap": true,
        "size": "md",
        "color": "#1C1B1F",
        "margin": "xl",
        "lineSpacing": "10px"
      },
      {
        "type": "text",
        "text": "{{ENGLISH_TEXT}}",
        "wrap": true,
        "size": "sm",
        "color": "#666666",
        "margin": "xxl",
        "lineSpacing": "10px"
      }
    ]
  }
}`;

const BASE_DOMAIN = "https://www.thefactsite.com";

const factPaths: string[] = [
  "/1000-interesting-facts/",
  "/1000-interesting-facts/2/",
  "/1000-interesting-facts/3/",
  "/1000-interesting-facts/4/",
  "/1000-interesting-facts/5/",
  "/top-100-random-funny-facts/",
  "/100-strange-but-true-facts/",
  "/100-mind-blowing-facts/",
  "/100-space-facts/",
  "/100-random-food-facts/",
];

const factUrls: string[] = factPaths.map(path => `${BASE_DOMAIN}${path}`);

const quotefancyUrls: string[] = [
  "https://quotefancy.com/demotivational-quotes",
  "https://quotefancy.com/demotivational-quotes/page/2",
];

interface FactResult {
  title: string;
  body: string;
  text: string; // Full combined text used for Column B deduplication
  imageUrl?: string | null;
  targetUrl?: string;
}

/**
 * Strips HTML tags and unescapes common HTML entities.
 */
function cleanHtml(html: string): string {
  let cleaned = html.replace(/<[^>]+>/g, "");
  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "—");
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Helper to execute an operation with auto-retry up to 3 attempts.
 * Default initial delay is 10000ms (10 seconds) for server rate limit stability.
 */
function withRetry<T>(fn: () => T, maxAttempts: number = 3, initialDelayMs: number = 10000): T {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`Attempt ${attempt}/${maxAttempts} failed: ${err?.message || err}`);
      if (attempt < maxAttempts) {
        Utilities.sleep(initialDelayMs * attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Scrapes facts from a single specified target URL (thefactsite.com).
 * Extracts all candidate items (both <p class="list"> and <h2 class="list"> blocks).
 */
function scrapeUrlFacts(targetUrl: string): FactResult[] {
  return withRetry(() => {
    console.log(`[Scraper Fact] Fetching URL: ${targetUrl}`);

    const response = UrlFetchApp.fetch(targetUrl, {
      muteHttpExceptions: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      throw new Error(`HTTP Error ${statusCode} when fetching ${targetUrl}`);
    }

    const html = response.getContentText();
    const urlResults: FactResult[] = [];

    // 1. Standalone <p class="list"> items
    const pListRegex = /<p\s+class="list"[^>]*>([\s\S]*?)<\/p>/gi;
    let pListMatch: RegExpExecArray | null;

    while ((pListMatch = pListRegex.exec(html)) !== null) {
      const rawPContent = pListMatch[1];
      const cleanedText = cleanHtml(rawPContent);

      if (cleanedText.length > 10) {
        let imageUrl: string | null = null;
        const imgMatch = rawPContent.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          imageUrl = imgMatch[1];
        }

        urlResults.push({
          title: "本日冷知識",
          body: cleanedText,
          text: cleanedText,
          imageUrl: imageUrl,
          targetUrl: targetUrl,
        });
      }
    }

    // 2. <h2 class="list"> blocks
    const h2Regex = /<h2\s+class="list"[^>]*>(.*?)<\/h2>([\s\S]*?)(?=<h2\s+class="list"|<p\s+class="list"|$)/gi;
    let h2Match: RegExpExecArray | null;

    while ((h2Match = h2Regex.exec(html)) !== null) {
      const titleRaw = h2Match[1];
      const title = cleanHtml(titleRaw);
      const chunkBody = h2Match[2];

      let imageUrl: string | null = null;
      const paragraphs: string[] = [];

      const overallImgMatch = chunkBody.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
      if (overallImgMatch && overallImgMatch[1]) {
        imageUrl = overallImgMatch[1];
      }

      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = pRegex.exec(chunkBody)) !== null) {
        const rawP = pMatch[1];

        if (/<img/i.test(rawP)) {
          const imgMatch = rawP.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
          if (imgMatch && imgMatch[1] && !imageUrl) {
            imageUrl = imgMatch[1];
          }
          continue;
        }

        const cleanedP = cleanHtml(rawP);
        if (cleanedP === "" || rawP.trim() === "&nbsp;") {
          if (paragraphs.length > 0) {
            break;
          }
          continue;
        }

        if (cleanedP.length > 5 && !cleanedP.includes("Cookie") && !cleanedP.includes("Copyright")) {
          paragraphs.push(cleanedP);
        }
      }

      if (title.length > 3) {
        const bodyContent = paragraphs.join("\n\n");
        const fullContent = bodyContent ? `${title}\n\n${bodyContent}` : title;
        urlResults.push({
          title: title,
          body: bodyContent,
          text: fullContent,
          imageUrl: imageUrl,
          targetUrl: targetUrl,
        });
      }
    }

    return urlResults;
  });
}

/**
 * Helper to fetch Quotefancy HTML content.
 * Attempts direct request with browser header emulation first; falls back to Web Proxy if HTTP 403 / anti-bot block occurs.
 */
function fetchQuotefancyHtml(targetUrl: string): string {
  const customHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  try {
    console.log(`[Scraper Quotefancy] Direct fetching URL: ${targetUrl}`);
    const response = UrlFetchApp.fetch(targetUrl, {
      muteHttpExceptions: true,
      headers: customHeaders,
    });

    const statusCode = response.getResponseCode();
    if (statusCode === 200) {
      const html = response.getContentText();
      if (html && html.includes("q-wrapper")) {
        return html;
      }
    }

    console.warn(`[Scraper Quotefancy] Direct fetch returned status ${statusCode}. Trying proxy fallback...`);
  } catch (err: any) {
    console.warn(`[Scraper Quotefancy] Direct fetch failed: ${err?.message || err}. Trying proxy fallback...`);
  }

  // Fallback to Web Proxy (api.allorigins.win) to bypass 403 / anti-bot block
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
  console.log(`[Scraper Quotefancy] Fetching via proxy: ${proxyUrl}`);

  const proxyResponse = UrlFetchApp.fetch(proxyUrl, {
    muteHttpExceptions: true,
  });

  const proxyStatusCode = proxyResponse.getResponseCode();
  if (proxyStatusCode !== 200) {
    throw new Error(`Proxy request failed with HTTP ${proxyStatusCode} for ${targetUrl}`);
  }

  const jsonResult = JSON.parse(proxyResponse.getContentText());
  if (!jsonResult || !jsonResult.contents) {
    throw new Error(`Invalid response structure from proxy for ${targetUrl}`);
  }

  return jsonResult.contents;
}

/**
 * Scrapes demotivational quotes from a single specified Quotefancy target URL.
 * Extracts candidate items from <div class="q-wrapper"> blocks.
 */
function scrapeQuotefancyUrl(targetUrl: string): FactResult[] {
  return withRetry(() => {
    const html = fetchQuotefancyHtml(targetUrl);
    const urlResults: FactResult[] = [];

    const wrapperRegex = /<div\s+class="q-wrapper"[^>]*>([\s\S]*?)(?=<div\s+class="q-wrapper"|$)/gi;
    let wrapperMatch: RegExpExecArray | null;

    while ((wrapperMatch = wrapperRegex.exec(html)) !== null) {
      const wrapperHtml = wrapperMatch[1];

      const quoteMatch = wrapperHtml.match(/<a\s+class="quote-a"[^>]*>([\s\S]*?)<\/a>/i);
      if (!quoteMatch) continue;

      const rawQuote = quoteMatch[1];
      const quoteText = cleanHtml(rawQuote);
      if (!quoteText) continue;

      const authorMatch = wrapperHtml.match(/<p\s+class="author-p"[^>]*>([\s\S]*?)<\/p>/i);
      let authorName = "";
      if (authorMatch && authorMatch[1]) {
        let cleanedAuthor = cleanHtml(authorMatch[1]);
        cleanedAuthor = cleanedAuthor.replace(/^[-_\s]+/, "").trim();
        authorName = cleanedAuthor;
      }

      let fullEnglishText = quoteText;
      if (authorName) {
        fullEnglishText = `${quoteText}\n- ${authorName}`;
      }

      urlResults.push({
        title: "本日語錄",
        body: fullEnglishText,
        text: fullEnglishText,
        imageUrl: "",
        targetUrl: targetUrl,
      });
    }

    return urlResults;
  });
}

/**
 * Gets or opens the active Google Sheet instance.
 */
function getSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID script property is not configured.");
  }
  const ss = SpreadsheetApp.openById(spreadsheetId);
  return ss.getSheets()[0];
}

/**
 * Function 1: Batch scrape target website URLs and save new facts/quotes into Google Sheet.
 * Schema: Column A (Title), Column B (English Text), Column C (Image URL), Column D (Status), Column E (Sent Timestamp)
 */
function scrapeAndSaveToSheet(): void {
  console.log("=== Starting Batch Scrape & Save to Sheet ===");
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Create lookup set for existing Column B (English Text) values
  const existingEnglishTexts = new Set<string>();
  for (let i = 1; i < data.length; i++) {
    const text = data[i][1]; // Column B is English Text
    if (text) {
      existingEnglishTexts.add(String(text).trim().toLowerCase());
    }
  }

  let totalNewAdded = 0;

  // 1. Scrape factUrls (thefactsite.com)
  for (const targetUrl of factUrls) {
    try {
      const candidates = scrapeUrlFacts(targetUrl);
      console.log(`[Scraper Fact] Found ${candidates.length} candidates from ${targetUrl}`);

      for (const item of candidates) {
        const compareText = (item.body && item.body.length > 0) ? item.body : item.text;
        const normalizedText = compareText.trim().toLowerCase();

        if (!existingEnglishTexts.has(normalizedText)) {
          const displayTitle = item.title && item.title.trim().length > 0 ? item.title : "本日冷知識";
          const englishContent = item.body || item.text;
          const imageUrlStr = item.imageUrl || "";

          sheet.appendRow([displayTitle, englishContent, imageUrlStr, "PENDING", ""]);
          existingEnglishTexts.add(normalizedText);
          totalNewAdded++;
        }
      }
    } catch (err: any) {
      console.warn(`[Scraper Error] Failed to scrape ${targetUrl}: ${err?.message || err}`);
    }
  }

  // 2. Scrape quotefancyUrls (quotefancy.com)
  for (const targetUrl of quotefancyUrls) {
    try {
      const candidates = scrapeQuotefancyUrl(targetUrl);
      console.log(`[Scraper Quotefancy] Found ${candidates.length} candidates from ${targetUrl}`);

      for (const item of candidates) {
        const compareText = (item.body && item.body.length > 0) ? item.body : item.text;
        const normalizedText = compareText.trim().toLowerCase();

        if (!existingEnglishTexts.has(normalizedText)) {
          const displayTitle = item.title && item.title.trim().length > 0 ? item.title : "本日語錄";
          const englishContent = item.body || item.text;
          const imageUrlStr = item.imageUrl || "";

          sheet.appendRow([displayTitle, englishContent, imageUrlStr, "PENDING", ""]);
          existingEnglishTexts.add(normalizedText);
          totalNewAdded++;
        }
      }
    } catch (err: any) {
      console.warn(`[Scraper Error] Failed to scrape ${targetUrl}: ${err?.message || err}`);
    }
  }

  console.log(`=== Batch Scrape Finished. Added ${totalNewAdded} new entries to Google Sheet. ===`);
}

/**
 * Translates English text (facts or quotes) into Taiwan Traditional Chinese using Gemini API (gemini-3.8-flash) with retry logic.
 */
function translateWithGemini(englishText: string): string {
  return withRetry(() => {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY script property is not configured.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const prompt = `請將以下英文內容（冷知識或名言短句）翻譯成台灣日常繁體中文，語氣要生動、吸引人且適合社群分享。只需輸出翻譯後的中文內容，不要附加任何解釋、標題或英文原文：\n\n${englishText}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      throw new Error(`Gemini API Error (${statusCode}): ${response.getContentText()}`);
    }

    const result = JSON.parse(response.getContentText());
    const chineseText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!chineseText) {
      throw new Error("Failed to parse response from Gemini API.");
    }

    return chineseText.trim();
  });
}

/**
 * Helper to construct the LINE Flex Message payload.
 */
function buildFlexMessagePayload(
  displayTitle: string,
  chineseText: string,
  englishText: string,
  imageUrl?: string | null
): object {
  const jsonStr = flexTemplateString
    .replace("{{TITLE}}", displayTitle.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
    .replace("{{CHINESE_TEXT}}", chineseText.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
    .replace("{{ENGLISH_TEXT}}", englishText.replace(/"/g, '\\"').replace(/\n/g, "\\n"));

  const flexObj = JSON.parse(jsonStr);

  if (imageUrl && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
    flexObj.hero = {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectMode: "cover",
      aspectRatio: "20:13",
      offsetTop: "none",
      gravity: "center"
    };
  }

  return {
    type: "flex",
    altText: displayTitle,
    contents: flexObj,
  };
}

/**
 * Function 2: Daily automated function to randomly select a 'PENDING' row from Google Sheet,
 * translate via Gemini, broadcast via LINE Flex Message, and update Status to 'SENT'.
 */
function dailyBroadcastFromSheet(): void {
  console.log("=== Starting Daily Broadcast From Sheet ===");
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  interface PendingRow {
    rowIndex: number; // 1-based row index in Google Sheet
    title: string;
    englishText: string;
    imageUrl: string;
  }

  const pendingRows: PendingRow[] = [];

  // Collect all rows where Column D === 'PENDING'
  for (let i = 1; i < data.length; i++) {
    const status = data[i][3]; // Column D is Status
    const text = String(data[i][1] || "").trim();
    if (status && String(status).trim().toUpperCase() === "PENDING" && text) {
      pendingRows.push({
        rowIndex: i + 1,
        title: String(data[i][0] || "本日冷知識").trim(),
        englishText: text,
        imageUrl: String(data[i][2] || "").trim(),
      });
    }
  }

  if (pendingRows.length === 0) {
    console.warn("⚠️ [Daily Broadcast Warning] No 'PENDING' records found in Google Sheet.");
    return;
  }

  // Randomly select one pending item
  const randomIndex = Math.floor(Math.random() * pendingRows.length);
  const target = pendingRows[randomIndex];

  console.log(`[Daily Broadcast] Selected Random Row ${target.rowIndex} (out of ${pendingRows.length} PENDING items): Title="${target.title}"`);

  const chineseText = translateWithGemini(target.englishText);
  const flexMessage = buildFlexMessagePayload(target.title, chineseText, target.englishText, target.imageUrl);

  const props = PropertiesService.getScriptProperties().getProperties();
  const tokens: string[] = [];

  for (const key of Object.keys(props)) {
    if (key.startsWith("LINE_CHANNEL_ACCESS_TOKEN")) {
      const val = props[key];
      if (val) {
        tokens.push(val);
      }
    }
  }

  if (tokens.length === 0) {
    throw new Error("No LINE_CHANNEL_ACCESS_TOKEN found in ScriptProperties.");
  }

  for (const token of tokens) {
    withRetry(() => {
      const broadcastUrl = "https://api.line.me/v2/bot/message/broadcast";
      const response = UrlFetchApp.fetch(broadcastUrl, {
        method: "post",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        payload: JSON.stringify({
          messages: [flexMessage],
        }),
        muteHttpExceptions: true,
      });

      console.log(`[LINE Broadcast API] Status Code: ${response.getResponseCode()}, Body: ${response.getContentText()}`);
      if (response.getResponseCode() !== 200) {
        throw new Error(`LINE Broadcast API failed with status ${response.getResponseCode()}: ${response.getContentText()}`);
      }
    });
  }

  // Update sheet: Column D -> 'SENT', Column E -> ISO Timestamp
  const nowTimestamp = new Date().toISOString();
  sheet.getRange(target.rowIndex, 4).setValue("SENT"); // Column D
  sheet.getRange(target.rowIndex, 5).setValue(nowTimestamp); // Column E

  console.log(`=== Daily Broadcast Successful! Updated Row ${target.rowIndex} Status to SENT at ${nowTimestamp} ===`);
}

/**
 * Developer test function to randomly push a 'PENDING' item to MY_LINE_USER_ID
 * and update its status to 'SENT' with Sent Timestamp upon successful push.
 */
function testPushToMe(): void {
  const props = PropertiesService.getScriptProperties();
  const userId = props.getProperty("MY_LINE_USER_ID");
  if (!userId) {
    throw new Error("MY_LINE_USER_ID script property is not configured.");
  }

  const allProps = props.getProperties();
  let token = "";
  for (const key of Object.keys(allProps)) {
    if (key.startsWith("LINE_CHANNEL_ACCESS_TOKEN_2")) {
      token = allProps[key];
      break;
    }
  }

  if (!token) {
    for (const key of Object.keys(allProps)) {
      if (key.startsWith("LINE_CHANNEL_ACCESS_TOKEN")) {
        token = allProps[key];
        break;
      }
    }
  }

  if (!token) {
    throw new Error("No LINE_CHANNEL_ACCESS_TOKEN found in ScriptProperties.");
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  interface PendingRow {
    rowIndex: number; // 1-based row index in Google Sheet
    title: string;
    englishText: string;
    imageUrl: string;
  }

  const pendingRows: PendingRow[] = [];

  // Collect all rows where Column D === 'PENDING'
  for (let i = 1; i < data.length; i++) {
    const status = data[i][3]; // Column D is Status
    const text = String(data[i][1] || "").trim();
    if (status && String(status).trim().toUpperCase() === "PENDING" && text) {
      pendingRows.push({
        rowIndex: i + 1,
        title: String(data[i][0] || "本日冷知識").trim(),
        englishText: text,
        imageUrl: String(data[i][2] || "").trim(),
      });
    }
  }

  if (pendingRows.length === 0) {
    console.warn("⚠️ [Test Push Warning] No 'PENDING' records found in Google Sheet.");
    return;
  }

  // Randomly select one pending item
  const randomIndex = Math.floor(Math.random() * pendingRows.length);
  const target = pendingRows[randomIndex];

  console.log(`[Test Push] Selected Random Row ${target.rowIndex} (out of ${pendingRows.length} PENDING items): Title="${target.title}"`);

  const chineseText = translateWithGemini(target.englishText);

  console.log("=== Test Push Console Log ===");
  console.log(`Row Index: ${target.rowIndex}`);
  console.log(`Title: ${target.title}`);
  console.log(`Original English Text: ${target.englishText}`);
  console.log(`Image URL: ${target.imageUrl || "None"}`);
  console.log(`Gemini Chinese Translation: ${chineseText}`);

  const flexMessage = buildFlexMessagePayload(target.title, chineseText, target.englishText, target.imageUrl);

  withRetry(() => {
    const pushUrl = "https://api.line.me/v2/bot/message/push";
    const response = UrlFetchApp.fetch(pushUrl, {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      payload: JSON.stringify({
        to: userId,
        messages: [flexMessage],
      }),
      muteHttpExceptions: true,
    });

    console.log(`[LINE Push API] Status Code: ${response.getResponseCode()}, Body: ${response.getContentText()}`);
    if (response.getResponseCode() !== 200) {
      throw new Error(`LINE Push API failed with status ${response.getResponseCode()}: ${response.getContentText()}`);
    }
  });

  // Update sheet: Column D -> 'SENT', Column E -> ISO Timestamp upon successful push
  const nowTimestamp = new Date().toISOString();
  sheet.getRange(target.rowIndex, 4).setValue("SENT"); // Column D
  sheet.getRange(target.rowIndex, 5).setValue(nowTimestamp); // Column E

  console.log(`=== Test Push Successful! Updated Row ${target.rowIndex} Status to SENT at ${nowTimestamp} ===`);
}

(globalThis as any).scrapeAndSaveToSheet = scrapeAndSaveToSheet;
(globalThis as any).dailyBroadcastFromSheet = dailyBroadcastFromSheet;
(globalThis as any).testPushToMe = testPushToMe;
(globalThis as any).translateWithGemini = translateWithGemini;

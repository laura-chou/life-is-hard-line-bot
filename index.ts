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
        "text": "{{CHINESE_TEXT}}",
        "wrap": true,
        "size": "md",
        "color": "#1C1B1F",
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

interface FactResult {
  text: string; // Full text stored in Column A
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
 * Helper to execute an operation with auto-retry up to 16 attempts (interval 20000ms / 20 seconds)
 * to remain safely within Google Apps Script's 6-minute execution limit.
 */
function withRetry<T>(fn: () => T, maxAttempts: number = 16, delayMs: number = 20000): T {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`Attempt ${attempt}/${maxAttempts} failed: ${err?.message || err}`);
      if (attempt < maxAttempts) {
        Utilities.sleep(delayMs);
      }
    }
  }
  throw lastError;
}

/**
 * Scrapes facts from a single specified target URL.
 * Extracts all candidate items (<p class="list"> and <h2 class="list"> blocks) into full text format.
 */
function scrapeUrlFacts(targetUrl: string): FactResult[] {
  return withRetry(() => {
    console.log(`[Scraper] Fetching URL: ${targetUrl}`);

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
 * Function 1: Batch scrape target website URLs and save new facts into Google Sheet.
 * Schema: Column A (English Text), Column B (Image URL), Column C (Status), Column D (Sent Timestamp), Column E (Line Alert), Column F (Translate)
 */
function scrapeAndSaveToSheet(): void {
  console.log("=== Starting Batch Scrape & Save to Sheet ===");
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Create lookup set for existing Column A (English Text) values
  const existingTexts = new Set<string>();
  for (let i = 1; i < data.length; i++) {
    const text = data[i][0]; // Column A is English Text / Content
    if (text) {
      existingTexts.add(String(text).trim().toLowerCase());
    }
  }

  let totalNewAdded = 0;

  for (const targetUrl of factUrls) {
    try {
      const candidates = scrapeUrlFacts(targetUrl);
      console.log(`[Scraper] Found ${candidates.length} candidates from ${targetUrl}`);

      for (const item of candidates) {
        const normalizedText = item.text.trim().toLowerCase();

        if (!existingTexts.has(normalizedText)) {
          const imageUrlStr = item.imageUrl || "";

          // Append new row: Column A=English Text, B=Image URL, C=Status("PENDING"), D=Sent Timestamp(""), E=Line Alert(""), F=Translate(1)
          sheet.appendRow([item.text, imageUrlStr, "PENDING", "", "", 1]);
          existingTexts.add(normalizedText);
          totalNewAdded++;
        }
      }
    } catch (err: any) {
      console.warn(`[Scraper Error] Failed to scrape ${targetUrl}: ${err?.message || err}`);
    }
  }

  console.log(`=== Batch Scrape Finished. Added ${totalNewAdded} new facts to Google Sheet. ===`);
}

/**
 * Translates English fact text into Taiwan Traditional Chinese using Gemini API (gemini-3.8-flash) with retry logic.
 */
function translateWithGemini(englishText: string): string {
  return withRetry(() => {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY script property is not configured.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const prompt = `請將以下英文冷知識內容翻譯成台灣日常繁體中文，語氣要生動、吸引人且適合社群分享。只需輸出翻譯後的中文內容，不要附加任何解釋、標題或英文原文：\n\n${englishText}`;

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
  }, 16, 20000);
}

/**
 * Helper to construct the LINE Flex Message payload.
 */
function buildFlexMessagePayload(
  altText: string,
  chineseText: string,
  englishText?: string | null,
  imageUrl?: string | null
): object {
  const finalAltText = altText && altText.trim().length > 0 ? altText.trim() : "有一則新訊息";

  let flexObj: any;

  if (englishText && englishText.trim().length > 0) {
    const jsonStr = flexTemplateString
      .replace("{{CHINESE_TEXT}}", chineseText.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
      .replace("{{ENGLISH_TEXT}}", englishText.replace(/"/g, '\\"').replace(/\n/g, "\\n"));
    flexObj = JSON.parse(jsonStr);
  } else {
    flexObj = {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#FFFFFF",
        cornerRadius: "xl",
        paddingAll: "xxl",
        contents: [
          {
            type: "text",
            text: chineseText,
            wrap: true,
            size: "md",
            color: "#1C1B1F",
            lineSpacing: "10px"
          }
        ]
      }
    };
  }

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
    altText: finalAltText,
    contents: flexObj,
  };
}

/**
 * Function 2: Daily automated function to read the first 'PENDING' row from Google Sheet,
 * translate via Gemini if Column F requires it, broadcast via LINE Flex Message, and update Status to 'SENT'.
 */
function dailyBroadcastFromSheet(): void {
  console.log("=== Starting Daily Broadcast From Sheet ===");
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  let targetRowIndex = -1;
  let text = "";
  let imageUrl = "";
  let lineAlert = "";
  let shouldTranslate = true;

  // Find the first row where Column C === 'PENDING'
  for (let i = 1; i < data.length; i++) {
    const status = data[i][2]; // Column C is Status
    if (status && String(status).trim().toUpperCase() === "PENDING") {
      targetRowIndex = i + 1; // 1-based row index in Spreadsheet
      text = String(data[i][0] || "").trim(); // Column A
      imageUrl = String(data[i][1] || "").trim(); // Column B
      lineAlert = String(data[i][4] || "").trim(); // Column E

      const translateVal = data[i][5]; // Column F
      if (translateVal !== undefined && translateVal !== null && translateVal !== "") {
        const trStr = String(translateVal).trim().toLowerCase();
        shouldTranslate = trStr === "1" || trStr === "true" || translateVal === true || translateVal === 1;
      } else {
        shouldTranslate = true;
      }
      break;
    }
  }

  if (targetRowIndex === -1 || !text) {
    console.warn("⚠️ [Daily Broadcast Warning] No 'PENDING' fact records found in Google Sheet.");
    return;
  }

  console.log(`[Daily Broadcast] Processing Row ${targetRowIndex}: Content="${text.substring(0, 30)}..."`);

  const altText = lineAlert || "有一則新訊息";
  let chineseText = "";
  let englishText: string | null = null;

  if (shouldTranslate) {
    chineseText = translateWithGemini(text);
    englishText = text;
  } else {
    chineseText = text;
    englishText = null;
  }

  const flexMessage = buildFlexMessagePayload(altText, chineseText, englishText, imageUrl);

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

  // Update sheet: Column C -> 'SENT', Column D -> ISO Timestamp
  const nowTimestamp = new Date().toISOString();
  sheet.getRange(targetRowIndex, 3).setValue("SENT"); // Column C
  sheet.getRange(targetRowIndex, 4).setValue(nowTimestamp); // Column D

  console.log(`=== Daily Broadcast Successful! Updated Row ${targetRowIndex} Status to SENT at ${nowTimestamp} ===`);
}

/**
 * Developer test function to push the first 'PENDING' fact to MY_LINE_USER_ID
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

  let targetRowIndex = -1;
  let text = "";
  let imageUrl = "";
  let lineAlert = "";
  let shouldTranslate = true;

  // Find the first row where Column C === 'PENDING'
  for (let i = 1; i < data.length; i++) {
    const status = data[i][2]; // Column C is Status
    if (status && String(status).trim().toUpperCase() === "PENDING") {
      targetRowIndex = i + 1; // 1-based row index in Spreadsheet
      text = String(data[i][0] || "").trim(); // Column A
      imageUrl = String(data[i][1] || "").trim(); // Column B
      lineAlert = String(data[i][4] || "").trim(); // Column E

      const translateVal = data[i][5]; // Column F
      if (translateVal !== undefined && translateVal !== null && translateVal !== "") {
        const trStr = String(translateVal).trim().toLowerCase();
        shouldTranslate = trStr === "1" || trStr === "true" || translateVal === true || translateVal === 1;
      } else {
        shouldTranslate = true;
      }
      break;
    }
  }

  if (targetRowIndex === -1 || !text) {
    console.warn("⚠️ [Test Push Warning] No 'PENDING' fact records found in Google Sheet.");
    return;
  }

  console.log(`[Test Push] Processing Row ${targetRowIndex}: Content="${text.substring(0, 30)}..."`);

  const altText = lineAlert || "有一則新訊息";
  let chineseText = "";
  let englishText: string | null = null;

  if (shouldTranslate) {
    chineseText = translateWithGemini(text);
    englishText = text;
  } else {
    chineseText = text;
    englishText = null;
  }

  console.log("=== Test Push Console Log ===");
  console.log(`Row Index: ${targetRowIndex}`);
  console.log(`Line Alert (altText): ${altText}`);
  console.log(`Original Text: ${text}`);
  console.log(`Image URL: ${imageUrl || "None"}`);
  console.log(`Gemini Chinese Translation: ${chineseText}`);

  const flexMessage = buildFlexMessagePayload(altText, chineseText, englishText, imageUrl);

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

  // Update sheet: Column C -> 'SENT', Column D -> ISO Timestamp upon successful push
  const nowTimestamp = new Date().toISOString();
  sheet.getRange(targetRowIndex, 3).setValue("SENT"); // Column C
  sheet.getRange(targetRowIndex, 4).setValue(nowTimestamp); // Column D

  console.log(`=== Test Push Successful! Updated Row ${targetRowIndex} Status to SENT at ${nowTimestamp} ===`);
}

(globalThis as any).scrapeAndSaveToSheet = scrapeAndSaveToSheet;
(globalThis as any).dailyBroadcastFromSheet = dailyBroadcastFromSheet;
(globalThis as any).testPushToMe = testPushToMe;
(globalThis as any).translateWithGemini = translateWithGemini;

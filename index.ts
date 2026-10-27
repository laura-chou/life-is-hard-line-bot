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
        "text": "{{TEXT}}",
        "wrap": true,
        "size": "md",
        "color": "#1C1B1F",
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

interface PendingFact {
  rowIndex: number;
  text: string;
  imageUrl: string;
  lineAlert: string;
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
 */
function withRetry<T>(fn: () => T, maxAttempts: number = 3, delayMs: number = 5000): T {
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
 * Sends a plain text push notification to the developer (MY_LINE_USER_ID) for alerts/errors.
 */
function sendTextPushNotification(messageText: string): void {
  try {
    const props = PropertiesService.getScriptProperties();
    const userId = props.getProperty("MY_LINE_USER_ID");
    if (!userId) {
      console.warn("⚠️ [Push Alert Warning] MY_LINE_USER_ID is not configured.");
      return;
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
      console.warn("⚠️ [Push Alert Warning] No LINE_CHANNEL_ACCESS_TOKEN found.");
      return;
    }

    const pushUrl = "https://api.line.me/v2/bot/message/push";
    const response = UrlFetchApp.fetch(pushUrl, {
      method: "post",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      payload: JSON.stringify({
        to: userId,
        messages: [
          {
            type: "text",
            text: messageText,
          },
        ],
      }),
      muteHttpExceptions: true,
    });

    console.log(`[Text Push Alert API] Status Code: ${response.getResponseCode()}, Body: ${response.getContentText()}`);
  } catch (err: any) {
    console.error(`❌ Failed to send text push notification: ${err?.message || err}`);
  }
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
 * Modular helper function to collect all 'PENDING' records from the Google Sheet
 * and select one randomly. Returns null if no PENDING records are found.
 * Schema: Column A (Text), Column B (Image URL), Column C (Status), Column D (Sent Timestamp), Column E (Line Alert)
 */
function getRandomPendingFact(sheet: GoogleAppsScript.Spreadsheet.Sheet): PendingFact | null {
  const data = sheet.getDataRange().getValues();
  const pendingFacts: PendingFact[] = [];

  for (let i = 1; i < data.length; i++) {
    const status = data[i][2]; // Column C is Status
    if (status && String(status).trim().toUpperCase() === "PENDING") {
      const text = String(data[i][0] || "").trim(); // Column A
      if (!text) continue;

      const imageUrl = String(data[i][1] || "").trim(); // Column B
      const lineAlert = String(data[i][4] || "").trim(); // Column E

      pendingFacts.push({
        rowIndex: i + 1, // 1-based row index in Spreadsheet
        text,
        imageUrl,
        lineAlert,
      });
    }
  }

  if (pendingFacts.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * pendingFacts.length);
  return pendingFacts[randomIndex];
}

/**
 * Legacy alias maintained for backwards compatibility.
 */
function getFirstPendingFact(sheet: GoogleAppsScript.Spreadsheet.Sheet): PendingFact | null {
  return getRandomPendingFact(sheet);
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
 * Function 1: Batch scrape target website URLs and save new facts into Google Sheet.
 * Schema: Column A (Text), Column B (Image URL), Column C (Status), Column D (Sent Timestamp), Column E (Line Alert)
 */
function scrapeAndSaveToSheet(): void {
  console.log("=== Starting Batch Scrape & Save to Sheet ===");
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Create lookup set for existing Column A (Text) values
  const existingTexts = new Set<string>();
  for (let i = 1; i < data.length; i++) {
    const text = data[i][0]; // Column A is Text
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

          // Append new row: Column A=Text, B=Image URL, C=Status("PENDING"), D=Sent Timestamp(""), E=Line Alert("")
          sheet.appendRow([item.text, imageUrlStr, "PENDING", "", ""]);
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
 * Helper to construct the LINE Flex Message payload.
 */
function buildFlexMessagePayload(
  altText: string,
  text: string,
  imageUrl?: string | null
): object {
  const finalAltText = altText && altText.trim().length > 0 ? altText.trim() : "有一則新訊息";

  const jsonStr = flexTemplateString.replace(
    "{{TEXT}}",
    text.replace(/"/g, '\\"').replace(/\n/g, "\\n")
  );

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
    altText: finalAltText,
    contents: flexObj,
  };
}

/**
 * Function 2: Daily automated function to randomly select a 'PENDING' row from Google Sheet,
 * broadcast via LINE Flex Message, and update Status to 'SENT'.
 */
function dailyBroadcastFromSheet(): void {
  console.log("=== Starting Daily Broadcast From Sheet ===");
  const sheet = getSheet();
  const pendingFact = getRandomPendingFact(sheet);

  if (!pendingFact) {
    console.warn("⚠️ [Daily Broadcast Warning] No 'PENDING' fact records found in Google Sheet.");
    sendTextPushNotification("⚠️ [LINE Bot 提醒] Google 試算表中的所有內容狀態皆已為 SENT，目前已無 PENDING 資料可供發送，請盡快補充新內容！");
    return;
  }

  const { rowIndex, text, imageUrl, lineAlert } = pendingFact;

  console.log(`[Daily Broadcast] Processing Row ${rowIndex}: Content="${text.substring(0, 30)}..."`);

  const altText = lineAlert || "有一則新訊息";
  const flexMessage = buildFlexMessagePayload(altText, text, imageUrl);

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
  sheet.getRange(rowIndex, 3).setValue("SENT"); // Column C
  sheet.getRange(rowIndex, 4).setValue(nowTimestamp); // Column D

  console.log(`=== Daily Broadcast Successful! Updated Row ${rowIndex} Status to SENT at ${nowTimestamp} ===`);
}

/**
 * Developer test function to push a randomly selected 'PENDING' fact to MY_LINE_USER_ID
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
  const pendingFact = getRandomPendingFact(sheet);

  if (!pendingFact) {
    console.warn("⚠️ [Test Push Warning] No 'PENDING' fact records found in Google Sheet.");
    sendTextPushNotification("⚠️ [LINE Bot 提醒] Google 試算表中的所有內容狀態皆已為 SENT，目前已無 PENDING 資料可供發送，請盡快補充新內容！");
    return;
  }

  const { rowIndex, text, imageUrl, lineAlert } = pendingFact;

  console.log(`[Test Push] Processing Row ${rowIndex}: Content="${text.substring(0, 30)}..."`);

  const altText = lineAlert || "有一則新訊息";

  console.log("=== Test Push Console Log ===");
  console.log(`Row Index: ${rowIndex}`);
  console.log(`Line Alert (altText): ${altText}`);
  console.log(`Text Content: ${text}`);
  console.log(`Image URL: ${imageUrl || "None"}`);

  const flexMessage = buildFlexMessagePayload(altText, text, imageUrl);

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
  sheet.getRange(rowIndex, 3).setValue("SENT"); // Column C
  sheet.getRange(rowIndex, 4).setValue(nowTimestamp); // Column D

  console.log(`=== Test Push Successful! Updated Row ${rowIndex} Status to SENT at ${nowTimestamp} ===`);
}

(globalThis as any).scrapeAndSaveToSheet = scrapeAndSaveToSheet;
(globalThis as any).dailyBroadcastFromSheet = dailyBroadcastFromSheet;
(globalThis as any).testPushToMe = testPushToMe;
(globalThis as any).sendTextPushNotification = sendTextPushNotification;
(globalThis as any).getRandomPendingFact = getRandomPendingFact;
(globalThis as any).getFirstPendingFact = getFirstPendingFact;

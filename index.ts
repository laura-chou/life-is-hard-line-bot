const flexTemplateString = `{
  "type": "bubble",
  "size": "mega",
  "body": {
    "type": "box",
    "layout": "vertical",
    "backgroundColor": "#FFFFFF",
    "cornerRadius": "xl",
    "paddingAll": "xxl",
    "action": {
      "type": "uri",
      "label": "action",
      "uri": "https://www.thefactsite.com"
    },
    "contents": [
      {
        "type": "text",
        "text": "本日冷知識",
        "weight": "bold",
        "size": "xl",
        "align": "center",
        "color": "#1C1B1F"
      },
      {
        "type": "text",
        "text": "THE FACT SITE",
        "weight": "bold",
        "size": "sm",
        "align": "center",
        "color": "#0056C6",
        "margin": "xs"
      },
      {
        "type": "text",
        "text": "{{CHINESE_TEXT}}",
        "wrap": true,
        "size": "md",
        "color": "#1C1B1F",
        "margin": "lg",
        "lineSpacing": "md"
      },
      {
        "type": "text",
        "text": "{{ENGLISH_TEXT}}",
        "wrap": true,
        "size": "sm",
        "color": "#4A4A4A",
        "margin": "md",
        "lineSpacing": "xs"
      }
    ]
  }
}`;

const factUrls: string[] = [
  "https://www.thefactsite.com/fact-of-the-day/",
  "https://www.thefactsite.com/random-facts/",
  "https://www.thefactsite.com/100-space-facts/",
  "https://www.thefactsite.com/history-facts/",
  "https://www.thefactsite.com/animal-facts/",
  "https://www.thefactsite.com/technology-facts/",
  "https://www.thefactsite.com/food-facts/"
];

interface FactResult {
  text: string;
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
 */
function withRetry<T>(fn: () => T, maxAttempts: number = 3, initialDelayMs: number = 2000): T {
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
 * Scrapes a fact from a randomly selected Fact Site URL or fallback.
 * Supports dual structural parsing: <h2 class="list"> and <p class="list">.
 */
function fetchFact(useBackup: boolean = false): FactResult {
  return withRetry(() => {
    const selectedUrl = useBackup
      ? "https://www.thefactsite.com/random-facts/"
      : factUrls[Math.floor(Math.random() * factUrls.length)];

    console.log(`[Scraper] Selected Target URL: ${selectedUrl}`);

    const response = UrlFetchApp.fetch(selectedUrl, {
      muteHttpExceptions: true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      throw new Error(`HTTP Error ${statusCode} when fetching ${selectedUrl}`);
    }

    const html = response.getContentText();

    // 1. Structure A: <h2 class="list">...</h2> followed by <p>
    const h2Regex = /<h2\s+class="list"[^>]*>(.*?)<\/h2>([\s\S]*?)(?=<h2|<div class="entry-content"|$)/gi;
    let h2Match: RegExpExecArray | null;
    const h2Results: FactResult[] = [];

    while ((h2Match = h2Regex.exec(html)) !== null) {
      const titleRaw = h2Match[1];
      const title = cleanHtml(titleRaw);
      const afterChunk = h2Match[2];

      const pMatch = afterChunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      let pContent = "";
      let imageUrl: string | null = null;

      if (pMatch) {
        pContent = cleanHtml(pMatch[1]);
        const imgMatch = pMatch[1].match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i) ||
                         afterChunk.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          imageUrl = imgMatch[1];
        }
      }

      if (title.length > 5) {
        const fullText = pContent ? `${title} — ${pContent}` : title;
        h2Results.push({ text: fullText, imageUrl, targetUrl: selectedUrl });
      }
    }

    if (h2Results.length > 0) {
      const picked = h2Results[Math.floor(Math.random() * h2Results.length)];
      return picked;
    }

    // 2. Structure B: <p class="list">...
    const pListMatches = html.match(/<p\s+class="list"[^>]*>(.*?)<\/p>/gi);
    if (pListMatches && pListMatches.length > 0) {
      const randomIndex = Math.floor(Math.random() * Math.min(pListMatches.length, 10));
      const extractedText = cleanHtml(pListMatches[randomIndex]);
      if (extractedText.length > 10) {
        return { text: extractedText, imageUrl: null, targetUrl: selectedUrl };
      }
    }

    // 3. General Fallback
    const fallbackTitleMatch = html.match(/<h2 class="entry-title"[^>]*>(.*?)<\/h2>/i) ||
                               html.match(/<h1 class="entry-title"[^>]*>(.*?)<\/h1>/i);
    if (fallbackTitleMatch && fallbackTitleMatch[1]) {
      const text = cleanHtml(fallbackTitleMatch[1]);
      if (text.length > 10) {
        return { text, imageUrl: null, targetUrl: selectedUrl };
      }
    }

    const pMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi);
    if (pMatches) {
      for (const p of pMatches) {
        const cleaned = cleanHtml(p);
        if (cleaned.length > 20 && !cleaned.includes("Cookie") && !cleaned.includes("Copyright")) {
          return { text: cleaned, imageUrl: null, targetUrl: selectedUrl };
        }
      }
    }

    throw new Error(`Failed to parse fact from ${selectedUrl}`);
  });
}

/**
 * Checks Google Sheet for fact duplicates and optionally appends a new record.
 * Table structure: Row 1 = Headers, Row 2+ = [Timestamp, English Fact]
 */
function checkAndRecordFact(factText: string, readOnly: boolean): boolean {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID script property is not configured.");
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  const normalizedTarget = factText.trim().toLowerCase();
  let exists = false;

  for (let i = 1; i < data.length; i++) {
    const existingFact = data[i][1];
    if (existingFact && String(existingFact).trim().toLowerCase() === normalizedTarget) {
      exists = true;
      break;
    }
  }

  if (!readOnly && !exists) {
    const timestamp = new Date().toISOString();
    sheet.appendRow([timestamp, factText]);
  }

  return exists;
}

/**
 * Translates English fact text into Taiwan Traditional Chinese using Gemini API with retry logic.
 */
function translateWithGemini(englishText: string): string {
  return withRetry(() => {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY script property is not configured.");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const prompt = `請將以下英文冷知識翻譯成台灣日常繁體中文，語氣要生動、吸引人且適合社群分享。只需輸出翻譯後的中文內容，不要附加任何解釋或原文：\n\n${englishText}`;

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
 * Helper to construct the LINE Flex Message payload with dynamic Hero Image support.
 */
function buildFlexMessagePayload(chineseText: string, englishText: string, imageUrl?: string | null): object {
  const flexObj = JSON.parse(
    flexTemplateString
      .replace("{{CHINESE_TEXT}}", chineseText.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
      .replace("{{ENGLISH_TEXT}}", englishText.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
  );

  if (imageUrl && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"))) {
    flexObj.hero = {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectMode: "cover",
      aspectRatio: "20:13"
    };
  }

  return {
    type: "flex",
    altText: "本日冷知識",
    contents: flexObj,
  };
}

/**
 * Production automated function to fetch daily fact, translate, broadcast to all configured LINE Bots, and record to sheet.
 */
function fetchTranslateAndBroadcast(): void {
  let factData = fetchFact(false);
  let isDuplicate = checkAndRecordFact(factData.text, true);

  if (isDuplicate) {
    console.log("[Duplicate] Primary fact is duplicate. Fetching backup fact...");
    factData = fetchFact(true);
    isDuplicate = checkAndRecordFact(factData.text, true);
    if (isDuplicate) {
      console.warn("[Duplicate] Backup fact is also duplicate. Proceeding with current fact.");
    }
  }

  const chineseFact = translateWithGemini(factData.text);

  console.log("=== Execution Console Log ===");
  console.log(`Target URL: ${factData.targetUrl || "N/A"}`);
  console.log(`Original English Fact: ${factData.text}`);
  console.log(`Image URL: ${factData.imageUrl || "None"}`);
  console.log(`Gemini Chinese Translation: ${chineseFact}`);

  const flexMessage = buildFlexMessagePayload(chineseFact, factData.text, factData.imageUrl);

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

  checkAndRecordFact(factData.text, false);
}

/**
 * Developer test function to push flex message to MY_LINE_USER_ID for layout confirmation.
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
    if (key.startsWith("LINE_CHANNEL_ACCESS_TOKEN")) {
      token = allProps[key];
      break;
    }
  }

  if (!token) {
    throw new Error("No LINE_CHANNEL_ACCESS_TOKEN found in ScriptProperties.");
  }

  const factData = fetchFact(false);
  const chineseFact = translateWithGemini(factData.text);

  console.log("=== Test Push Console Log ===");
  console.log(`Target URL: ${factData.targetUrl || "N/A"}`);
  console.log(`Original English Fact: ${factData.text}`);
  console.log(`Image URL: ${factData.imageUrl || "None"}`);
  console.log(`Gemini Chinese Translation: ${chineseFact}`);

  const flexMessage = buildFlexMessagePayload(chineseFact, factData.text, factData.imageUrl);

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
}

(globalThis as any).fetchTranslateAndBroadcast = fetchTranslateAndBroadcast;
(globalThis as any).testPushToMe = testPushToMe;
(globalThis as any).fetchFact = fetchFact;
(globalThis as any).checkAndRecordFact = checkAndRecordFact;
(globalThis as any).translateWithGemini = translateWithGemini;

"use strict";
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
        "text": "{{TITLE}}",
        "weight": "bold",
        "size": "xl",
        "align": "center",
        "color": "#1C1B1F",
        "wrap": true
      },
      {
        "type": "text",
        "text": "THE FACT SITE",
        "weight": "bold",
        "size": "xs",
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
        "margin": "xl",
        "lineSpacing": "10px"
      },
      {
        "type": "text",
        "text": "{{ENGLISH_TEXT}}",
        "wrap": true,
        "size": "sm",
        "color": "#666666",
        "margin": "lg",
        "lineSpacing": "10px"
      }
    ]
  }
}`;
const BASE_DOMAIN = "https://www.thefactsite.com";
const factPaths = [
    "/1000-interesting-facts/",
    "/top-100-random-funny-facts/",
    "/100-space-facts/",
    "/100-halloween-facts/",
    "/100-random-food-facts/",
    "/facts-everyone-should-know/",
    "/dinosaur-facts/"
];
const factUrls = factPaths.map(path => `${BASE_DOMAIN}${path}`);
/**
 * Strips HTML tags and unescapes common HTML entities.
 */
function cleanHtml(html) {
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
function withRetry(fn, maxAttempts = 3, initialDelayMs = 2000) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return fn();
        }
        catch (err) {
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
 * Collects both <p class="list"> and <h2 class="list"> items into a unified candidate pool.
 * Smart footer paragraph break logic prevents picking up trailing noise.
 */
function fetchFact(useBackup = false) {
    return withRetry(() => {
        const selectedUrl = useBackup
            ? `${BASE_DOMAIN}/1000-interesting-facts/`
            : factUrls[Math.floor(Math.random() * factUrls.length)];
        console.log(`[Scraper] Selected Target URL: ${selectedUrl}`);
        const response = UrlFetchApp.fetch(selectedUrl, {
            muteHttpExceptions: true,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            },
        });
        const statusCode = response.getResponseCode();
        if (statusCode !== 200) {
            throw new Error(`HTTP Error ${statusCode} when fetching ${selectedUrl}`);
        }
        const html = response.getContentText();
        const allResults = [];
        // 1. Collect all <p class="list"> items (Representation 2)
        const pListRegex = /<p\s+class="list"[^>]*>([\s\S]*?)<\/p>/gi;
        let pListMatch;
        while ((pListMatch = pListRegex.exec(html)) !== null) {
            const rawPContent = pListMatch[1];
            const cleanedText = cleanHtml(rawPContent);
            if (cleanedText.length > 10) {
                let imageUrl = null;
                const imgMatch = rawPContent.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
                if (imgMatch && imgMatch[1]) {
                    imageUrl = imgMatch[1];
                }
                allResults.push({
                    title: "本日冷知識",
                    body: cleanedText,
                    text: cleanedText,
                    imageUrl: imageUrl,
                    targetUrl: selectedUrl,
                });
            }
        }
        // 2. Collect all <h2 class="list"> block items with strict boundary control and smart paragraph break logic
        const h2Regex = /<h2\s+class="list"[^>]*>(.*?)<\/h2>([\s\S]*?)(?=<h2\s+class="list"|$)/gi;
        let h2Match;
        while ((h2Match = h2Regex.exec(html)) !== null) {
            const titleRaw = h2Match[1];
            const title = cleanHtml(titleRaw);
            const chunkBody = h2Match[2];
            let imageUrl = null;
            const paragraphs = [];
            // Extract image URL strictly within this block
            const imgMatch = chunkBody.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
            if (imgMatch && imgMatch[1]) {
                imageUrl = imgMatch[1];
            }
            // Extract all valid text paragraphs strictly within this block, breaking instantly on &nbsp; or empty <p>
            const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
            let pMatch;
            while ((pMatch = pRegex.exec(chunkBody)) !== null) {
                const rawP = pMatch[1];
                const cleanedP = cleanHtml(rawP);
                // Smart footer break: stop collecting paragraphs if encountering empty or &nbsp; paragraph
                if (rawP.includes("&nbsp;") || cleanedP.length === 0) {
                    break;
                }
                if (cleanedP.length > 5 && !cleanedP.includes("Cookie") && !cleanedP.includes("Copyright")) {
                    paragraphs.push(cleanedP);
                }
            }
            if (title.length > 3) {
                const bodyContent = paragraphs.join("\n\n");
                const fullContent = bodyContent ? `${title}\n\n${bodyContent}` : title;
                allResults.push({
                    title,
                    body: bodyContent,
                    text: fullContent,
                    imageUrl,
                    targetUrl: selectedUrl,
                });
            }
        }
        // 3. Randomly select from unified candidate pool
        if (allResults.length > 0) {
            const picked = allResults[Math.floor(Math.random() * allResults.length)];
            return picked;
        }
        // 4. Fallback title parsing if candidate pool is empty
        const fallbackTitleMatch = html.match(/<h2 class="entry-title"[^>]*>(.*?)<\/h2>/i) ||
            html.match(/<h1 class="entry-title"[^>]*>(.*?)<\/h1>/i);
        if (fallbackTitleMatch && fallbackTitleMatch[1]) {
            const title = cleanHtml(fallbackTitleMatch[1]);
            if (title.length > 10) {
                return { title: "本日冷知識", body: title, text: title, imageUrl: null, targetUrl: selectedUrl };
            }
        }
        throw new Error(`Failed to parse fact candidate pool from ${selectedUrl}`);
    });
}
/**
 * Checks Google Sheet for fact duplicates and optionally appends a new record.
 * Table structure: Row 1 = Headers, Row 2+ = [English Fact, Timestamp]
 */
function checkAndRecordFact(factText, readOnly) {
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
        const existingFact = data[i][0]; // Column A is English Fact
        if (existingFact && String(existingFact).trim().toLowerCase() === normalizedTarget) {
            exists = true;
            break;
        }
    }
    if (!readOnly && !exists) {
        const timestamp = new Date().toISOString();
        sheet.appendRow([factText, timestamp]);
    }
    return exists;
}
/**
 * Translates English fact text into Taiwan Traditional Chinese JSON (title and text) using Gemini API (gemini-3.8-flash) with retry logic.
 */
function translateWithGemini(fact) {
    return withRetry(() => {
        const props = PropertiesService.getScriptProperties();
        const apiKey = props.getProperty("GEMINI_API_KEY");
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY script property is not configured.");
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
        const prompt = `請將以下英文冷知識翻譯成台灣日常繁體中文，語氣要生動、吸引人且適合社群分享。
請以嚴格 JSON 格式輸出，結構如下：
{
  "title": "繁體中文動態標題",
  "text": "繁體中文詳細內文"
}

英文冷知識標題：${fact.title}
英文冷知識內文：${fact.body || fact.text}`;
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
        const rawContent = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawContent) {
            throw new Error("Failed to parse response from Gemini API.");
        }
        try {
            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    title: parsed.title || fact.title || "本日冷知識",
                    text: parsed.text || rawContent.trim(),
                };
            }
        }
        catch (e) {
            console.warn("Failed to parse JSON from Gemini response, fallback to text format.", e);
        }
        return {
            title: fact.title !== "本日冷知識" ? fact.title : "本日冷知識",
            text: rawContent.trim(),
        };
    });
}
/**
 * Helper to construct the LINE Flex Message payload with dynamic title and Hero Image support.
 */
function buildFlexMessagePayload(chineseResult, englishText, imageUrl) {
    const jsonStr = flexTemplateString
        .replace("{{TITLE}}", chineseResult.title.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
        .replace("{{CHINESE_TEXT}}", chineseResult.text.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
        .replace("{{ENGLISH_TEXT}}", englishText.replace(/"/g, '\\"').replace(/\n/g, "\\n"));
    const flexObj = JSON.parse(jsonStr);
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
        altText: chineseResult.title || "本日冷知識",
        contents: flexObj,
    };
}
/**
 * Production automated function to fetch daily fact, translate, broadcast to all configured LINE Bots, and record to sheet.
 */
function fetchTranslateAndBroadcast() {
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
    const chineseResult = translateWithGemini(factData);
    console.log("=== Execution Console Log ===");
    console.log(`Target URL: ${factData.targetUrl || "N/A"}`);
    console.log(`Dynamic Title: ${chineseResult.title}`);
    console.log(`Original English Fact: ${factData.text}`);
    console.log(`Image URL: ${factData.imageUrl || "None"}`);
    console.log(`Gemini Chinese Translation: ${chineseResult.text}`);
    const flexMessage = buildFlexMessagePayload(chineseResult, factData.text, factData.imageUrl);
    const props = PropertiesService.getScriptProperties().getProperties();
    const tokens = [];
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
function testPushToMe() {
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
    const factData = fetchFact(false);
    const chineseResult = translateWithGemini(factData);
    console.log("=== Test Push Console Log ===");
    console.log(`Target URL: ${factData.targetUrl || "N/A"}`);
    console.log(`Dynamic Title: ${chineseResult.title}`);
    console.log(`Original English Fact: ${factData.text}`);
    console.log(`Image URL: ${factData.imageUrl || "None"}`);
    console.log(`Gemini Chinese Translation: ${chineseResult.text}`);
    const flexMessage = buildFlexMessagePayload(chineseResult, factData.text, factData.imageUrl);
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
globalThis.fetchTranslateAndBroadcast = fetchTranslateAndBroadcast;
globalThis.testPushToMe = testPushToMe;
globalThis.fetchFact = fetchFact;
globalThis.checkAndRecordFact = checkAndRecordFact;
globalThis.translateWithGemini = translateWithGemini;

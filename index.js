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
 * Scrapes a fact from The Fact Site.
 * @param useBackup - If false, scrapes the fact of the day / homepage; if true, scrapes random facts.
 */
function fetchFact(useBackup) {
    const url = useBackup
        ? "https://www.thefactsite.com/random-facts/"
        : "https://www.thefactsite.com/fact-of-the-day/";
    const response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        },
    });
    const html = response.getContentText();
    if (useBackup) {
        const matches = html.match(/<p class="list"[^>]*>(.*?)<\/p>/g) || html.match(/<p>(.*?)<\/p>/g);
        if (matches && matches.length > 0) {
            const randomIndex = Math.floor(Math.random() * Math.min(matches.length, 10));
            const extracted = cleanHtml(matches[randomIndex]);
            if (extracted.length > 10) {
                return extracted;
            }
        }
    }
    else {
        const match = html.match(/<h2 class="entry-title"[^>]*>(.*?)<\/h2>/i) ||
            html.match(/<h1 class="entry-title"[^>]*>(.*?)<\/h1>/i) ||
            html.match(/<p class="fact-text"[^>]*>(.*?)<\/p>/i);
        if (match && match[1]) {
            const extracted = cleanHtml(match[1]);
            if (extracted.length > 10) {
                return extracted;
            }
        }
    }
    const pMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi);
    if (pMatches) {
        for (const p of pMatches) {
            const cleaned = cleanHtml(p);
            if (cleaned.length > 20 && !cleaned.includes("Cookie") && !cleaned.includes("Copyright")) {
                return cleaned;
            }
        }
    }
    throw new Error(`Failed to fetch fact (useBackup: ${useBackup})`);
}
/**
 * Checks Google Sheet for fact duplicates and optionally appends a new record.
 * Table structure: Row 1 = Headers, Row 2+ = [Timestamp, English Fact]
 * @param factText - The English fact text to check/record.
 * @param readOnly - If true, only checks for duplicates without writing; if false, records if not existing.
 * @returns true if the fact already exists in spreadsheet; false if it's new.
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
    // Start from index 1 (Row 2 in sheet) to skip the header row
    for (let i = 1; i < data.length; i++) {
        const existingFact = data[i][1]; // Column B is English Fact
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
 * Translates English fact text into Taiwan Traditional Chinese using Gemini API.
 * @param englishText - The English fact text.
 */
function translateWithGemini(englishText) {
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
}
/**
 * Helper to construct the LINE Flex Message payload.
 */
function buildFlexMessagePayload(chineseText, englishText) {
    const jsonStr = flexTemplateString
        .replace("{{CHINESE_TEXT}}", chineseText.replace(/"/g, '\\"').replace(/\n/g, "\\n"))
        .replace("{{ENGLISH_TEXT}}", englishText.replace(/"/g, '\\"').replace(/\n/g, "\\n"));
    return {
        type: "flex",
        altText: "本日冷知識",
        contents: JSON.parse(jsonStr),
    };
}
/**
 * Production automated function to fetch daily fact, translate, broadcast to all configured LINE Bots, and record to sheet.
 */
function fetchTranslateAndBroadcast() {
    let fact = fetchFact(false);
    let isDuplicate = checkAndRecordFact(fact, true);
    if (isDuplicate) {
        console.log("Primary fact is duplicate. Fetching backup fact...");
        fact = fetchFact(true);
        isDuplicate = checkAndRecordFact(fact, true);
        if (isDuplicate) {
            console.warn("Backup fact is also duplicate. Proceeding with current fact.");
        }
    }
    const chineseFact = translateWithGemini(fact);
    const flexMessage = buildFlexMessagePayload(chineseFact, fact);
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
        console.log(`Broadcast response status: ${response.getResponseCode()}, body: ${response.getContentText()}`);
    }
    checkAndRecordFact(fact, false);
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
        if (key.startsWith("LINE_CHANNEL_ACCESS_TOKEN")) {
            token = allProps[key];
            break;
        }
    }
    if (!token) {
        throw new Error("No LINE_CHANNEL_ACCESS_TOKEN found in ScriptProperties.");
    }
    const fact = fetchFact(false);
    const chineseFact = translateWithGemini(fact);
    const flexMessage = buildFlexMessagePayload(chineseFact, fact);
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
    console.log(`Test Push response status: ${response.getResponseCode()}, body: ${response.getContentText()}`);
}
globalThis.fetchTranslateAndBroadcast = fetchTranslateAndBroadcast;
globalThis.testPushToMe = testPushToMe;
globalThis.fetchFact = fetchFact;
globalThis.checkAndRecordFact = checkAndRecordFact;
globalThis.translateWithGemini = translateWithGemini;

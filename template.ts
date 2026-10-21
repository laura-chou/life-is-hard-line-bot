export const flexTemplateString = `{
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

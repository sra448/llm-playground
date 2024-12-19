import fs from "fs";
import xml2js from "xml2js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const PROMPT = `
Extract the following details from the provided event listing:
- Title (verbatim)
- Date (in German format)
- Location (in German)
- Summary (about 200 words, in German)
- Category (from a predefined list)
- Tags (at least 15 descriptive keywords, in German)

Respond as a JSON object in this format:
{
  "title": "string",
  "date": "string",
  "location": "string",
  "summary": "string",
  "category": "string",
  "tags": ["string", "string", ...]
}

Here is the event listing:
`;

function parseSitemap() {
  const parser = new xml2js.Parser({ explicitArray: false });
  const xmlFilePath = "./sitemap.xml";
  const xmlContent = fs.readFileSync(xmlFilePath, "utf8");

  const hrefs = [];
  parser.parseString(xmlContent, (err, result) => {
    if (err) {
      throw new Error("Error parsing XML");
    }

    const urls = result.urlset.url;
    const urlEntries = Array.isArray(urls) ? urls : [urls];

    for (const urlEntry of urlEntries) {
      const links = urlEntry["xhtml:link"];
      if (links) {
        const linkEntries = Array.isArray(links) ? links : [links];

        for (const link of linkEntries) {
          if (link.$.hreflang === "de") {
            hrefs.push(link.$.href);
          }
        }
      }
    }
  });

  return hrefs;
}

function extractText(html) {
  const strippedHtml = html.replace(/style\s*=\s*(['"])[^'"]*?\1/gi, "");
  const dom = new JSDOM(strippedHtml);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return article ? article.textContent : null;
}

async function analyseWithLlm(prompt) {
  const response = await fetch(process.env.OLLAMA_URL + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama3.2", prompt }),
  });

  if (!response.body) throw new Error("No response body");

  let completeResponse = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true }).trim();
    const parsedChunk = JSON.parse(chunk);
    if (parsedChunk.response) {
      completeResponse += parsedChunk.response;
    }
  }

  console.log("🔮  Complete response:", completeResponse);
  const jsonMatch = completeResponse.match(/{[\s\S]*}/);
  return JSON.parse(jsonMatch[0]);
}

console.log(`☘️ Starting, good luck\n`);
console.log("🔍 Parsing sitemap");

let urls = [];
try {
  urls = parseSitemap();
  console.log("🌐 Found " + urls.length + " urls to play around with");
} catch (error) {
  console.error(`💥 Error:`, error.message, JSON.stringify(error));
}

for (const url of urls.slice(0, 5)) {
  console.time("⏲︎ Processed in");

  try {
    console.log(`\n🚀 ${url}`);
    const response = await fetch(url);
    const html = await response.text();

    console.log("🔬 Extracting readable text");
    const readableText = extractText(html);

    console.log("💭 Analyzing with llama-3.2");
    const llmResponse = await analyseWithLlm(`${PROMPT}\n${readableText}`);

    console.log(`🔮 LLM Response for ${url}:`, llmResponse);
  } catch (error) {
    console.error(`💥 Error:`, error.message, JSON.stringify(error));
  }

  console.timeEnd("⏲︎ Processed in");
}

console.log(`🍻  Done`);

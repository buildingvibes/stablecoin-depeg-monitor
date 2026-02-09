import { readFile, writeFile } from "fs/promises"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const MODEL_ENDPOINT = "https://models.inference.ai.azure.com"
const MODEL_NAME = "gpt-4o-mini"

/**
 * Generate AI risk analysis using GitHub Models
 */
async function generateAnalysis(data) {
  if (!GITHUB_TOKEN) {
    console.log("GITHUB_TOKEN not set, skipping AI analysis")
    return null
  }

  const { stablecoins, events } = data

  const priceContext = stablecoins.map(s =>
    `${s.symbol}: $${s.price} (${s.deviation > 0 ? '+' : ''}${s.deviation}% from peg), ` +
    `risk: ${s.riskLevel} (${s.riskScore}/100), 7d max deviation: ${s.maxDeviation7d}%, ` +
    `market cap: $${(s.marketCap / 1e9).toFixed(2)}B, 24h volume: $${(s.volume24h / 1e9).toFixed(2)}B`
  ).join("\n")

  const eventContext = events.slice(0, 15).map(e =>
    `[${e.timestamp}] ${e.category || 'general'}: ${e.eventSummary?.substring(0, 200)}`
  ).join("\n\n")

  const prompt = `You are a stablecoin risk analyst. Based on the following real-time data, provide a concise weekly risk briefing.

CURRENT STABLECOIN PRICES AND RISK SCORES:
${priceContext}

RECENT EVENTS (last 7 days):
${eventContext || "No stablecoin-specific events detected this week."}

Generate a brief (3-4 paragraphs) risk analysis covering:
1. Overall stablecoin market health summary
2. Any notable depegging risks or price deviations
3. Key events or regulatory developments affecting stablecoins
4. Outlook and risk factors to watch

Keep the tone professional and data-driven. Reference specific numbers and coins. If there are no concerning events, note the market stability.`

  console.log("Generating AI risk analysis via GitHub Models...")

  try {
    const response = await fetch(`${MODEL_ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GITHUB_TOKEN}`
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: "You are a professional cryptocurrency risk analyst specializing in stablecoin stability monitoring. Provide concise, data-driven analysis." },
          { role: "user", content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.log(`GitHub Models API returned ${response.status}: ${errText}`)
      return null
    }

    const result = await response.json()
    const analysis = result.choices?.[0]?.message?.content

    if (analysis) {
      console.log("AI analysis generated successfully")
      return analysis
    }
  } catch (err) {
    console.log(`AI analysis error: ${err.message}`)
  }

  return null
}

/**
 * Main analysis process
 */
async function runAnalysis() {
  try {
    const raw = await readFile("data/events.json", "utf-8")
    const data = JSON.parse(raw)

    const analysis = await generateAnalysis(data)

    if (analysis) {
      data.aiAnalysis = {
        generatedAt: new Date().toISOString(),
        model: MODEL_NAME,
        content: analysis
      }

      await writeFile("data/events.json", JSON.stringify(data, null, 2))
      console.log("Analysis saved to data/events.json")
    }
  } catch (error) {
    console.error("Analysis failed:", error.message)
    // Non-fatal: we still have the data even without AI analysis
  }
}

runAnalysis()

import { writeFile, mkdir, readFile } from "fs/promises"

const CPW_API_URL = "https://cpw-tracker.p.rapidapi.com/"
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const COINGECKO_URL = "https://api.coingecko.com/api/v3"

// Stablecoins to monitor with their CoinGecko IDs
const STABLECOINS = [
  { id: "tether", symbol: "USDT", name: "Tether", peg: 1.0 },
  { id: "usd-coin", symbol: "USDC", name: "USD Coin", peg: 1.0 },
  { id: "dai", symbol: "DAI", name: "Dai", peg: 1.0 },
  { id: "first-digital-usd", symbol: "FDUSD", name: "First Digital USD", peg: 1.0 },
  { id: "frax", symbol: "FRAX", name: "Frax", peg: 1.0 },
  { id: "true-usd", symbol: "TUSD", name: "TrueUSD", peg: 1.0 },
  { id: "paypal-usd", symbol: "PYUSD", name: "PayPal USD", peg: 1.0 },
  { id: "ethena-usde", symbol: "USDe", name: "Ethena USDe", peg: 1.0 },
  { id: "usdd", symbol: "USDD", name: "USDD", peg: 1.0 },
  { id: "gemini-dollar", symbol: "GUSD", name: "Gemini Dollar", peg: 1.0 }
]

/**
 * Get start and end dates for CPW data fetch (7-day window)
 */
function getDateRange() {
  const now = new Date()
  const endTime = now
  const startTime = new Date(now)
  startTime.setDate(startTime.getDate() - 7)
  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString()
  }
}

/**
 * Fetch stablecoin-related events from CPW Tracker API
 */
async function fetchStablecoinEvents() {
  if (!RAPIDAPI_KEY) {
    console.log("RAPIDAPI_KEY not set, skipping CPW API fetch")
    return []
  }

  const { startTime, endTime } = getDateRange()
  console.log(`Fetching stablecoin events: ${startTime} to ${endTime}`)

  const queries = [
    { entities: "stablecoins", topic: "depeg" },
    { entities: "stablecoins", topic: "reserve" },
    { entities: "Tether, USDC, DAI, FDUSD", topic: "regulation" },
    { entities: "stablecoins", topic: "cyberattack" }
  ]

  const allEvents = []

  for (const query of queries) {
    try {
      const response = await fetch(CPW_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-host": "cpw-tracker.p.rapidapi.com",
          "x-rapidapi-key": RAPIDAPI_KEY,
        },
        body: JSON.stringify({ ...query, startTime, endTime }),
      })

      if (response.ok) {
        const data = await response.json()
        const results = Array.isArray(data) ? data : []
        console.log(`  ${query.topic}: ${results.length} events`)
        allEvents.push(...results.map(e => ({ ...e, category: query.topic })))
      } else {
        console.log(`  ${query.topic}: API returned ${response.status}`)
      }
    } catch (err) {
      console.log(`  ${query.topic}: fetch error - ${err.message}`)
    }

    // Rate limiting courtesy
    await new Promise(r => setTimeout(r, 500))
  }

  return allEvents
}

/**
 * Fetch current stablecoin price data from CoinGecko
 */
async function fetchPriceData() {
  const ids = STABLECOINS.map(s => s.id).join(",")
  const url = `${COINGECKO_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`

  console.log("Fetching stablecoin prices from CoinGecko...")

  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.log(`CoinGecko price API returned ${response.status}`)
      return []
    }
    const data = await response.json()

    return STABLECOINS.map(coin => {
      const priceData = data[coin.id]
      if (!priceData) return null

      const price = priceData.usd || 0
      const deviation = ((price - coin.peg) / coin.peg) * 100

      return {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        price: price,
        peg: coin.peg,
        deviation: Math.round(deviation * 10000) / 10000,
        marketCap: priceData.usd_market_cap || 0,
        volume24h: priceData.usd_24h_vol || 0,
        change24h: priceData.usd_24h_change || 0,
        fetchedAt: new Date().toISOString()
      }
    }).filter(Boolean)
  } catch (err) {
    console.log(`CoinGecko fetch error: ${err.message}`)
    return []
  }
}

/**
 * Fetch 7-day price history for each stablecoin
 */
async function fetchPriceHistory() {
  console.log("Fetching 7-day price history...")
  const histories = {}

  for (const coin of STABLECOINS) {
    try {
      const url = `${COINGECKO_URL}/coins/${coin.id}/market_chart?vs_currency=usd&days=7`
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        histories[coin.symbol] = (data.prices || []).map(([timestamp, price]) => ({
          timestamp: new Date(timestamp).toISOString(),
          price: price
        }))
        console.log(`  ${coin.symbol}: ${histories[coin.symbol].length} data points`)
      } else {
        console.log(`  ${coin.symbol}: API returned ${response.status}`)
      }
    } catch (err) {
      console.log(`  ${coin.symbol}: fetch error - ${err.message}`)
    }

    // Rate limiting for CoinGecko free tier
    await new Promise(r => setTimeout(r, 1500))
  }

  return histories
}

/**
 * Calculate risk scores based on price data
 */
function calculateRiskScores(prices, histories) {
  return prices.map(coin => {
    const history = histories[coin.symbol] || []
    let volatility = 0
    let maxDeviation = Math.abs(coin.deviation)

    if (history.length > 1) {
      // Calculate max deviation from peg in the last 7 days
      const deviations = history.map(h => Math.abs(((h.price - coin.peg) / coin.peg) * 100))
      maxDeviation = Math.max(...deviations)

      // Calculate volatility (std dev of price changes)
      const returns = []
      for (let i = 1; i < history.length; i++) {
        returns.push((history[i].price - history[i - 1].price) / history[i - 1].price)
      }
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
      volatility = Math.sqrt(variance) * 100
    }

    // Risk score: 0-100 based on deviation, volatility, and market cap
    const deviationScore = Math.min(maxDeviation * 20, 40)
    const volatilityScore = Math.min(volatility * 500, 30)
    const capScore = coin.marketCap < 100_000_000 ? 30 :
                     coin.marketCap < 1_000_000_000 ? 20 :
                     coin.marketCap < 10_000_000_000 ? 10 : 0
    const riskScore = Math.round(Math.min(deviationScore + volatilityScore + capScore, 100))

    let riskLevel = "LOW"
    if (riskScore >= 60) riskLevel = "CRITICAL"
    else if (riskScore >= 40) riskLevel = "HIGH"
    else if (riskScore >= 20) riskLevel = "MEDIUM"

    return {
      ...coin,
      volatility7d: Math.round(volatility * 10000) / 10000,
      maxDeviation7d: Math.round(maxDeviation * 10000) / 10000,
      riskScore,
      riskLevel
    }
  })
}

/**
 * Save all data to JSON files
 */
async function saveData(events, prices, histories) {
  await mkdir("data", { recursive: true })

  // Sort events by timestamp
  const sortedEvents = events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  // Deduplicate events by summary similarity
  const seen = new Set()
  const uniqueEvents = sortedEvents.filter(e => {
    const key = e.eventSummary?.substring(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const output = {
    lastUpdated: new Date().toISOString(),
    stablecoins: prices,
    events: uniqueEvents,
    priceHistory: histories
  }

  await writeFile("data/events.json", JSON.stringify(output, null, 2))
  console.log(`\nSaved: ${prices.length} stablecoins, ${uniqueEvents.length} events`)
}

/**
 * Main update process
 */
async function updateData() {
  try {
    console.log("=== Stablecoin Depeg Monitor - Data Update ===\n")

    // Fetch from all sources in parallel where possible
    const [events, prices] = await Promise.all([
      fetchStablecoinEvents(),
      fetchPriceData()
    ])

    // Fetch price history (sequential due to rate limiting)
    const histories = await fetchPriceHistory()

    // Calculate risk scores
    const scoredPrices = calculateRiskScores(prices, histories)

    // Save everything
    await saveData(events, scoredPrices, histories)

    console.log("Update completed successfully")
  } catch (error) {
    console.error("Update failed:", error.message)
    process.exit(1)
  }
}

updateData()

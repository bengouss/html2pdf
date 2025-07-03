import chromium from "@sparticuz/chromium"
import puppeteer, { Browser, HTTPRequest, Page } from "puppeteer-core"
import fs from "fs"
import crypto from "crypto"

const CACHE_HOURS = parseInt(process.env.CACHE_HOURS || "2")
const TIMEOUT_SEC = parseInt(process.env.TIMEOUT_SEC || "120")
const USER_AGENT = process.env.USER_AGENT || 'html2pdf/lambda'

let browser:Browser | null = null

const waitTillHTMLRendered = async (
  page:Page,
  timeout = 30000,
) => {
  const checkDurationMsecs = 1000
  const maxChecks = timeout / checkDurationMsecs
  let lastHTMLSize = 0
  let checkCounts = 1
  let countStableSizeIterations = 0
  const minStableSizeIterations = 3

  while (checkCounts++ <= maxChecks) {
    let html = await page.content()
    let currentHTMLSize = html.length

    let bodyHTMLSize = await page.evaluate(
      () => document.body.innerHTML.length + document.head.innerHTML.length
    )

    console.log(
      "last: ",
      lastHTMLSize,
      " <> curr: ",
      currentHTMLSize,
      " body html size: ",
      bodyHTMLSize
    )

    if (lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize)
      countStableSizeIterations++
    else countStableSizeIterations = 0 //reset the counter

    if (countStableSizeIterations >= minStableSizeIterations) {
      console.log(`Page rendered fully with timeout ${timeout}`)
      break
    }

    lastHTMLSize = currentHTMLSize
    await page.waitForTimeout(checkDurationMsecs)
  }
}

const waitForExpressionInDOM = async (
  page:Page,
  expression:string,
  timeout = 30000,
) => {
  const checkDurationMsecs = 1000
  const maxChecks = timeout / checkDurationMsecs
  let checkCounts = 1

  while (checkCounts++ <= maxChecks) {
    const html = await page.content()
    if(html.includes(expression)) {
      console.log(`Page rendered fully with timeout ${timeout}`)
      break
    }

    console.log(`Waiting for expression "${expression}" to be present in the page content...`)
    await page.waitForTimeout(checkDurationMsecs)
  }
}

const getBrowser = async (chromiumBin?:string, deflate = true, chromiumBinPath = `${__dirname}/node_modules/@sparticuz/chromium/bin`) => {
if (!browser) {
    const executablePath = deflate && !chromiumBin ? await chromium.executablePath(chromiumBinPath) : chromiumBin
    const params = {
      // headless: "new",
      // args: ['--no-sandbox']
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: "new" as const, //chromium.headless,
      ignoreHTTPSErrors: true,
      dumpio: true,
    }
    console.log("+++++++++++ Starting Puppeteer browser", executablePath, params)
    browser = await puppeteer.launch(params).catch(err => {
      console.log("ERROR STARTING PUPETEER", err)
      throw {code: 500}
    })
    console.log("+++++++++++ Puppeteer browser started")
  }
  return browser
}

const renderHTML = async (
  url:string,
  interceptRequestURL?:string,
  waitForExpression?:string,
  timeoutMs = 30000,
  cache = false,
  cacheQuery = false,
  closePage = true,
  chromiumBin?:string,
  chromiumBinDeflate = true
):Promise<{
  code: number,
  headers: Record<string, string>,
  body?: string,
  exp: number,
  page: Page
}> => {
  const nurl = cacheQuery ? url : url.split("?")[0]

  let md5:string | undefined = undefined
  if(cache) {
    md5 = crypto.createHash("md5").update(nurl).digest("hex")
    console.log("+++++++++++ Caching enabled, checking for cached response", md5)
    if (fs.existsSync(`/tmp/${md5}.json`) && !interceptRequestURL) {
      const dd = JSON.parse(await fs.promises.readFile(`/tmp/${md5}.json`, "utf8"))
      if (!dd.exp || dd.exp < Date.now()) {
        // DO NOTHING
      } else return dd
    }
  }

  browser = await getBrowser(chromiumBin, chromiumBinDeflate)
  const page = await browser.newPage()
  console.log("+++++++++++ New Puppeteer page created", nurl)
  try {
    page.setUserAgent(USER_AGENT)
    page.setDefaultNavigationTimeout(TIMEOUT_SEC * 1000)

    let request:HTTPRequest | undefined = undefined
    if (interceptRequestURL) {
      // Intercept requests
      await page.setRequestInterception(true)
      page.on("request", (interceptedRequest) => {
        if (interceptedRequest.isInterceptResolutionHandled()) return
        if (interceptedRequest.url().indexOf(interceptRequestURL) >= 0) {
          request = interceptedRequest
        }
        interceptedRequest.continue()
      })
    }

    // Navigate the page to a URL
    const response = await page.goto(nurl, { waitUntil: "load" })
    if(!response) throw new Error("No response from page.goto")
    if (!interceptRequestURL) {
      const code = response.status()
      if(waitForExpression) {
        await waitForExpressionInDOM(page, waitForExpression, timeoutMs)
      } else {
        await waitTillHTMLRendered(page, timeoutMs)
      }

      const headers = response.headers()
      const body = await page.evaluate(
        () => document.querySelector("*")?.outerHTML
      )
      if(closePage) await page.close()
      const r = {
        code,
        headers,
        body,
        exp: Date.now() + CACHE_HOURS * 3600 * 1000,
        page
      }
      if(cache && md5) await fs.promises.writeFile(`/tmp/${md5}.json`, JSON.stringify(r))
      return r
    } else {
      if(!request) throw new Error("No request intercepted")
      const response = (request as HTTPRequest).response()
      const code = response?.status() || 400
      const headers = response?.headers() || {}
      const body = (await response?.json()) || "Bad Request"
      if(closePage) await page.close()
      const r = {
        code,
        headers,
        body,
        exp: Date.now() + CACHE_HOURS * 3600 * 1000,
        page
      }
      return r
    }
  } catch (err) {
    console.log(err)
    await page.close()
    throw err
  }
}

const renderPDF = async (
  url:string,
  uuid = `${crypto.randomUUID()}`,
  interceptRequestURL?:string,
  waitForExpression?:string,
  timeoutMs = 30000,
  cache = false,
  query = false,
  chromiumBin?:string,
  chromiumBinDeflate = true
) => {
  const rr = await renderHTML(
    url,
    interceptRequestURL,
    waitForExpression,
    timeoutMs,
    cache,
    query,
    false,
    chromiumBin,
    chromiumBinDeflate
  )
  await rr.page.pdf({
    path: `/tmp/${uuid}.pdf`,
  });
  await rr.page.close()
  return fs.promises.readFile(`/tmp/${uuid}.pdf`)
}

export default {
  renderHTML,
  renderPDF
}

import chromium from "@sparticuz/chromium"
import puppeteer, { Browser, HTTPRequest, Page } from "puppeteer-core"
import fs from "fs"
import crypto from "crypto"

const CACHE_HOURS = parseInt(process.env.CACHE_HOURS || "2")
const TIMEOUT_SEC = parseInt(process.env.TIMEOUT_SEC || "120")
const USER_AGENT = process.env.USER_AGENT || 'html2pdf/lambda'

const defaultFooterTemplate = `<html>
  <head>
    <style>
      .footer-container {
        padding: 0.25cm 1cm;
        position: relative;
        width: 100%;
      }
      .page-numbers {
        font-size: 0.25cm;
        float: right;
        position: relative;
        text-align: right;
        top: 0.25cm;
        white-space: nowrap;
      }
      .footer-logo-container {
        float: left;
      }
      .footer-logo-container img {
        display: block;
        max-height: 0.7cm;
        max-width: 2.3cm;
      }
    </style>
  </head>
  <body class="body--footer" style="font-size:14px !important;">
    <div class="footer-container">
      <div class="page-numbers">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>
    </div>
  </body>
</html>`

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
    await new Promise(r => setTimeout(r, checkDurationMsecs))
  }
  await new Promise(r => setTimeout(r, checkDurationMsecs))
}

const waitForJSExpression = async (
  page:Page,
  expression:string,
  timeout = 30000,
) => {
  const checkDurationMsecs = 1000
  const maxChecks = timeout / checkDurationMsecs
  let checkCounts = 1

  while (checkCounts++ <= maxChecks) {
    const res = await page.evaluate(expression)
    if (res) {
      console.log(`Expression "${expression}" is defined`)
      break
    }
    console.log(`Waiting for expression "${expression}" to be defined...`)
    await new Promise(r => setTimeout(r, checkDurationMsecs))
  }
  await new Promise(r => setTimeout(r, checkDurationMsecs))
}

const getBrowser = async (chromiumBin?:string, deflate = true, chromiumBinPath = `${__dirname}/node_modules/@sparticuz/chromium/bin`) => {
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
  return browser
}

type RenderHTMLResponse = {
  code: number,
  headers: Record<string, string>,
  body?: string,
  exp: number,
  page: Page
}

const renderHTML = async (
  url:string,
  uuid = `${crypto.randomUUID()}`,
  interceptRequestURL?:string,
  waitForExpression?:string,
  timeoutMs = 30000,
  cache = false,
  query = true,
  closePage = true,
  chromiumBin?:string,
  chromiumBinDeflate = true,
  cookies:Record<string, string> = {}
):Promise<RenderHTMLResponse> => {
  const nurl = query ? url : url.split("?")[0]

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
  Object.entries(cookies).forEach(([name, value]) => {
    const c:Parameters<typeof page.setCookie>[0] = {
      name,
      value,
      domain: new URL(url).hostname,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    }
    console.log("+++++++++++ Setting cookie", JSON.stringify(c))
    page.setCookie(c)
  })
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

    page.on("dialog", dialog => {
      console.log("+++++++++++ Dialog detected:", dialog.message())
      dialog.accept()
    })

    // Navigate the page to a URL
    const response = await page.goto(nurl, { waitUntil: "load" })
    if(!response) throw new Error("No response from page.goto")
    let r:RenderHTMLResponse
    if (!interceptRequestURL) {
      const code = response.status()
      if(waitForExpression) {
        await waitForJSExpression(page, waitForExpression, timeoutMs)
      } else {
        await waitTillHTMLRendered(page, timeoutMs)
      }
      console.log("+++++++++++ Page rendered fully with status code", code)
      const headers = response.headers()
      // console.log("+++++++++++ Page headers", JSON.stringify(headers))
      
      const body = await page.evaluate(
        () => document.querySelector("html")?.innerHTML
      )
      console.log("+++++++++++ Page content retrieved, size:", body?.length || 0)
      if(closePage) await page.close()
      r = {
        code,
        headers,
        body,
        exp: Date.now() + CACHE_HOURS * 3600 * 1000,
        page
      }
      if(cache && md5) await fs.promises.writeFile(`/tmp/${md5}.json`, JSON.stringify(r))
    } else {
      if(!request) throw new Error("No request intercepted")
      const response = (request as HTTPRequest).response()
      const code = response?.status() || 400
      const headers = response?.headers() || {}
      const body = (await response?.json()) || "Bad Request"
      if(closePage) await page.close()
      r = {
        code,
        headers,
        body,
        exp: Date.now() + CACHE_HOURS * 3600 * 1000,
        page
      }
    }
    if(r.body) await fs.promises.writeFile(`/tmp/${uuid}.html`, r.body)
    return r
  } catch (err) {
    console.log(err)
    await page.close()
    throw err
  }
}

const renderPDF = async ({
  url,
  uuid = `${crypto.randomUUID()}`,
  interceptRequestURL,
  waitForExpression,
  timeoutMs = 30000,
  cache = false,
  query = true,
  chromiumBin,
  chromiumBinDeflate = true,
  cookies = {},
  emulatedMediaType = 'screen',
  marginTop = '10mm',
  marginBottom = '20mm',
  marginLeft = '10mm',
  marginRight = '10mm',
  paperHeight = '210mm',
  paperWidth = '297mm',
  headerTemplate = "<div></div>",
  footerTemplate = defaultFooterTemplate
}:{
  url:string,
  uuid?:string,
  interceptRequestURL?:string,
  waitForExpression?:string,
  timeoutMs?:number,
  cache?:boolean,
  query?:boolean,
  chromiumBin?:string,
  chromiumBinDeflate?:boolean,
  cookies?:Record<string, string>,
  emulatedMediaType?:string,
  marginTop?:string,
  marginBottom?:string,
  marginLeft?:string,
  marginRight?:string,
  paperHeight?:string,
  paperWidth?:string,
  headerTemplate?:string
  footerTemplate?:string
}) => {
  const rr = await renderHTML(
    url,
    uuid,
    interceptRequestURL,
    waitForExpression,
    timeoutMs,
    cache,
    query,
    false,
    chromiumBin,
    chromiumBinDeflate,
    cookies
  )
  console.log("+++++++++++ HTML rendered for", url, "with UUID", uuid)
  if(emulatedMediaType) await rr.page.emulateMediaType(emulatedMediaType);
  await rr.page.pdf({
    path: `/tmp/${uuid}.pdf`,
    // landscape: true,
    // paper size must be set explicitly otherwise we end up with white borders on the top/bottom of the page
    height: paperHeight,
    width: paperWidth,
    timeout: 120000,
    printBackground: true,
    margin: {
      top: marginTop,
      bottom: marginBottom,
      left: marginLeft,
      right: marginRight,
    },
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    // format: 'A4',
  });
  await new Promise(r => setTimeout(r, 1000)) // wait for the file to be written
  console.log("+++++++++++ PDF generated for", url, "with UUID", uuid)
  rr.page.close().then(() => browser?.close()).then(() => {
    console.log("+++++++++++ Puppeteer page and browser closed")
  })
  console.log(`+++++++++++ Writing file to /tmp/${uuid}.pdf`)
  return fs.promises.readFile(`/tmp/${uuid}.pdf`)
}

export default {
  renderHTML,
  renderPDF
}

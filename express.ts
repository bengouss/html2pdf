import express from "express"
import fn from "./puppeteer"

const app = express()
const port = process.env.PORT || 3000
const chromiumBin = process.env.CHROMIUM_BIN

console.log("Using Chromium binary:", chromiumBin)

app.get('/', (req, res) => {
  if(req.query.url){
    console.log(new Date().toISOString(), req.query.url)
    fn.renderPDF({
      url: req.query.url as string,
      uuid: crypto.randomUUID(),
      timeoutMs: parseInt(req.query.timeout as string) || 40000,
      cache: req.query.cache !== "false",
      query: req.query.query === "true",
      chromiumBin,
    })
    .then(data => {
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${req.query.filename || 'output.pdf'}"`,
        "Content-Length": data.length.toString(),
      }).status(200).send(data)
    })
    .catch(err => {
      console.log(err)
      res.status(err.code || 500).send(err.message)
    })
  } else {
    res.status(400).send("Bad Request")
  }
})

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})

process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());
process.on("SIGQUIT", () => process.exit());
import fs from "fs"

const report = "2d2919a0-879f-4cf7-b768-e02d56fa9e64"
const puppeteer_token="eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiYWNhMjcxZDUtMjA3ZC00ZmZjLWEzNTMtNWI3MDc1YTUwODhiIiwicHVwcGV0ZWVyIjp0cnVlLCJleHAiOjE3NTI4NzcyNzl9.UP7Q_yfHDmPfDeE4EYbk96YE2-EmKYnDZ1lJ3Qzju5w"

const uurl = "https://www.google.com"// "https://client.staging.abbove.com/beta/reports/2d2919a0-879f-4cf7-b768-e02d56fa9e64/print?covers=placeholder&hidden_section_id&puppeteer_token=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiYWNhMjcxZDUtMjA3ZC00ZmZjLWEzNTMtNWI3MDc1YTUwODhiIiwicHVwcGV0ZWVyIjp0cnVlLCJleHAiOjE3NTMxNjE5MTV9.Fr0RucOhhgDAglS24Li91NPScWh60LoXa7RbZFCbEcU&toc=true"

fetch('http://localhost:9000/2015-03-31/functions/function/invocations', {
    method: 'POST',
    body: JSON.stringify({
        queryStringParameters: {
            jpegQuality: 70,
            // compress: "false",
        },
        requestContext: {
            http: {
                method: 'POST'
            }
        },
        body: JSON.stringify({
            url: uurl,
            // waitForExpression: "!!document.querySelector('.finished_rendering')",
            producer: "html2pdf test",
            creator: "Abbove PDF",
        })
    }),
    headers: {
        'Content-Type': 'application/json',
    }
})
.then(response => {
    console.log("Response status:", response.status);
    return response.json() as Promise<{
        statusCode: number,
        body: string,
        headers: Record<string, string>,
        isBase64Encoded: boolean
    }>
})
.then(data => {
    console.log("Response data:", data);
    if(data.isBase64Encoded) {
        // convert base64 to buffer
        const buffer = Buffer.from(data.body, 'base64');
        return fs.promises.writeFile(`${new Date().toISOString().replace(/[-T:]/g, '').split(".")[0]}_output.pdf`, buffer)
    }
})
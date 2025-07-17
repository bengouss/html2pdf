import fs from "fs"

const report = "2d2919a0-879f-4cf7-b768-e02d56fa9e64"
const puppeteer_token="eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiYWNhMjcxZDUtMjA3ZC00ZmZjLWEzNTMtNWI3MDc1YTUwODhiIiwicHVwcGV0ZWVyIjp0cnVlLCJleHAiOjE3NTI3ODk5MDF9.xo0MaaBZZrQpcYe0bYY_eXBuevf1T8tnBhqczAs25k0"

fetch('http://localhost:9000/2015-03-31/functions/function/invocations', {
    method: 'POST',
    body: JSON.stringify({
        queryStringParameters: {
            url: `https://client.staging.abbove.com/beta/reports/${report}/print?puppeteer_token=${puppeteer_token}`,
            waitForExpression: "!!document.querySelector('.finished_rendering')",
            jpegQuality: 70,
        },
        requestContext: {
            http: {
                method: 'POST'
            }
        },
        body: JSON.stringify({})
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
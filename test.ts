import fs from "fs"

fetch('http://localhost:9000/2015-03-31/functions/function/invocations', {
    method: 'POST',
    body: JSON.stringify({
        queryStringParameters: {
            url: "https://www.google.com"
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
        return fs.promises.writeFile(`${Date.now()}_output.pdf`, buffer)
    }
})
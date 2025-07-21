import { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import puppeteer from "./puppeteer"
import compressPDF from "./pdf"

const validToken = process.env.AUTH_TOKEN || "abcdef123"
const unauthorized = () => ({
    statusCode: 401,
    body: JSON.stringify({ error: "Unauthorized" }),
    isBase64Encoded: false,
    headers: {
        "Content-Type": "application/json"
    }
})

const handleApi = async (e: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    let code = 400
    let body = "Bad Request"
    let headers = {}
    let isBase64Encoded = false

    const timeoutMs = (e.queryStringParameters?.timeout ? parseInt(e.queryStringParameters?.timeout) : 40000) || 40000
    const compress = !(e.queryStringParameters?.compress === "false")
    const jpegQuality = e.queryStringParameters?.jpegQuality ? parseInt(e.queryStringParameters?.jpegQuality) : undefined
    const cache = e.queryStringParameters?.cache === "true"
    const query = !e.queryStringParameters?.query || e.queryStringParameters?.query === "true"
    const uuid = context && context.awsRequestId ? `${context.awsRequestId}` : `${crypto.randomUUID()}`
    const filename = e.queryStringParameters?.filename || "output.pdf"
    const interceptRequestURL = e.queryStringParameters?.intercept

    const cookies:Record<string, string> = {}
    let reqBody:Record<string, any> = {}

    console.log((e.requestContext as any)?.http?.method, e.body)

    if((e.requestContext as any)?.http?.method === "POST" && !!e.body) {
        try {
            reqBody = e.isBase64Encoded ? JSON.parse(Buffer.from(e.body, 'base64').toString('utf-8')) : JSON.parse(e.body)
            if(reqBody.cookies) {
                Object.entries(reqBody.cookies).map(([key, value]) => {
                    cookies[key] = `${value}`
                })
            }
        } catch (err) {
            console.log("Error parsing body:", err)
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Invalid JSON body" }),
                isBase64Encoded: false,
                headers: {
                    "Content-Type": "application/json"
                }
            };
        }
    }
    const input = {
        uuid,
        interceptRequestURL,
        timeoutMs,
        cache,
        query,
        cookies,
        url: reqBody.url,
        ...reqBody
    }
    console.log(JSON.stringify(input))
    await puppeteer.renderPDF(input)
    .then(uncompressedData => {
        console.log("PDF rendered successfully for UUID:", uuid, "compress:", compress, "jpegQuality:", jpegQuality, `size:${(uncompressedData.length/1024).toFixed(2)}KB`)
        if(!compress) return uncompressedData
        console.log("Compressing PDF...")
        return compressPDF(uncompressedData, uuid, jpegQuality)
    })
    .then(data => {
        body = data.toString("base64")
        headers = {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "max-age=604800",
            "Content-Length": body.length.toString()
        }
        isBase64Encoded = true
        code = 200
    })
    .catch(err => {
        console.log(err.code || err)
        code = err.code || 500
        if(code < 200 || code > 599) code = 500
        try {
            body = JSON.stringify(err.message)
        } catch(e) {
            body = err.message
        }
    })

    return {
        statusCode: code,
        isBase64Encoded,
        body,
        headers
    };
}

const handleInvoke = async (event: any, context: Context): Promise<APIGatewayProxyResult> => {
    console.log("Received event:", JSON.stringify(event), JSON.stringify(context));
    const token = event.token || event.queryStringParameters?.token;
    if(token !== validToken) return unauthorized();

    const uuid = context?.awsRequestId || crypto.randomUUID();
    
    return {
        statusCode: 200,
        body: JSON.stringify({ uuid }),
        isBase64Encoded: false,
        headers: {
            "Content-Type": "application/json"
        }
    };
}

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {

    try {
        const isHttpApi = !!event.requestContext && !!(event.requestContext as any).http

        if(isHttpApi) {
            return handleApi(event, context);
        } else {
            return handleInvoke(event, context);
        }

    } catch (error) {
        console.error("Error handling request:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal Server Error" }),
            isBase64Encoded: false,
            headers: {
                "Content-Type": "application/json"
            }
        };
    }
};
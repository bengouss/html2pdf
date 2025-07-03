import { APIGatewayEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import scraper from "./puppeteer"

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
    if(e.queryStringParameters && e.queryStringParameters.url){
        const timeout = (e.queryStringParameters.timeout ? parseInt(e.queryStringParameters.timeout) : 40000) || 40000
        const cache = e.queryStringParameters.cache === "true"
        const query = e.queryStringParameters.query === "true"
        const uuid = context && context.awsRequestId ? `${context.awsRequestId}` : `${crypto.randomUUID()}`
        const filename = e.queryStringParameters.filename || "output.pdf"
        const waitForExpression = e.queryStringParameters.waitForExpression || undefined
        console.log(e.queryStringParameters.url, timeout, cache, query)
        await scraper.renderPDF(
            e.queryStringParameters.url,
            uuid,
            e.queryStringParameters.intercept,
            waitForExpression,
            timeout,
            cache,
            query
        )
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
    }

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
import arc from '@architect/functions'

/** @type{import('aws-lambda').APIGatewayProxyHandlerV2} */
export const handler = arc.http(async (event) => {
  const db = await arc.tables()
  await db.products.put({
    ...event.body,
    productName: event.pathParameters.productName,
  })
  return {
    statusCode: 200,
    headers: {
      'cache-control':
        'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
      'content-type': 'application/json; charset=utf8',
    },
  }
})

import arc from '@architect/functions'

/** @type{import('aws-lambda').APIGatewayProxyHandlerV2} */
export async function handler(event) {
  const db = await arc.tables()
  const result = await db.carts.get({
    cartShopper: event.pathParameters.cartShopper,
  })
  return {
    statusCode: result ? 200 : 404,
    body: JSON.stringify(result),
    headers: {
      'cache-control':
        'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
      'content-type': 'application/json; charset=utf8',
    },
  }
}

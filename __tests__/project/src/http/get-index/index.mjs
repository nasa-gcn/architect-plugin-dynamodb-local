import functions from '@architect/functions'

export async function handler() {
  const statusCode = 200
  const db = await functions.tables()
  const body = db.testTable.scan({})
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      'cache-control':
        'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
      'content-type': 'application/json; charset=utf8',
    },
  }
}

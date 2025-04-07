import arc from '@architect/functions'
import { unmarshall } from '@aws-sdk/util-dynamodb'

/** @type{import('aws-lambda').DynamoDBStreamHandler} */
export async function handler(event) {
  const db = await arc.tables()
  for (const { dynamodb } of event.Records) {
    const oldImage = unmarshall(dynamodb.OldImage)
    const newImage = unmarshall(dynamodb.NewImage)
    const productName = newImage.productName
    const carts = await db.carts.scanAll()
    await Promise.all(
      carts.map((cart) => {
        const cartProduct = cart.cartProducts.find(
          (cartProduct) => cartProduct.productName === productName
        )
        if (cartProduct) {
          cart.cartTotal +=
            cartProduct.quantity *
            (newImage.productUnitPrice - oldImage.productUnitPrice)
          return db.carts.put(cart)
        }
      })
    )
  }
}

import { DynamoDBStreamEvent } from 'aws-lambda'

export async function handler({ Records }: DynamoDBStreamEvent) {
  const images = Records.map(({ dynamodb }) => dynamodb?.NewImage)
  console.log(images)
  return
}

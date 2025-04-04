/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { DynamoDBStreamEvent } from 'aws-lambda'

export async function handler({ Records }: DynamoDBStreamEvent) {
  const images = Records.map(({ dynamodb }) => dynamodb?.NewImage)
  console.log(images)
  return
}

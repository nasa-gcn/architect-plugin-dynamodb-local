@app
project

@http
get /products/:productName
put /products/:productName
get /carts/:cartShopper

@tables
products
  productName *String
carts
  cartShopper *String

@tables-streams
products
  src src/tables-streams/products

@dynamodb-local
seedFile seed.json

@plugins
nasa-gcn/architect-plugin-dynamodb-local
  src ../../index.js

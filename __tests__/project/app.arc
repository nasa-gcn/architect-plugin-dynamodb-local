@app
project

@http
get /

@tables
testTable
  itemID *Number

@plugins
nasa-gcn/architect-plugin-dynamodb-local
  src ../../index.js

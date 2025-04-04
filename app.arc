@app
plugin-test

@http
get /

@tables
testTable
  itemID *Number

@tables-streams
testTable
  src ./__tests__/testTableStream

@plugins
nasa-gcn/architect-plugin-dynamodb-local
  src ./index.js

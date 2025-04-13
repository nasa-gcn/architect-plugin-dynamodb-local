# Architect plugin for Local DynamoDB Docker

This is a plugin for a local DynamoDB instance using Docker.

When you are using Architect's sandbox mode, the plugin starts a Docker container running the [`amazon/dynamodb-local`](https://hub.docker.com/r/amazon/dynamodb-local) image.

If you have defined a `@tables-streams` section in your `app.arc` file, the respective streams will be enabled and their configured lambdas automatically triggered.

## Prerequisites

- Docker installed and running on your system.
- Node.js (if this project is built as a Node.js tool).

## Usage

1. Install this package using npm:

   ```
   npm install -D @nasa-gcn/architect-plugin-dynamodb-local
   ```

2. In your `.env` add the following:

   ```
   ARC_TABLES_PORT=8000
   ARC_DB_EXTERNAL=true
   ```

3. Add the following to your project's `app.arc` configuration file:

   ```
   @plugins
   nasa-gcn/architect-plugin-dynamodb-local
   ```

4. Seeding the database (optional):

   ```
   @dynamodb-local
   seedFile your-seed-file.json
   ```

If you want to utilize the @tables-streams, include a json formatted seedFile. The database will be seeded automatically during initialization. This will happen **BEFORE** Architect's built-in seeding step. By default, Architect will look for a file named `sandbox-seed.json` or `sandbox-seed.js` to seed the database. If you use this feature name the file differently, otherwise this plugin will skip the file seeding. To easily switch from using the built-in seed function, you can simply rename your existing `sandbox-seed.[js|json]` file and pass that as an argument to the plugin.

### Seed File Format

The seedFile should be a JSON file where the keys are the table names and the values are the list of items to be added. Example:

```
{
  "table1": [
    {
      "someProperty":"some value",
      ...
    },
    {
      ...
    }
  ],
  "table2": [
    ...
  ]
}
```

const serverless = require('serverless-http');

let app;
let handler;
let initError = null;

function getHandler() {
  if (!handler && !initError) {
    try {
      app = require('../../server');
      handler = serverless(app);
    } catch (err) {
      initError = err;
      console.error('Fatal initialization error in Netlify API function:', err);
    }
  }
  return { handler, initError };
}

module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Normalize path if Netlify redirects /api/* to function
  let normalizedPath = event.path || '';
  if (normalizedPath.startsWith('/.netlify/functions/api')) {
    const remainder = normalizedPath.replace('/.netlify/functions/api', '');
    if (!remainder.startsWith('/api')) {
      normalizedPath = '/api' + (remainder.startsWith('/') ? remainder : '/' + remainder);
    } else {
      normalizedPath = remainder;
    }
    event.path = normalizedPath;
  }

  // Diagnostic health check that does NOT depend on database or express
  if (normalizedPath === '/api/health') {
    let sqliteTest = 'not_tested';
    try {
      const Database = require('better-sqlite3');
      sqliteTest = 'module_loaded';
      const db = new Database(':memory:');
      sqliteTest = 'in_memory_db_created';
      db.exec('CREATE TABLE test (id INT); INSERT INTO test VALUES (1);');
      const row = db.prepare('SELECT * FROM test').get();
      sqliteTest = `query_success_val_${row.id}`;
      db.close();
    } catch (e) {
      sqliteTest = 'sqlite_error: ' + e.message;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        sqliteTest,
        cwd: process.cwd(),
        env: {
          NODE_VERSION: process.env.NODE_VERSION,
          AWS_LAMBDA_JS_RUNTIME: process.env.AWS_LAMBDA_JS_RUNTIME,
          AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME
        }
      })
    };
  }

  const { handler: h, initError: err } = getHandler();

  if (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Netlify API Initialization Error',
        message: err.message,
        stack: err.stack
      })
    };
  }

  try {
    return await h(event, context);
  } catch (err) {
    console.error('Netlify handler execution error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Netlify API Request Error',
        message: err.message,
        stack: err.stack
      })
    };
  }
};

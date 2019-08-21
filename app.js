/*
    0 -> node path
    1 -> app path
    2 -> owner name
    3 -> repo name
    4 -> path name (default to root)
*/
const minimist = require('minimist');

let args = minimist(process.argv.slice(2), {  
    alias: {
        o: 'owner',
        r: 'repo',
        j: 'json',
    },
    default: {
        o: 'craeyu',
        r: 'helix-home',
        j: false,
    },
});

const owner = args['o'];
const repo = args['r'];
const json = args['j'];

const http = require('http');
const request = require("request-promise-native");
const dotenv = require('dotenv');
dotenv.config();

const Octokit = require('@octokit/rest');
const octokit = new Octokit({
    auth: process.env.HELIX_SCANNER_GITHUB_AUTH_TOKEN,
    baseUrl: 'https://api.github.com',
    log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
    },
    request: {
        agent: undefined,
        fetch: undefined,
        timeout: 0
    }
});

const pg = require('pg');
const config = {
    host: process.env.HELIX_SCANNER_POSTGRESQL_DB_HOST,
    user: process.env.HELIX_SCANNER_POSTGRESQL_DB_USER,     
    password: process.env.HELIX_SCANNER_POSTGRESQL_DB_PASSWORD,
    database: process.env.HELIX_SCANNER_POSTGRESQL_DB_NAME,
    port: 5432,
    ssl: true
};
const client = new pg.Client(config);

const hostname = '127.0.0.1';
const server_port = 3001;

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World\n');
});

const base_url =  `http://localhost:3000/`;

const revision = require('child_process')
.execSync('git rev-parse HEAD')
.toString().trim()

let existingTableNames = {}

const createDefaultTable = (tableName) => {
    const createTableQuery = `CREATE TABLE IF NOT EXISTS ${tableName} (
        path    text    PRIMARY KEY
    );`
    console.log(`Preparing to execute table default creation query ${createTableQuery}`)
    try {
        client.query(createTableQuery)
    } catch (err) {
        console.log(err)
    }
    existingTableNames[tableName] = ['path']
}

const updateTextColumns = (tableName, key) => {
    const update_column_query = `ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS ${key} text;`
    console.log(`Preparing to execute column insertion query ${update_column_query}`)
    try {
        client.query(update_column_query)
    } catch (err) {
        console.log(err)
    }
    existingTableNames[tableName].push(key)
}

const mergeKeyandValue = (keys) => {
    const strs = []
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        strs.push(`${key} = EXCLUDED.${key}`)
    }
    return strs.join(', ')
}

const execQuery = (tableName, filePath, file_entries) => {
    let current_columns = existingTableNames[tableName]
    Object.keys(file_entries).map(key => {
        if (!current_columns.includes(key))
            updateTextColumns(tableName, key)
    })
    const query_schema = current_columns.join(', ')
    let current_values = []
    for (let column of current_columns) {
        if (column === 'path') {
            current_values.push(filePath)
        } else {
            current_values.push(file_entries[column] ? JSON.stringify(file_entries[column]) : 'NULL')
        }
    }
    const value_field = current_values .join('\', \'')
    const on_conflict_field = mergeKeyandValue(current_columns)
    console.log('on conflict field is', on_conflict_field)
    const insertDataQuery = `INSERT INTO ${tableName} (${query_schema}) VALUES ('${value_field}')
    ON CONFLICT (path) DO UPDATE SET ${on_conflict_field};`;
    console.log(`Preparing to execute data insertion query ${insertDataQuery}`)
    client.query(insertDataQuery)
        .catch(err => {
            console.log(`Error executing database query '${insertDataQuery}': `, err)
        })
}

const updateJSONBColumn = (tableName) => {
    const column_name = 'entries'
    const update_column_query = `ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS ${column_name} JSONB;`
    console.log(`Preparing to execute column insertion query ${update_column_query}`)
    client.query(update_column_query)
        .catch(err => console.log(err))
    existingTableNames[tableName].push(column_name)
}

const execJSONQuery = (tableName, path, entries) => {
    if (!existingTableNames[tableName].includes('entries'))
        updateJSONBColumn(tableName)
    const stringifiedEntries = JSON.stringify(entries)
    const insertDataQuery = `INSERT INTO ${tableName} (path, entries) VALUES ('${path}', '${stringifiedEntries}')
        ON CONFLICT (path) DO UPDATE SET entries = EXCLUDED.entries;`;
    console.log(`Preparing to execute data insertion query ${insertDataQuery}`)
    client.query(insertDataQuery)
        .catch(err => {
            console.log(`Error executing database query '${insertDataQuery}': `, err)
        })
}

const scanGithub = async () => octokit.git.getTree({
    owner: owner,
    repo: repo,
    tree_sha: revision,
    recursive: 1,
})

server.listen(server_port, hostname, async () => {
    console.log(`Server running at http://${hostname}:${server_port}/`);
    existingTableNames = {}
    await client.connect((err) => {
        if (err) throw err;
        else {
            console.log('PostgresDB connected.')
        }
    })
    const { data : { tree }} = await scanGithub()
    const filePaths = tree.filter(obj => obj.type === 'blob' && !obj.path.startsWith('.github') && obj.path.endsWith('.md')).map(file => file.path)
    let promises = []
    filePaths.map(filePath => promises.push(request({uri: base_url.concat(filePath.replace('.md', '.idx.json')), json: true})))
    const results = await Promise.all(promises)
    for (let i = 0; i < results.length; ++i) {
        const content = results[i]
        const path = `/${owner}/${repo}/${filePaths[i]}`
        Object.keys(content).map(tableName => {
            const { entries } = content[tableName]
            console.log('existing table name', existingTableNames)
            if (!(tableName in existingTableNames)) {
                createDefaultTable(tableName)
            }
            if (json === true) {
                execJSONQuery(tableName, path, entries)
            } else {
                execQuery(tableName, path, entries)
            }
        })
    }
});
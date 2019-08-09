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
        p: 'path',
        j: 'json',
    },
    default: {
        o: 'craeyu',
        r: 'helix-home',
        p: '',
        j: true,
    },
});

const owner = args['o'];
const repo = args['r'];
const path = args['p'];
const json = args['j'];

const http = require('http');
const request = require("request-promise");
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
    const createTableQuery = `DROP TABLE IF EXISTS ${tableName} CASCADE;
    CREATE TABLE IF NOT EXISTS ${tableName} (
        path        text    PRIMARY KEY
    );`
    console.log(`Preparing to execute table default creation query ${createTableQuery}`)
    client.query(createTableQuery)
        .catch(err => console.log(err))
    existingTableNames[tableName] = ['path']
}

const updateTextColumns = (tableName, key) => {
    const update_column_query = `ALTER TABLE ${tableName}
        ADD COLUMN IF NOT EXISTS ${key} text;`
    console.log(`Preparing to execute column insertion query ${update_column_query}`)
    client.query(update_column_query)
        .catch(err => console.log(err))
    existingTableNames[tableName].push(key)
}

const execQuery = (tableName, file_path, file_entries) => {
    let current_columns = existingTableNames[tableName]
    Object.keys(file_entries).map(key => {
        if (!current_columns.includes(key))
            updateTextColumns(tableName, key)
    })
    const query_schema = current_columns.join(', ')
    let current_values = []
    for (let column of current_columns) {
        if (column === 'path') {
            current_values.push(file_path)
        } else {
            current_values.push(file_entries[column] ? JSON.stringify(file_entries[column]) : 'NULL')
        }
    }
    const value_field = current_values .join('\', \'')
    const insertDataQuery = `INSERT INTO ${tableName} (${query_schema}) VALUES ('${value_field}');`;
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

const traverseTree = () => octokit.git.getTree({
    owner: owner,
    repo: repo,
    tree_sha: revision,
    recursive: 1,
}).then(response => {
    if (path == '')
        return response.data.tree.filter(obj => obj.type === 'blob' && !obj.path.startsWith('.github') && obj.path.endsWith('.md'))
    else
        // error prone if the directory path has the exact string bc using 'includes'
        // e.g. if i only want hackathons/hack, this method gives me hackathons/ too
        return response.data.tree.filter(obj => obj.type === 'blob' && !obj.path.startsWith('.github') && obj.path.endsWith('.md') && obj.path.includes(path))
}).then(files => 
    files.map(file => {
        const wrapper = {}
        const idx_html = file.path.replace('.md', '.idx.html')
        wrapper[base_url.concat(idx_html)] = `/${file.path}`
        return wrapper
    })
).then(urls => urls.map((urlObject) => {
    for (const [url, path] of Object.entries(urlObject)) {
        request({ uri: url, json: true })
        .then(content => {
            console.log('the request url is: ', url)
            console.log('the title and description of this url is: ', content.tables[0].entries)
            console.log('the entire content block looks like: ', content)

            content.tables.map(table => {
                const tableName = table.name
                console.log('existing table name',existingTableNames)
                if (!(tableName in existingTableNames)) {
                    createDefaultTable(tableName)
                }
                console.log('json', json);
                if (json === true) {
                    execJSONQuery(tableName, path, table.entries)
                } else {
                    execQuery(tableName, path, table.entries)
                }
            })
        })
    }
}))

server.listen(server_port, hostname, () => {
    console.log(`Server running at http://${hostname}:${server_port}/`);

    client.connect(err => {
        if (err) throw err;
        else {
            console.log('PostgresDB connected.')
            traverseTree()
        }
    })
});
